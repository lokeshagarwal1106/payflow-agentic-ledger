import cors from 'cors';
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildPayPalToolCallPlan } from '../shared/aiParser.ts';
import { compileNaturalLanguageToAgGridFilter } from '../shared/nlToAgGridFilter.ts';
import { LedgerStore } from './ledgerStore.ts';
import { PayPalGateway } from './paypalGateway.ts';

export interface AppContext {
  app: Express;
  store: LedgerStore;
  gateway: PayPalGateway;
}

export function createApp(options?: { staticDistDir?: string }): AppContext {
  const gateway = new PayPalGateway();
  const store = new LedgerStore(gateway);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'payflow-agentic-ledger',
      gateway: gateway.getStatus(),
    });
  });

  app.get('/api/ledger', (_req, res) => {
    res.json(store.getState());
  });

  app.post('/api/ledger/reset', (_req, res) => {
    res.json(store.resetDemo());
  });

  app.post('/api/ledger/policy', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = store.updatePolicy({
      maxAutoApproveUsd: typeof body.maxAutoApproveUsd === 'number' ? body.maxAutoApproveUsd : undefined,
      blockRiskScoreAtOrAbove:
        typeof body.blockRiskScoreAtOrAbove === 'number' ? body.blockRiskScoreAtOrAbove : undefined,
      allowDuplicateOverride:
        typeof body.allowDuplicateOverride === 'boolean' ? body.allowDuplicateOverride : undefined,
    });
    res.json(updated);
  });

  app.post('/api/ai/ingest', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      res.status(400).json({ error: 'Input text is required for AI extraction.' });
      return;
    }
    const result = store.ingestUnstructuredText(text);
    res.status(201).json(result);
  });

  app.post('/api/ai/compile-filter', (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const compiled = compileNaturalLanguageToAgGridFilter(query);
    res.json(compiled);
  });

  app.get('/api/paypal/tools', (_req, res) => {
    res.json({
      package: '@paypal/agent-toolkit',
      tools: gateway.getToolkitCatalog(),
    });
  });

  app.get('/api/ledger/:id/plan', (req, res) => {
    const item = store.getState().items.find((i) => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Ledger item not found' });
      return;
    }
    const plan = buildPayPalToolCallPlan(item);
    const schemaCheck =
      plan.sdkLayer === '@paypal/agent-toolkit/ai-sdk'
        ? gateway.validateToolkitPayload(plan.toolName, plan.payload)
        : { valid: true, issues: [] };
    res.json({ item, plan, schemaCheck });
  });

  app.patch('/api/ledger/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = store.updateItemFields(req.params.id, {
      costCenter: typeof body.costCenter === 'string' ? body.costCenter : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      category: typeof body.category === 'string' ? body.category : undefined,
      status:
        typeof body.status === 'string'
          ? (body.status as 'PENDING_REVIEW' | 'APPROVED' | 'BLOCKED_BY_POLICY')
          : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Ledger item not found' });
      return;
    }
    res.json({ item: updated, state: store.getState() });
  });

  app.post('/api/ledger/:id/approve', (req, res) => {
    const updated = store.approveWithHumanOverride(req.params.id);
    if (!updated) {
      res.status(404).json({ error: 'Ledger item not found' });
      return;
    }
    res.json({ item: updated, state: store.getState() });
  });

  app.post('/api/ledger/:id/execute', async (req, res) => {
    const forceOverride = Boolean(req.body?.forceOverride);
    const result = await store.executeItem(req.params.id, forceOverride);
    if (!result.item) {
      res.status(404).json(result);
      return;
    }
    if (result.blockedByPolicy) {
      res.status(409).json(result);
      return;
    }
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post('/api/ledger/batch-payout', async (req, res) => {
    const itemIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const includeOverride = Boolean(req.body?.includeOverride);
    const result = await store.executeBatchPayouts(itemIds, includeOverride);
    if (result.dispatchedCount === 0 && !result.ok) {
      res.status(400).json(result);
      return;
    }
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post('/api/gateway/credentials', async (req, res) => {
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : '';
    const clientSecret = typeof req.body?.clientSecret === 'string' ? req.body.clientSecret : '';
    if (!clientId.trim() || !clientSecret.trim()) {
      res.status(400).json({ error: 'Both clientId and clientSecret are required.' });
      return;
    }
    gateway.setSessionCredentials(clientId, clientSecret);
    const verify = await gateway.verifySandboxOAuth();
    res.status(verify.verified ? 200 : 401).json({
      ...verify,
      state: store.getState(),
    });
  });

  app.delete('/api/gateway/credentials', (_req, res) => {
    gateway.clearSessionCredentials();
    res.json({ state: store.getState() });
  });

  app.post('/api/gateway/verify', async (_req, res) => {
    const verify = await gateway.verifySandboxOAuth();
    res.json({ ...verify, state: store.getState() });
  });

  // Optional static client serving for built / production deployments (Express 5 splat syntax).
  const distDir = options?.staticDistDir ?? path.resolve(process.cwd(), 'dist/client');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return { app, store, gateway };
}
