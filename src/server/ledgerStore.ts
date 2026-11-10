import { randomUUID } from 'node:crypto';
import { buildPayPalToolCallPlan, parseUnstructuredMessages } from '../shared/aiParser.ts';
import { DEFAULT_POLICY, evaluateLedgerRisk, recommendToolForAction } from '../shared/riskEngine.ts';
import { buildSeedLedger } from '../shared/seedData.ts';
import type {
  LedgerItem,
  LedgerItemInput,
  LedgerStateResponse,
  LedgerStatus,
  ParsedAiCandidate,
  PolicyConfig,
  WireLogEntry,
} from '../shared/types.ts';
import { PayPalGateway } from './paypalGateway.ts';

export class LedgerStore {
  private items: LedgerItem[];
  private wireLog: WireLogEntry[];
  private policy: PolicyConfig;
  readonly gateway: PayPalGateway;

  constructor(gateway: PayPalGateway) {
    this.gateway = gateway;
    this.policy = { ...DEFAULT_POLICY };
    this.items = buildSeedLedger(this.policy);
    this.wireLog = [];
  }

  getState(): LedgerStateResponse {
    return {
      items: this.items,
      wireLog: this.wireLog,
      policy: this.policy,
      gateway: this.gateway.getStatus(),
    };
  }

  resetDemo(): LedgerStateResponse {
    this.policy = { ...DEFAULT_POLICY };
    this.items = buildSeedLedger(this.policy);
    this.wireLog = [];
    return this.getState();
  }

