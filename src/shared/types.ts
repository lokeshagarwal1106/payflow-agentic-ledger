export type ExecutionMode = 'LIVE_SANDBOX_API' | 'LOCAL_SANDBOX_REPLAY';

export type LedgerActionType = 'PAYOUT' | 'INVOICE' | 'ORDER' | 'DISPUTE' | 'REFUND';

export type LedgerStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'BLOCKED_BY_POLICY'
  | 'SETTLED_PAYPAL'
  | 'DISPUTE_OPEN'
  | 'DISPUTE_RESOLVED'
  | 'FAILED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskFactor {
  code:
    | 'DUPLICATE_PAYEE_AMOUNT'
    | 'EXCEEDS_AUTO_APPROVE_CAP'
    | 'SPLIT_STRUCTURING'
    | 'URGENCY_BYPASS_SIGNAL'
    | 'EMAIL_DOMAIN_ANOMALY';
  label: string;
  points: number;
  detail: string;
}

export interface PolicyConfig {
  maxAutoApproveUsd: number;
  blockRiskScoreAtOrAbove: number;
  allowDuplicateOverride: boolean;
}

export interface PayPalToolCallPlan {
  toolName: string;
  sdkLayer: '@paypal/agent-toolkit/ai-sdk' | 'PayPal REST Payouts v1';
  httpMethod: 'GET' | 'POST';
  endpoint: string;
  payload: Record<string, unknown>;
  rationale: string;
}

export interface LedgerItem {
  id: string;
  referenceId: string;
  payee: string;
  email: string;
  actionType: LedgerActionType;
  category: string;
  costCenter: string;
  amountUsd: number;
  currency: 'USD';
  status: LedgerStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
  recommendedTool: string;
  paypalResourceId: string | null;
  executionMode: ExecutionMode | null;
  sourceExcerpt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerItemInput {
  referenceId?: string;
  payee: string;
  email: string;
  actionType: LedgerActionType;
  category: string;
  costCenter?: string;
  amountUsd: number;
  sourceExcerpt: string;
  notes?: string;
}

export interface WireLogEntry {
  id: string;
  timestamp: string;
  executionMode: ExecutionMode;
  ledgerItemIds: string[];
  toolName: string;
  httpMethod: 'GET' | 'POST';
  endpoint: string;
  statusCode: number;
  paypalDebugId: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  latencyMs: number;
}

export interface ToolkitCatalogItem {
  name: string;
  description: string;
  category: string;
  parameterKeys: string[];
}

export interface GatewayStatusSnapshot {
  executionMode: ExecutionMode;
  sandboxBaseUrl: string;
  hasCredentials: boolean;
  credentialSource: 'NONE' | 'ENV' | 'SESSION';
  toolkitPackage: '@paypal/agent-toolkit';
  toolkitToolCount: number;
  lastOAuthVerifiedAt: string | null;
}

export interface LedgerStateResponse {
  items: LedgerItem[];
  wireLog: WireLogEntry[];
  policy: PolicyConfig;
  gateway: GatewayStatusSnapshot;
}

export interface ParsedAiCandidate {
  referenceId: string;
  payee: string;
  email: string;
  actionType: LedgerActionType;
  category: string;
  costCenter: string;
  amountUsd: number;
  sourceExcerpt: string;
  confidence: number;
  extractionNotes: string;
}

export interface AgGridCompileResult {
  query: string;
  filterModel: Record<string, unknown>;
  quickFilterText: string;
  matchedSummary: string[];
}
