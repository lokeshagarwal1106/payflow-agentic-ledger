import type {
  AgGridCompileResult,
  LedgerItem,
  LedgerStateResponse,
  PayPalToolCallPlan,
  PolicyConfig,
  ToolkitCatalogItem,
  WireLogEntry,
} from '../shared/types.ts';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string; errorMessage?: string };
  if (!resp.ok) {
    throw new Error(data.errorMessage || data.error || `HTTP ${resp.status}`);
  }
  return data;
}

export const api = {
  getLedger: () => jsonFetch<LedgerStateResponse>('/api/ledger'),

  resetDemo: () =>
    jsonFetch<LedgerStateResponse>('/api/ledger/reset', {
      method: 'POST',
    }),

  updatePolicy: (policy: Partial<PolicyConfig>) =>
    jsonFetch<LedgerStateResponse>('/api/ledger/policy', {
      method: 'POST',
      body: JSON.stringify(policy),
    }),

  ingestText: (text: string) =>
    jsonFetch<{ added: LedgerItem[]; state: LedgerStateResponse }>('/api/ai/ingest', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  compileFilter: (query: string) =>
    jsonFetch<AgGridCompileResult>('/api/ai/compile-filter', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),

  getToolkitCatalog: () =>
    jsonFetch<{ package: string; tools: ToolkitCatalogItem[] }>('/api/paypal/tools'),

  getItemPlan: (id: string) =>
    jsonFetch<{
      item: LedgerItem;
      plan: PayPalToolCallPlan;
      schemaCheck: { valid: boolean; issues: string[] };
    }>(`/api/ledger/${encodeURIComponent(id)}/plan`),

  patchItem: (id: string, updates: Partial<Pick<LedgerItem, 'costCenter' | 'notes' | 'category' | 'status'>>) =>
    jsonFetch<{ item: LedgerItem; state: LedgerStateResponse }>(
      `/api/ledger/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(updates) }
    ),

  approveItem: (id: string) =>
    jsonFetch<{ item: LedgerItem; state: LedgerStateResponse }>(
      `/api/ledger/${encodeURIComponent(id)}/approve`,
      { method: 'POST' }
    ),

  executeItem: (id: string, forceOverride = false) =>
    jsonFetch<{
      ok: boolean;
      item: LedgerItem;
      wireEntry?: WireLogEntry;
      errorMessage?: string;
      state: LedgerStateResponse;
    }>(`/api/ledger/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ forceOverride }),
    }),

  executeBatchPayout: (itemIds: string[], includeOverride = false) =>
    jsonFetch<{
      ok: boolean;
      dispatchedCount: number;
      skippedBlockedIds: string[];
      wireEntry?: WireLogEntry;
      state: LedgerStateResponse;
    }>('/api/ledger/batch-payout', {
      method: 'POST',
      body: JSON.stringify({ itemIds, includeOverride }),
    }),

  setCredentials: (clientId: string, clientSecret: string) =>
    jsonFetch<{ verified: boolean; message: string; state: LedgerStateResponse }>(
      '/api/gateway/credentials',
      { method: 'POST', body: JSON.stringify({ clientId, clientSecret }) }
    ),

  clearCredentials: () =>
    jsonFetch<{ state: LedgerStateResponse }>('/api/gateway/credentials', {
      method: 'DELETE',
    }),
};

export function detectBrowserZeroCostAi(): string {
  const nav = globalThis as unknown as {
    ai?: { languageModel?: unknown };
    LanguageModel?: unknown;
  };
  if (nav.LanguageModel || nav.ai?.languageModel) {
    return 'Hybrid: Local Rules + Chrome Prompt API Ready ($0)';
  }
  return 'Zero-Cost Deterministic AI Copilot ($0 API Billing)';
}
