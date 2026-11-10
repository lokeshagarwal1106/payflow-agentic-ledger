import { randomUUID } from 'node:crypto';
import { ALL_TOOLS_ENABLED, PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import type {
  ExecutionMode,
  GatewayStatusSnapshot,
  LedgerItem,
  PayPalToolCallPlan,
  ToolkitCatalogItem,
  WireLogEntry,
} from '../shared/types.ts';

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

interface CredentialsState {
  clientId: string;
  clientSecret: string;
  source: 'NONE' | 'ENV' | 'SESSION';
  cachedToken: string | null;
  tokenExpiresAtMs: number;
  lastVerifiedAt: string | null;
}

export interface ExecutionOutcome {
  ok: boolean;
  executionMode: ExecutionMode;
  paypalResourceId: string | null;
  wireEntry: WireLogEntry;
  errorMessage?: string;
}

function classifyToolCategory(toolName: string): string {
  if (toolName.includes('invoice') || toolName.includes('recurring')) return 'Invoicing';
  if (toolName.includes('order')) return 'Orders & Checkout';
  if (toolName.includes('dispute')) return 'Disputes';
  if (toolName.includes('refund')) return 'Payments & Refunds';
  if (toolName.includes('subscription') || toolName.includes('plan')) return 'Subscriptions';
  if (toolName.includes('shipment')) return 'Shipment Tracking';
  if (toolName.includes('product')) return 'Catalog';
  return 'Transactions & Insights';
}

export class PayPalGateway {
  private creds: CredentialsState;
  private readonly introspectToolkit: PayPalAgentToolkit;
  private readonly catalog: ToolkitCatalogItem[];

  constructor(envClientId = process.env.PAYPAL_CLIENT_ID ?? '', envClientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '') {
    const cleanId = envClientId.trim();
    const cleanSecret = envClientSecret.trim();

    this.creds = {
      clientId: cleanId,
      clientSecret: cleanSecret,
      source: cleanId && cleanSecret ? 'ENV' : 'NONE',
      cachedToken: null,
      tokenExpiresAtMs: 0,
      lastVerifiedAt: null,
    };

    // Instantiate official @paypal/agent-toolkit to inspect all supported PayPal tools & Zod schemas.
    this.introspectToolkit = new PayPalAgentToolkit({
      clientId: cleanId || 'sandbox-introspect-placeholder',
      clientSecret: cleanSecret || 'sandbox-introspect-placeholder',
      configuration: {
        actions: ALL_TOOLS_ENABLED,
        context: { sandbox: true },
      },
    });

    const tools = this.introspectToolkit.getTools();
    this.catalog = Object.entries(tools).map(([name, tool]) => {
      const shape = (tool as { parameters?: { shape?: Record<string, unknown> } }).parameters?.shape ?? {};
      const descLine = (tool.description ?? '').trim().split('\n')[0] || name;
      return {
        name,
        description: descLine,
        category: classifyToolCategory(name),
        parameterKeys: Object.keys(shape),
      };
    });
  }

  getExecutionMode(): ExecutionMode {
    return this.creds.clientId && this.creds.clientSecret
      ? 'LIVE_SANDBOX_API'
      : 'LOCAL_SANDBOX_REPLAY';
  }

  getStatus(): GatewayStatusSnapshot {
    return {
      executionMode: this.getExecutionMode(),
      sandboxBaseUrl: SANDBOX_BASE_URL,
      hasCredentials: Boolean(this.creds.clientId && this.creds.clientSecret),
      credentialSource: this.creds.source,
      toolkitPackage: '@paypal/agent-toolkit',
      toolkitToolCount: this.catalog.length,
      lastOAuthVerifiedAt: this.creds.lastVerifiedAt,
    };
  }

  getToolkitCatalog(): ToolkitCatalogItem[] {
    return this.catalog;
  }

  setSessionCredentials(clientId: string, clientSecret: string): GatewayStatusSnapshot {
    const trimmedId = clientId.trim();
    const trimmedSecret = clientSecret.trim();
    this.creds = {
      clientId: trimmedId,
      clientSecret: trimmedSecret,
      source: trimmedId && trimmedSecret ? 'SESSION' : 'NONE',
      cachedToken: null,
      tokenExpiresAtMs: 0,
      lastVerifiedAt: null,
    };
    return this.getStatus();
  }

  clearSessionCredentials(): GatewayStatusSnapshot {
    this.creds = {
      clientId: '',
      clientSecret: '',
      source: 'NONE',
      cachedToken: null,
      tokenExpiresAtMs: 0,
      lastVerifiedAt: null,
    };
    return this.getStatus();
  }

  async verifySandboxOAuth(): Promise<{ verified: boolean; mode: ExecutionMode; wireEntry: WireLogEntry; message: string }> {
    const start = Date.now();
    if (this.getExecutionMode() === 'LOCAL_SANDBOX_REPLAY') {
      const debugId = `replay-oauth-${randomUUID().slice(0, 8)}`;
      return {
        verified: false,
        mode: 'LOCAL_SANDBOX_REPLAY',
        message: 'Running in Local Sandbox Replay mode (no PayPal credentials supplied — zero billing, offline ready).',
        wireEntry: {
          id: `wire-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          executionMode: 'LOCAL_SANDBOX_REPLAY',
          ledgerItemIds: [],
          toolName: 'oauth2_token_check',
          httpMethod: 'POST',
          endpoint: '/v1/oauth2/token',
          statusCode: 200,
          paypalDebugId: debugId,
          requestPayload: { grant_type: 'client_credentials', sandbox: true },
          responsePayload: {
            mode: 'LOCAL_SANDBOX_REPLAY',
            note: 'Supply free developer.paypal.com Sandbox credentials to switch to live PayPal OAuth2.',
          },
          latencyMs: Date.now() - start,
        },
      };
    }

    const authHeader = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64');
    const resp = await fetch(`${SANDBOX_BASE_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const debugId = resp.headers.get('paypal-debug-id') ?? `sbx-${randomUUID().slice(0, 8)}`;
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

    if (!resp.ok || typeof json.access_token !== 'string') {
      return {
        verified: false,
        mode: 'LIVE_SANDBOX_API',
        message: `Sandbox OAuth failed (${resp.status}): ${String(json.error_description ?? json.error ?? 'Unknown error')}`,
        wireEntry: {
          id: `wire-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          executionMode: 'LIVE_SANDBOX_API',
          ledgerItemIds: [],
          toolName: 'oauth2_token_check',
          httpMethod: 'POST',
          endpoint: '/v1/oauth2/token',
          statusCode: resp.status,
          paypalDebugId: debugId,
          requestPayload: { grant_type: 'client_credentials', client_id_prefix: `${this.creds.clientId.slice(0, 6)}...` },
          responsePayload: { error: json.error, error_description: json.error_description },
          latencyMs: Date.now() - start,
        },
      };
    }

    const expiresInSec = Number(json.expires_in ?? 300);
    this.creds.cachedToken = json.access_token;
    this.creds.tokenExpiresAtMs = Date.now() + Math.max(60, expiresInSec - 30) * 1000;
    this.creds.lastVerifiedAt = new Date().toISOString();

    return {
      verified: true,
      mode: 'LIVE_SANDBOX_API',
      message: 'Verified Live PayPal Sandbox OAuth2 access token.',
      wireEntry: {
        id: `wire-${randomUUID().slice(0, 8)}`,
        timestamp: this.creds.lastVerifiedAt,
        executionMode: 'LIVE_SANDBOX_API',
        ledgerItemIds: [],
        toolName: 'oauth2_token_check',
        httpMethod: 'POST',
        endpoint: '/v1/oauth2/token',
        statusCode: resp.status,
        paypalDebugId: debugId,
        requestPayload: { grant_type: 'client_credentials', client_id_prefix: `${this.creds.clientId.slice(0, 6)}...` },
        responsePayload: {
          token_type: json.token_type,
          app_id: json.app_id,
          expires_in: json.expires_in,
          scope_count: String(json.scope ?? '').split(' ').filter(Boolean).length,
        },
        latencyMs: Date.now() - start,
      },
    };
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.creds.cachedToken && Date.now() < this.creds.tokenExpiresAtMs) {
      return this.creds.cachedToken;
    }
    const result = await this.verifySandboxOAuth();
    if (!result.verified || !this.creds.cachedToken) {
      throw new Error(result.message);
    }
    return this.creds.cachedToken;
  }

  validateToolkitPayload(toolName: string, payload: Record<string, unknown>): { valid: boolean; issues: string[] } {
    const tools = this.introspectToolkit.getTools();
    const target = tools[toolName] as { parameters?: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } } } | undefined;
    if (!target || !target.parameters) {
      return { valid: true, issues: [] };
    }
    const parsed = target.parameters.safeParse(payload);
    if (parsed.success) {
      return { valid: true, issues: [] };
    }
    const issues = (parsed.error?.issues ?? []).map(
      (i) => `${i.path.join('.') || 'root'}: ${i.message}`
    );
    return { valid: false, issues };
  }

  async executeSingleAction(item: LedgerItem, plan: PayPalToolCallPlan): Promise<ExecutionOutcome> {
    const start = Date.now();
    const mode = this.getExecutionMode();

    // Always validate @paypal/agent-toolkit plans against real official Zod schemas first.
    if (plan.sdkLayer === '@paypal/agent-toolkit/ai-sdk') {
      const schemaCheck = this.validateToolkitPayload(plan.toolName, plan.payload);
      if (!schemaCheck.valid) {
        return {
          ok: false,
          executionMode: mode,
          paypalResourceId: null,
          errorMessage: `Toolkit schema validation failed: ${schemaCheck.issues.join('; ')}`,
          wireEntry: {
            id: `wire-${randomUUID().slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            executionMode: mode,
            ledgerItemIds: [item.id],
            toolName: plan.toolName,
            httpMethod: plan.httpMethod,
            endpoint: plan.endpoint,
            statusCode: 400,
            paypalDebugId: `zod-${randomUUID().slice(0, 8)}`,
            requestPayload: plan.payload,
            responsePayload: { validation_errors: schemaCheck.issues },
            latencyMs: Date.now() - start,
          },
        };
      }
    }

    if (mode === 'LOCAL_SANDBOX_REPLAY') {
      return this.executeLocalReplay([item], plan, start);
    }

    // LIVE_SANDBOX_API path: run either official @paypal/agent-toolkit or PayPal Payouts v1 HTTP API.
    try {
      if (plan.sdkLayer === '@paypal/agent-toolkit/ai-sdk') {
        const liveToolkit = new PayPalAgentToolkit({
          clientId: this.creds.clientId,
          clientSecret: this.creds.clientSecret,
          configuration: {
            actions: ALL_TOOLS_ENABLED,
            context: { sandbox: true },
          },
        });
        const tool = liveToolkit.getTools()[plan.toolName] as {
          execute?: (args: Record<string, unknown>, opts: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
        };
        if (!tool || typeof tool.execute !== 'function') {
          throw new Error(`PayPal toolkit tool "${plan.toolName}" not available`);
        }

        const rawResult = await tool.execute(plan.payload, {
          toolCallId: `payflow-${randomUUID().slice(0, 8)}`,
          messages: [],
        });

        const parsed =
          typeof rawResult === 'string'
            ? (JSON.parse(rawResult) as Record<string, unknown>)
            : (rawResult as Record<string, unknown>);

        const hasError = Boolean(parsed?.error || parsed?.name === 'UNPROCESSABLE_ENTITY');
        const resourceId = extractPayPalResourceId(parsed) ?? item.referenceId;

        return {
          ok: !hasError,
          executionMode: 'LIVE_SANDBOX_API',
          paypalResourceId: hasError ? null : resourceId,
          errorMessage: hasError ? JSON.stringify(parsed.error ?? parsed) : undefined,
          wireEntry: {
            id: `wire-${randomUUID().slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            executionMode: 'LIVE_SANDBOX_API',
            ledgerItemIds: [item.id],
            toolName: plan.toolName,
            httpMethod: plan.httpMethod,
            endpoint: plan.endpoint,
            statusCode: hasError ? 422 : 201,
            paypalDebugId: `sbx-tk-${randomUUID().slice(0, 8)}`,
            requestPayload: plan.payload,
            responsePayload: parsed,
            latencyMs: Date.now() - start,
          },
        };
      }

      // PayPal Batch Payouts v1 REST API
      return await this.executeLiveBatchPayout([item], start);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        executionMode: 'LIVE_SANDBOX_API',
        paypalResourceId: null,
        errorMessage: msg,
        wireEntry: {
          id: `wire-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          executionMode: 'LIVE_SANDBOX_API',
          ledgerItemIds: [item.id],
          toolName: plan.toolName,
          httpMethod: plan.httpMethod,
          endpoint: plan.endpoint,
          statusCode: 502,
          paypalDebugId: `sbx-err-${randomUUID().slice(0, 8)}`,
          requestPayload: plan.payload,
          responsePayload: { error: msg },
          latencyMs: Date.now() - start,
        },
      };
    }
  }

  async executeBatchPayout(items: LedgerItem[]): Promise<ExecutionOutcome> {
    const start = Date.now();
    if (this.getExecutionMode() === 'LOCAL_SANDBOX_REPLAY') {
      const batchId = `PAYOUT-REPLAY-${randomUUID().slice(0, 8).toUpperCase()}`;
      const payload = buildBatchPayoutPayload(items, batchId);
      return {
        ok: true,
        executionMode: 'LOCAL_SANDBOX_REPLAY',
        paypalResourceId: batchId,
        wireEntry: {
          id: `wire-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          executionMode: 'LOCAL_SANDBOX_REPLAY',
          ledgerItemIds: items.map((i) => i.id),
          toolName: 'create_batch_payout',
          httpMethod: 'POST',
          endpoint: '/v1/payments/payouts',
          statusCode: 201,
          paypalDebugId: `replay-${randomUUID().slice(0, 10)}`,
          requestPayload: payload,
          responsePayload: {
            execution_mode: 'LOCAL_SANDBOX_REPLAY',
            batch_header: {
              payout_batch_id: batchId,
              batch_status: 'PENDING',
              sender_batch_header: payload.sender_batch_header,
            },
            item_count: items.length,
            total_usd: items.reduce((sum, i) => sum + i.amountUsd, 0).toFixed(2),
          },
          latencyMs: Date.now() - start,
        },
      };
    }

    return this.executeLiveBatchPayout(items, start);
  }

  private async executeLiveBatchPayout(items: LedgerItem[], startMs: number): Promise<ExecutionOutcome> {
    const token = await this.ensureAccessToken();
    const senderBatchId = `PAYFLOW-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const payload = buildBatchPayoutPayload(items, senderBatchId);

    const resp = await fetch(`${SANDBOX_BASE_URL}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': senderBatchId,
      },
      body: JSON.stringify(payload),
    });

    const debugId = resp.headers.get('paypal-debug-id') ?? `sbx-po-${randomUUID().slice(0, 8)}`;
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const batchHeader = (json.batch_header ?? {}) as Record<string, unknown>;
    const batchId = typeof batchHeader.payout_batch_id === 'string' ? batchHeader.payout_batch_id : null;

    return {
      ok: resp.ok,
      executionMode: 'LIVE_SANDBOX_API',
      paypalResourceId: resp.ok ? batchId : null,
      errorMessage: resp.ok ? undefined : String(json.message ?? `PayPal HTTP ${resp.status}`),
      wireEntry: {
        id: `wire-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        executionMode: 'LIVE_SANDBOX_API',
        ledgerItemIds: items.map((i) => i.id),
        toolName: 'create_batch_payout',
        httpMethod: 'POST',
        endpoint: '/v1/payments/payouts',
        statusCode: resp.status,
        paypalDebugId: debugId,
        requestPayload: payload,
        responsePayload: json,
        latencyMs: Date.now() - startMs,
      },
    };
  }

  private executeLocalReplay(items: LedgerItem[], plan: PayPalToolCallPlan, startMs: number): ExecutionOutcome {
    const item = items[0];
    const tokenHex = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
    const prefixMap: Record<string, string> = {
      create_order: `SBX-ORD-${tokenHex}`,
      create_invoice: `INV2-SBX-${tokenHex}`,
      accept_dispute_claim: item.referenceId,
      create_refund: `REF-SBX-${tokenHex}`,
      create_batch_payout: `BATCH-SBX-${tokenHex}`,
    };
    const resourceId = prefixMap[plan.toolName] ?? `SBX-${tokenHex}`;

    return {
      ok: true,
      executionMode: 'LOCAL_SANDBOX_REPLAY',
      paypalResourceId: resourceId,
      wireEntry: {
        id: `wire-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        executionMode: 'LOCAL_SANDBOX_REPLAY',
        ledgerItemIds: [item.id],
        toolName: plan.toolName,
        httpMethod: plan.httpMethod,
        endpoint: plan.endpoint,
        statusCode: 201,
        paypalDebugId: `replay-${randomUUID().slice(0, 10)}`,
        requestPayload: plan.payload,
        responsePayload: {
          execution_mode: 'LOCAL_SANDBOX_REPLAY',
          schema_validated_by: '@paypal/agent-toolkit',
          id: resourceId,
          status: plan.toolName === 'accept_dispute_claim' ? 'RESOLVED' : 'COMPLETED_REPLAY',
          amount: { currency_code: item.currency, value: item.amountUsd.toFixed(2) },
          payee: item.email,
        },
        latencyMs: Date.now() - startMs,
      },
    };
  }
}

function buildBatchPayoutPayload(items: LedgerItem[], senderBatchId: string): Record<string, unknown> {
  return {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: 'You received a payout from PayFlow Treasury',
      email_message: 'Processed cleanly via PayFlow Agentic Ledger Sandbox.',
    },
    items: items.map((item) => ({
      recipient_type: 'EMAIL',
      receiver: item.email,
      amount: {
        value: item.amountUsd.toFixed(2),
        currency: item.currency,
      },
      note: item.notes || `${item.category} (${item.referenceId})`,
      sender_item_id: item.id,
    })),
  };
}

function extractPayPalResourceId(obj: Record<string, unknown>): string | null {
  if (typeof obj.id === 'string') return obj.id;
  if (typeof obj.dispute_id === 'string') return obj.dispute_id;
  if (typeof obj.href === 'string') {
    const segs = obj.href.split('/').filter(Boolean);
    return segs[segs.length - 1] ?? null;
  }
  return null;
}