  updatePolicy(nextPolicy: Partial<PolicyConfig>): LedgerStateResponse {
    this.policy = {
      maxAutoApproveUsd:
        typeof nextPolicy.maxAutoApproveUsd === 'number' && nextPolicy.maxAutoApproveUsd >= 50
          ? nextPolicy.maxAutoApproveUsd
          : this.policy.maxAutoApproveUsd,
      blockRiskScoreAtOrAbove:
        typeof nextPolicy.blockRiskScoreAtOrAbove === 'number'
          ? Math.max(10, Math.min(100, nextPolicy.blockRiskScoreAtOrAbove))
          : this.policy.blockRiskScoreAtOrAbove,
      allowDuplicateOverride:
        typeof nextPolicy.allowDuplicateOverride === 'boolean'
          ? nextPolicy.allowDuplicateOverride
          : this.policy.allowDuplicateOverride,
    };

    // Re-evaluate all non-terminal items chronologically so duplicate/structuring order remains consistent.
    const sorted = [...this.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const reevaluated: LedgerItem[] = [];
    for (const item of sorted) {
      const isTerminal =
        item.status === 'SETTLED_PAYPAL' || item.status === 'DISPUTE_RESOLVED';
      const evalResult = evaluateLedgerRisk(
        {
          id: item.id,
          referenceId: item.referenceId,
          payee: item.payee,
          email: item.email,
          amountUsd: item.amountUsd,
          actionType: item.actionType,
          sourceExcerpt: item.sourceExcerpt,
          notes: item.notes,
          currentStatus: isTerminal ? item.status : undefined,
        },
        reevaluated,
        this.policy
      );
      reevaluated.push({
        ...item,
        riskScore: evalResult.riskScore,
        riskLevel: evalResult.riskLevel,
        riskFactors: evalResult.riskFactors,
        status: isTerminal ? item.status : evalResult.recommendedStatus,
        updatedAt: new Date().toISOString(),
      });
    }

    this.items = reevaluated;
    return this.getState();
  }

  ingestUnstructuredText(rawText: string): {
    added: LedgerItem[];
    parsedCandidates: ParsedAiCandidate[];
    state: LedgerStateResponse;
  } {
    const parsedCandidates = parseUnstructuredMessages(rawText);
    const added: LedgerItem[] = [];

    for (const candidate of parsedCandidates) {
      const item = this.addStructuredItem({
        referenceId: candidate.referenceId,
        payee: candidate.payee,
        email: candidate.email,
        actionType: candidate.actionType,
        category: candidate.category,
        costCenter: candidate.costCenter,
        amountUsd: candidate.amountUsd,
        sourceExcerpt: candidate.sourceExcerpt,
        notes: candidate.extractionNotes,
      });
      added.push(item);
    }

    return {
      added,
      parsedCandidates,
      state: this.getState(),
    };
  }

  addStructuredItem(input: LedgerItemInput): LedgerItem {
    const id = `row-${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const referenceId = input.referenceId?.trim() || `AI-${Date.now().toString().slice(-6)}`;

    const evalResult = evaluateLedgerRisk(
      {
        id,
        referenceId,
        payee: input.payee,
        email: input.email,
        amountUsd: input.amountUsd,
        actionType: input.actionType,
        sourceExcerpt: input.sourceExcerpt,
        notes: input.notes,
      },
      this.items,
      this.policy
    );

    const newItem: LedgerItem = {
      id,
      referenceId,
      payee: input.payee,
      email: input.email,
      actionType: input.actionType,
      category: input.category || 'Engineering',
      costCenter: input.costCenter || 'CC-ENG-01',
      amountUsd: Math.round(input.amountUsd * 100) / 100,
      currency: 'USD',
      status: evalResult.recommendedStatus,
      riskScore: evalResult.riskScore,
      riskLevel: evalResult.riskLevel,
      riskFactors: evalResult.riskFactors,
      recommendedTool: recommendToolForAction(input.actionType),
      paypalResourceId: null,
      executionMode: null,
      sourceExcerpt: input.sourceExcerpt,
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now,
    };

    this.items = [newItem, ...this.items];
    return newItem;
  }

  updateItemFields(
    id: string,
    updates: Partial<Pick<LedgerItem, 'costCenter' | 'notes' | 'status' | 'category'>>
  ): LedgerItem | null {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return null;

    const current = this.items[idx];
    const updated: LedgerItem = {
      ...current,
      costCenter: updates.costCenter ?? current.costCenter,
      notes: updates.notes ?? current.notes,
      category: updates.category ?? current.category,
      status: updates.status ?? current.status,
      updatedAt: new Date().toISOString(),
    };
    this.items[idx] = updated;
    return updated;
  }

  approveWithHumanOverride(id: string): LedgerItem | null {
    return this.updateItemFields(id, {
      status: 'APPROVED',
      notes: `${this.items.find((i) => i.id === id)?.notes ?? ''} [Human approved]`.trim(),
    });
  }

  async executeItem(id: string, forceOverride = false): Promise<{
    ok: boolean;
    blockedByPolicy?: boolean;
    item: LedgerItem | null;
    wireEntry?: WireLogEntry;
    errorMessage?: string;
    state: LedgerStateResponse;
  }> {
    const item = this.items.find((i) => i.id === id);
    if (!item) {
      return { ok: false, item: null, errorMessage: 'Ledger item not found', state: this.getState() };
    }

    if (item.status === 'BLOCKED_BY_POLICY' && !forceOverride) {
      return {
        ok: false,
        blockedByPolicy: true,
        item,
        errorMessage:
          'Blocked by autonomous spending/fraud guardrails. Approve override explicitly before calling PayPal.',
        state: this.getState(),
      };
    }

    const plan = buildPayPalToolCallPlan(item);
    const outcome = await this.gateway.executeSingleAction(item, plan);
    this.wireLog = [outcome.wireEntry, ...this.wireLog];

    const nextStatus: LedgerStatus = outcome.ok
      ? item.actionType === 'DISPUTE'
        ? 'DISPUTE_RESOLVED'
        : 'SETTLED_PAYPAL'
      : 'FAILED';

    const idx = this.items.findIndex((i) => i.id === id);
    this.items[idx] = {
      ...item,
      status: nextStatus,
      paypalResourceId: outcome.paypalResourceId ?? item.paypalResourceId,
      executionMode: outcome.executionMode,
      updatedAt: new Date().toISOString(),
    };

    return {
      ok: outcome.ok,
      item: this.items[idx],
      wireEntry: outcome.wireEntry,
      errorMessage: outcome.errorMessage,
      state: this.getState(),
    };
  }

  async executeBatchPayouts(itemIds: string[], includeOverride = false): Promise<{
    ok: boolean;
    dispatchedCount: number;
    skippedBlockedIds: string[];
    wireEntry?: WireLogEntry;
    errorMessage?: string;
    state: LedgerStateResponse;
  }> {
    const selected = this.items.filter((i) => itemIds.includes(i.id));
    if (selected.length === 0) {
      return {
        ok: false,
        dispatchedCount: 0,
        skippedBlockedIds: [],
        errorMessage: 'No ledger items selected for batch payout.',
        state: this.getState(),
      };
    }

    const skippedBlockedIds = selected
      .filter((i) => i.status === 'BLOCKED_BY_POLICY' && !includeOverride)
      .map((i) => i.id);

    const eligible = selected.filter(
      (i) =>
        i.status !== 'SETTLED_PAYPAL' &&
        i.status !== 'DISPUTE_RESOLVED' &&
        (!skippedBlockedIds.includes(i.id) || includeOverride)
    );

    if (eligible.length === 0) {
      return {
        ok: false,
        dispatchedCount: 0,
        skippedBlockedIds,
        errorMessage:
          'All selected items are either already settled or blocked by risk policy guardrails.',
        state: this.getState(),
      };
    }

    const outcome = await this.gateway.executeBatchPayout(eligible);
    this.wireLog = [outcome.wireEntry, ...this.wireLog];

    if (outcome.ok) {
      const eligibleSet = new Set(eligible.map((i) => i.id));
      const now = new Date().toISOString();
      this.items = this.items.map((item) =>
        eligibleSet.has(item.id)
          ? {
              ...item,
              status: 'SETTLED_PAYPAL',
              paypalResourceId: outcome.paypalResourceId ?? item.paypalResourceId,
              executionMode: outcome.executionMode,
              updatedAt: now,
            }
          : item
      );
    }

    return {
      ok: outcome.ok,
      dispatchedCount: outcome.ok ? eligible.length : 0,
      skippedBlockedIds,
      wireEntry: outcome.wireEntry,
      errorMessage: outcome.errorMessage,
      state: this.getState(),
    };
  }
}
