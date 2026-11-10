import type { AgGridCompileResult, LedgerActionType, LedgerStatus, RiskLevel } from './types.ts';

const STATUS_ALIASES: Record<string, LedgerStatus> = {
  pending: 'PENDING_REVIEW',
  review: 'PENDING_REVIEW',
  approved: 'APPROVED',
  ready: 'APPROVED',
  blocked: 'BLOCKED_BY_POLICY',
  rejected: 'BLOCKED_BY_POLICY',
  settled: 'SETTLED_PAYPAL',
  paid: 'SETTLED_PAYPAL',
  completed: 'SETTLED_PAYPAL',
  resolved: 'DISPUTE_RESOLVED',
};

const ACTION_ALIASES: Record<string, LedgerActionType> = {
  payout: 'PAYOUT',
  payouts: 'PAYOUT',
  invoice: 'INVOICE',
  invoices: 'INVOICE',
  order: 'ORDER',
  orders: 'ORDER',
  dispute: 'DISPUTE',
  disputes: 'DISPUTE',
  refund: 'REFUND',
  refunds: 'REFUND',
};

const RISK_ALIASES: Record<string, RiskLevel> = {
  high: 'HIGH',
  critical: 'HIGH',
  medium: 'MEDIUM',
  med: 'MEDIUM',
  low: 'LOW',
  safe: 'LOW',
};

function buildTextOrFilter(values: string[]) {
  if (values.length === 1) {
    return {
      filterType: 'text',
      type: 'equals',
      filter: values[0],
    };
  }
  return {
    filterType: 'text',
    operator: 'OR',
    conditions: values.slice(0, 2).map((value) => ({
      filterType: 'text',
      type: 'equals',
      filter: value,
    })),
  };
}

export function compileNaturalLanguageToAgGridFilter(rawQuery: string): AgGridCompileResult {
  const query = rawQuery.trim();
  if (!query || /^(clear|reset|all|show all|clear filters?|reset filters?|clear all)$/i.test(query)) {
    return {
      query,
      filterModel: {},
      quickFilterText: '',
      matchedSummary: query ? ['Cleared all active column and quick filters'] : [],
    };
  }

  let working = query.toLowerCase();
  const filterModel: Record<string, unknown> = {};
  const matchedSummary: string[] = [];

  // 1. Numeric range filter: "between 300 and 1500"
  const rangeMatch = working.match(
    /\bbetween\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s+(?:and|to)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i
  );
  if (rangeMatch) {
    const low = Number.parseFloat(rangeMatch[1].replace(/,/g, ''));
    const high = Number.parseFloat(rangeMatch[2].replace(/,/g, ''));
    if (!Number.isNaN(low) && !Number.isNaN(high)) {
      const min = Math.min(low, high);
      const max = Math.max(low, high);
      filterModel.amountUsd = {
        filterType: 'number',
        type: 'inRange',
        filter: min,
        filterTo: max,
      };
      matchedSummary.push(`amountUsd IN [$${min}, $${max}]`);
      working = working.replace(rangeMatch[0], ' ');
    }
  } else {
    // 2. Threshold filters: "over 500", "> $1000", "under 400", "< 1200"
    const gtMatch = working.match(
      /\b(?:over|above|greater than|more than|at least|>=?)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i
    );
    const ltMatch = working.match(
      /\b(?:under|below|less than|<=?)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i
    );
    const gtSymbol = !gtMatch
      ? working.match(/(?:>=|>)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i)
      : null;
    const ltSymbol = !ltMatch
      ? working.match(/(?:<=|<)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i)
      : null;

    const gtFinal = gtMatch ?? gtSymbol;
    const ltFinal = ltMatch ?? ltSymbol;

    const conditions: Record<string, unknown>[] = [];
    if (gtFinal) {
      const val = Number.parseFloat(gtFinal[1].replace(/,/g, ''));
      if (!Number.isNaN(val)) {
        conditions.push({ filterType: 'number', type: 'greaterThan', filter: val });
        matchedSummary.push(`amountUsd > $${val}`);
        working = working.replace(gtFinal[0], ' ');
      }
    }
    if (ltFinal) {
      const val = Number.parseFloat(ltFinal[1].replace(/,/g, ''));
      if (!Number.isNaN(val)) {
        conditions.push({ filterType: 'number', type: 'lessThan', filter: val });
        matchedSummary.push(`amountUsd < $${val}`);
        working = working.replace(ltFinal[0], ' ');
      }
    }
    if (conditions.length === 1) {
      filterModel.amountUsd = conditions[0];
    } else if (conditions.length >= 2) {
      filterModel.amountUsd = {
        filterType: 'number',
        operator: 'AND',
        conditions: conditions.slice(0, 2),
      };
    }
  }

  // 3. Risk level detection ("high risk", "flagged", "medium risk", "low risk")
  const matchedRisks = new Set<RiskLevel>();
  if (/\bflagged\b/i.test(working)) {
    matchedRisks.add('HIGH');
    matchedRisks.add('MEDIUM');
    working = working.replace(/\bflagged\b/gi, ' ');
  }
  for (const [alias, level] of Object.entries(RISK_ALIASES)) {
    const regex = new RegExp(`\\b${alias}(?:\\s+risk)?\\b`, 'i');
    if (regex.test(working)) {
      matchedRisks.add(level);
      working = working.replace(regex, ' ');
    }
  }
  working = working.replace(/\brisk\b/gi, ' ');
  if (matchedRisks.size > 0) {
    const vals = [...matchedRisks];
    filterModel.riskLevel = buildTextOrFilter(vals);
    matchedSummary.push(`riskLevel = ${vals.join(' OR ')}`);
  }

  // 4. Status detection ("pending", "approved", "blocked", "settled", "paid")
  const matchedStatuses = new Set<LedgerStatus>();
  for (const [alias, status] of Object.entries(STATUS_ALIASES)) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(working)) {
      matchedStatuses.add(status);
      working = working.replace(regex, ' ');
    }
  }
  if (matchedStatuses.size > 0) {
    const vals = [...matchedStatuses];
    filterModel.status = buildTextOrFilter(vals);
    matchedSummary.push(`status = ${vals.join(' OR ')}`);
  }

  // 5. Action type detection ("payout", "invoice", "order", "dispute", "refund")
  const matchedActions = new Set<LedgerActionType>();
  for (const [alias, action] of Object.entries(ACTION_ALIASES)) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(working)) {
      matchedActions.add(action);
      working = working.replace(regex, ' ');
    }
  }
  if (matchedActions.size > 0) {
    const vals = [...matchedActions];
    filterModel.actionType = buildTextOrFilter(vals);
    matchedSummary.push(`actionType = ${vals.join(' OR ')}`);
  }

  // 6. Residual meaningful keywords -> Quick Filter across Payee, Email, Category, Notes
  const stopWords = new Set(['show', 'me', 'all', 'find', 'filter', 'by', 'with', 'and', 'or', 'items', 'records', 'transactions', 'for', 'the', 'only', 'that', 'are']);
  const remainingTokens = working
    .replace(/[^a-z0-9@._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));

  const quickFilterText = remainingTokens.join(' ');
  if (quickFilterText) {
    matchedSummary.push(`quickFilter ~ "${quickFilterText}"`);
  }

  return {
    query,
    filterModel,
    quickFilterText,
    matchedSummary,
  };
}
