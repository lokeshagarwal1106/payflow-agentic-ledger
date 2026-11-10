import type {
  LedgerActionType,
  LedgerItem,
  LedgerStatus,
  PolicyConfig,
  RiskFactor,
  RiskLevel,
} from './types.ts';

export const DEFAULT_POLICY: PolicyConfig = {
  maxAutoApproveUsd: 1500,
  blockRiskScoreAtOrAbove: 65,
  allowDuplicateOverride: false,
};

const URGENCY_PATTERNS = [
  'urgent',
  'skip approval',
  'wire immediately',
  'asap today',
  'bypass',
  'do not verify',
  'override cap',
  'rush payment',
];

const FREE_PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'proton.me',
  'mailinator.com',
  'tempmail.com',
]);

function normalizePayee(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isDuplicateCandidate(
  candidate: { id?: string; payee: string; email: string; amountUsd: number; referenceId?: string },
  existing: LedgerItem
): boolean {
  if (candidate.id && candidate.id === existing.id) {
    return false;
  }
  const sameEmail = candidate.email.toLowerCase() === existing.email.toLowerCase();
  const samePayee = normalizePayee(candidate.payee) === normalizePayee(existing.payee);
  if (!sameEmail && !samePayee) {
    return false;
  }
  const deltaRatio =
    existing.amountUsd > 0
      ? Math.abs(candidate.amountUsd - existing.amountUsd) / existing.amountUsd
      : 1;
  return deltaRatio <= 0.005;
}

function detectSplitStructuring(
  candidate: { id?: string; payee: string; email: string; amountUsd: number; actionType: LedgerActionType },
  peers: LedgerItem[],
  policy: PolicyConfig
): RiskFactor | null {
  if (candidate.actionType === 'DISPUTE' || candidate.actionType === 'REFUND') {
    return null;
  }
  if (candidate.amountUsd > policy.maxAutoApproveUsd) {
    return null;
  }
  const activePeers = peers.filter(
    (p) =>
      p.id !== candidate.id &&
      p.status !== 'SETTLED_PAYPAL' &&
      p.status !== 'DISPUTE_RESOLVED' &&
      (p.email.toLowerCase() === candidate.email.toLowerCase() ||
        normalizePayee(p.payee) === normalizePayee(candidate.payee))
  );
  if (activePeers.length === 0) {
    return null;
  }
  const combinedTotal =
    candidate.amountUsd + activePeers.reduce((acc, item) => acc + item.amountUsd, 0);
  if (combinedTotal > policy.maxAutoApproveUsd) {
    return {
      code: 'SPLIT_STRUCTURING',
      label: 'Split-transaction cap structuring',
      points: 35,
      detail: `${activePeers.length + 1} concurrent requests for ${candidate.payee} total $${combinedTotal.toFixed(2)}, exceeding the $${policy.maxAutoApproveUsd.toFixed(0)} auto-approve cap.`,
    };
  }
  return null;
}

export function recommendToolForAction(actionType: LedgerActionType): string {
  switch (actionType) {
    case 'INVOICE':
      return 'create_invoice';
    case 'ORDER':
      return 'create_order';
    case 'DISPUTE':
      return 'get_dispute';
    case 'REFUND':
      return 'create_refund';
    case 'PAYOUT':
    default:
      return 'create_batch_payout';
  }
}

export interface RiskEvaluation {
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
  shouldBlock: boolean;
  recommendedStatus: LedgerStatus;
}

export function evaluateLedgerRisk(
  candidate: {
    id?: string;
    referenceId?: string;
    payee: string;
    email: string;
    amountUsd: number;
    actionType: LedgerActionType;
    sourceExcerpt: string;
    notes?: string;
    currentStatus?: LedgerStatus;
  },
  existingItems: LedgerItem[],
  policy: PolicyConfig = DEFAULT_POLICY
): RiskEvaluation {
  const riskFactors: RiskFactor[] = [];

  // Preserve terminal settled statuses while still reporting underlying audit factors.
  const isAlreadySettled =
    candidate.currentStatus === 'SETTLED_PAYPAL' ||
    candidate.currentStatus === 'DISPUTE_RESOLVED';

  const duplicateMatch = existingItems.find((item) => isDuplicateCandidate(candidate, item));
  if (duplicateMatch) {
    riskFactors.push({
      code: 'DUPLICATE_PAYEE_AMOUNT',
      label: 'Duplicate payee & amount detected',
      points: 45,
      detail: `Matches existing record ${duplicateMatch.referenceId} (${duplicateMatch.payee}, $${duplicateMatch.amountUsd.toFixed(2)}).`,
    });
  }

  if (candidate.amountUsd > policy.maxAutoApproveUsd) {
    const severe = candidate.amountUsd > policy.maxAutoApproveUsd * 2;
    riskFactors.push({
      code: 'EXCEEDS_AUTO_APPROVE_CAP',
      label: severe ? 'Severe spend-cap exceedance' : 'Exceeds auto-approve threshold',
      points: severe ? 40 : 30,
      detail: `$${candidate.amountUsd.toFixed(2)} exceeds active $${policy.maxAutoApproveUsd.toFixed(0)} autonomous limit.`,
    });
  }

  const structuringSignal = detectSplitStructuring(candidate, existingItems, policy);
  if (structuringSignal) {
    riskFactors.push(structuringSignal);
  }

  const combinedText = `${candidate.sourceExcerpt} ${candidate.notes ?? ''}`.toLowerCase();
  const matchedUrgency = URGENCY_PATTERNS.filter((phrase) => combinedText.includes(phrase));
  if (matchedUrgency.length > 0) {
    riskFactors.push({
      code: 'URGENCY_BYPASS_SIGNAL',
      label: 'Urgency / policy-bypass language',
      points: 25,
      detail: `Triggered keyword guardrails: "${matchedUrgency.join('", "')}".`,
    });
  }

  const emailParts = candidate.email.toLowerCase().split('@');
  const domain = emailParts[1] ?? '';
  if (!domain || !domain.includes('.')) {
    riskFactors.push({
      code: 'EMAIL_DOMAIN_ANOMALY',
      label: 'Invalid recipient PayPal email',
      points: 35,
      detail: `Email "${candidate.email}" is missing a valid PayPal domain.`,
    });
  } else if (FREE_PERSONAL_DOMAINS.has(domain) && candidate.amountUsd >= 1000) {
    riskFactors.push({
      code: 'EMAIL_DOMAIN_ANOMALY',
      label: 'Unverified webmail for high value',
      points: 20,
      detail: `High-value request ($${candidate.amountUsd.toFixed(2)}) targets unverified domain "${domain}".`,
    });
  }

  const rawScore = riskFactors.reduce((sum, factor) => sum + factor.points, 0);
  const riskScore = Math.max(0, Math.min(100, rawScore));
  const riskLevel: RiskLevel =
    riskScore >= 65 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW';

  const hasDuplicateBlock =
    !policy.allowDuplicateOverride &&
    riskFactors.some((factor) => factor.code === 'DUPLICATE_PAYEE_AMOUNT');

  const shouldBlock =
    riskScore >= policy.blockRiskScoreAtOrAbove ||
    hasDuplicateBlock ||
    (candidate.amountUsd > policy.maxAutoApproveUsd && candidate.actionType === 'PAYOUT');

  let recommendedStatus: LedgerStatus;
  if (isAlreadySettled && candidate.currentStatus) {
    recommendedStatus = candidate.currentStatus;
  } else if (candidate.actionType === 'DISPUTE') {
    recommendedStatus = 'DISPUTE_OPEN';
  } else if (shouldBlock) {
    recommendedStatus = 'BLOCKED_BY_POLICY';
  } else if (riskLevel === 'LOW') {
    recommendedStatus = 'APPROVED';
  } else {
    recommendedStatus = 'PENDING_REVIEW';
  }

  return {
    riskScore,
    riskLevel,
    riskFactors,
    shouldBlock,
    recommendedStatus,
  };
}
