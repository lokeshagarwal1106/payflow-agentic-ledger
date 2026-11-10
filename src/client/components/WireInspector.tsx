import { AlertTriangle, CheckCircle2, Play, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type {
  LedgerItem,
  PayPalToolCallPlan,
  ToolkitCatalogItem,
  WireLogEntry,
} from '../../shared/types.ts';

interface WireInspectorProps {
  activeTab: 'plan' | 'wire' | 'tools';
  onChangeTab: (tab: 'plan' | 'wire' | 'tools') => void;
  selectedItem: LedgerItem | null;
  selectedPlan: { plan: PayPalToolCallPlan; schemaCheck: { valid: boolean; issues: string[] } } | null;
  wireLog: WireLogEntry[];
  tools: ToolkitCatalogItem[];
  busyAction: boolean;
  onExecuteItem: (id: string, forceOverride?: boolean) => void;
  onApproveItem: (id: string) => void;
}

export function WireInspector({
  activeTab,
  onChangeTab,
  selectedItem,
  selectedPlan,
  wireLog,
  tools,
  busyAction,
  onExecuteItem,
  onApproveItem,
}: WireInspectorProps) {
  const [toolFilter, setToolFilter] = useState('');

  const filteredTools = tools.filter(
    (t) =>
      !toolFilter.trim() ||
      t.name.toLowerCase().includes(toolFilter.toLowerCase()) ||
      t.category.toLowerCase().includes(toolFilter.toLowerCase())
  );

  return (
    <aside className="inspector-panel">
      <div className="tab-bar">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'plan' ? 'active' : ''}`}
          onClick={() => onChangeTab('plan')}
        >
          Agent Plan
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'wire' ? 'active' : ''}`}
          onClick={() => onChangeTab('wire')}
        >
          Wire Log ({wireLog.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => onChangeTab('tools')}
        >
          Toolkit ({tools.length})
        </button>
      </div>

      {activeTab === 'plan' && (
        <div className="inspector-body">
          {!selectedItem ? (
            <div style={{ color: '#94a3b8' }}>
              Click any row in AG Grid to inspect AI fraud factors and its PayPal Agent Toolkit plan.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{selectedItem.payee}</div>
                  <div className="mono" style={{ fontSize: 11, color: '#38bdf8' }}>
                    {selectedItem.referenceId} · ${selectedItem.amountUsd.toFixed(2)} {selectedItem.currency}
                  </div>
                </div>
                <span className="pill" style={{ background: 'rgba(148,163,184,0.14)', color: '#cbd5e1' }}>
                  Risk {selectedItem.riskScore}/100
                </span>
              </div>

              <div style={{ fontSize: 11.5, color: '#94a3b8', background: '#091020', padding: 8, borderRadius: 7, border: '1px solid rgba(148,163,184,0.14)' }}>
                <strong style={{ color: '#cbd5e1' }}>Source Input:</strong> {selectedItem.sourceExcerpt}
              </div>

              {selectedItem.riskFactors.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fb7185', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <AlertTriangle size={12} /> Risk & Policy Guardrails Triggered
                  </div>
                  {selectedItem.riskFactors.map((rf, idx) => (
                    <div key={`${rf.code}-${idx}`} className="factor-card">
                      <div style={{ fontWeight: 700, color: '#fda4af' }}>
                        {rf.label} (+{rf.points} pts)
                      </div>
                      <div style={{ color: '#cbd5e1', marginTop: 2 }}>{rf.detail}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={13} /> Clean treasury checks: zero duplicate or structuring risk.
                </div>
              )}

              {selectedPlan && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                      Tool: <span className="mono" style={{ color: '#38bdf8' }}>{selectedPlan.plan.toolName}</span>
                    </span>
                    <span className="pill pill-approved">
                      {selectedPlan.schemaCheck.valid ? 'Zod Validated' : 'Schema Issue'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {selectedPlan.plan.httpMethod} <span className="mono">{selectedPlan.plan.endpoint}</span> ({selectedPlan.plan.sdkLayer})
                  </div>
                  <pre className="code-block" style={{ maxHeight: 118, overflowY: 'auto' }}>
                    {JSON.stringify(selectedPlan.plan.payload, null, 2)}
                  </pre>
                </>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                {selectedItem.status === 'BLOCKED_BY_POLICY' && (
                  <button
                    type="button"
                    className="btn btn-amber"
                    style={{ flex: 1 }}
                    disabled={busyAction}
                    onClick={() => onApproveItem(selectedItem.id)}
                  >
                    <ShieldAlert size={13} />
                    Human Override & Approve
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={
                    busyAction ||
                    selectedItem.status === 'SETTLED_PAYPAL' ||
                    selectedItem.status === 'DISPUTE_RESOLVED'
                  }
                  onClick={() => onExecuteItem(selectedItem.id, selectedItem.status === 'BLOCKED_BY_POLICY')}
                >
                  <Play size={13} />
                  {selectedItem.status === 'BLOCKED_BY_POLICY'
                    ? 'Force Execute Sandbox'
                    : 'Execute via PayPal'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'wire' && (
        <div className="inspector-body">
          {wireLog.length === 0 ? (
            <div style={{ color: '#94a3b8' }}>
              No PayPal API or Replay calls logged yet. Click &quot;Run PayPal&quot; on a ledger row or dispatch a Batch Payout!
            </div>
          ) : (
            wireLog.map((entry) => (
              <div key={entry.id} className="wire-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontWeight: 700, color: '#38bdf8', fontSize: 11.5 }}>
                    {entry.httpMethod} {entry.endpoint}
                  </span>
                  <span className={`pill ${entry.statusCode < 300 ? 'pill-approved' : 'pill-blocked'}`}>
                    HTTP {entry.statusCode} · {entry.latencyMs}ms
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                  Mode: <strong>{entry.executionMode}</strong> · Tool: <span className="mono">{entry.toolName}</span> · Debug ID: <span className="mono">{entry.paypalDebugId}</span>
                </div>
                <pre className="code-block" style={{ maxHeight: 150, overflowY: 'auto' }}>
                  {JSON.stringify(entry.responsePayload, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'tools' && (
        <div className="inspector-body">
          <input
            type="text"
            className="text-input"
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            placeholder="Filter 47 official @paypal/agent-toolkit tools..."
          />
          {filteredTools.map((t) => (
            <div key={t.name} className="wire-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono" style={{ fontWeight: 700, color: '#38bdf8' }}>
                  {t.name}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{t.category}</span>
              </div>
              <div style={{ fontSize: 11, color: '#cbd5e1' }}>{t.description}</div>
              {t.parameterKeys.length > 0 && (
                <div className="mono" style={{ fontSize: 10, color: '#64748b' }}>
                  params: {t.parameterKeys.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
