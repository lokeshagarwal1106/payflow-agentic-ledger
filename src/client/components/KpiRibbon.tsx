import { Send } from 'lucide-react';
import type { LedgerItem } from '../../shared/types.ts';

interface KpiRibbonProps {
  visibleItems: LedgerItem[];
  selectedItems: LedgerItem[];
  busyBatch: boolean;
  onExecuteBatch: () => void;
}

function formatUsd(val: number): string {
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function KpiRibbon({
  visibleItems,
  selectedItems,
  busyBatch,
  onExecuteBatch,
}: KpiRibbonProps) {
  const totalVolume = visibleItems.reduce((acc, i) => acc + i.amountUsd, 0);
  const approvedItems = visibleItems.filter((i) => i.status === 'APPROVED');
  const approvedVolume = approvedItems.reduce((acc, i) => acc + i.amountUsd, 0);
  const blockedItems = visibleItems.filter(
    (i) => i.status === 'BLOCKED_BY_POLICY' || i.riskLevel === 'HIGH'
  );
  const blockedVolume = blockedItems.reduce((acc, i) => acc + i.amountUsd, 0);
  const settledItems = visibleItems.filter(
    (i) => i.status === 'SETTLED_PAYPAL' || i.status === 'DISPUTE_RESOLVED'
  );
  const settledVolume = settledItems.reduce((acc, i) => acc + i.amountUsd, 0);

  const selectedEligible = selectedItems.filter(
    (i) =>
      i.status !== 'SETTLED_PAYPAL' &&
      i.status !== 'DISPUTE_RESOLVED' &&
      i.status !== 'BLOCKED_BY_POLICY'
  );
  const selectedTotal = selectedEligible.reduce((acc, i) => acc + i.amountUsd, 0);

  return (
    <section className="kpi-ribbon">
      <div className="kpi-card">
        <span className="kpi-label">Visible AG Grid Volume</span>
        <span className="kpi-value">{formatUsd(totalVolume)}</span>
        <span className="kpi-sub">{visibleItems.length} rows matching active filter</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Ready for PayPal</span>
        <span className="kpi-value" style={{ color: '#34d399' }}>
          {formatUsd(approvedVolume)}
        </span>
        <span className="kpi-sub">{approvedItems.length} policy-cleared items</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Risk Guard Blocked</span>
        <span className="kpi-value" style={{ color: '#fb7185' }}>
          {formatUsd(blockedVolume)}
        </span>
        <span className="kpi-sub">{blockedItems.length} flagged duplicate/cap alerts</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Settled via PayPal</span>
        <span className="kpi-value" style={{ color: '#38bdf8' }}>
          {formatUsd(settledVolume)}
        </span>
        <span className="kpi-sub">{settledItems.length} completed sandbox IDs</span>
      </div>

      <div className="kpi-card actionable">
        <div>
          <span className="kpi-label">Selected Batch Payout</span>
          <div className="kpi-value" style={{ fontSize: 16 }}>
            {selectedEligible.length} ready · {formatUsd(selectedTotal)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-xs"
          disabled={busyBatch || selectedEligible.length === 0}
          onClick={onExecuteBatch}
        >
          <Send size={12} />
          {busyBatch ? 'Dispatching...' : 'Run PayPal Batch Payout'}
        </button>
      </div>
    </section>
  );
}
