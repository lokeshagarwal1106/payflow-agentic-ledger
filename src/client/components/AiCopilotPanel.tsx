import { Filter, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import type { AgGridCompileResult } from '../../shared/types.ts';

interface AiCopilotPanelProps {
  onIngestText: (rawText: string) => Promise<void>;
  onCompileFilter: (query: string) => Promise<AgGridCompileResult | null>;
  activeFilterCompile: AgGridCompileResult | null;
  busyIngest: boolean;
}

const INGEST_SAMPLES: Array<{ label: string; text: string }> = [
  {
    label: 'Contractor Sprint Batch',
    text:
      'From: Maya Kapoor <maya.kapoor@sandbox.example.com> - Completed i18n accessibility audit for $420 USD payout.\n' +
      'Pay Jordan Reyes (jordan.reyes@sandbox.example.com) $650 USD for CI pipeline migration.',
  },
  {
    label: 'Duplicate Fraud Trap',
    text:
      'From: Kestrel Cloud Labs <ap@kestrel-labs.example.com> - Re-sending invoice INV-2026-405C for November telemetry cluster $1,420.00 USD.',
  },
  {
    label: 'Order + Dispute Mix',
    text:
      'Checkout order ORD-2026-991 for Nimbus Security Portal <orders@nimbus.example.com> — $310 USD.\n' +
      'Customer opened chargeback dispute PP-D-9900112233445566 ($95 USD) from buyer@sandbox.example.com.',
  },
];

const FILTER_PRESETS = [
  'high risk blocked',
  'approved payouts over 500',
  'pending or blocked under 1500',
  'disputes or refunds',
  'clear filters',
];

export function AiCopilotPanel({
  onIngestText,
  onCompileFilter,
  activeFilterCompile,
  busyIngest,
}: AiCopilotPanelProps) {
  const [ingestDraft, setIngestDraft] = useState(INGEST_SAMPLES[0].text);
  const [nlQuery, setNlQuery] = useState('');

  async function handleIngest() {
    if (!ingestDraft.trim()) return;
    await onIngestText(ingestDraft);
  }

  async function handleFilterRun(queryToRun?: string) {
    const q = (queryToRun ?? nlQuery).trim();
    if (queryToRun !== undefined) {
      setNlQuery(queryToRun === 'clear filters' ? '' : queryToRun);
    }
    await onCompileFilter(q || 'clear');
  }

  return (
    <section className="copilot-grid">
      {/* Unstructured AI Ingestion */}
      <div className="panel-card">
        <div className="panel-header">
          <div className="panel-title">
            <Sparkles size={14} color="#38bdf8" />
            <span>AI Receipt & Email Ingest</span>
          </div>
          <div className="sample-row">
            {INGEST_SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                className="chip-btn"
                onClick={() => setIngestDraft(sample.text)}
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        <div className="input-row">
          <textarea
            className="textarea-input"
            value={ingestDraft}
            onChange={(e) => setIngestDraft(e.target.value)}
            placeholder="Paste messy contractor emails, invoices, or chat payment requests..."
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyIngest || !ingestDraft.trim()}
            onClick={() => void handleIngest()}
          >
            {busyIngest ? 'Parsing...' : 'Extract & Risk Score'}
          </button>
        </div>
      </div>

      {/* Natural Language -> AG Grid FilterModel Compiler */}
      <div className="panel-card">
        <div className="panel-header">
          <div className="panel-title">
            <Filter size={14} color="#34d399" />
            <span>AI Natural Language → AG Grid Filter Compiler</span>
          </div>
        </div>

        <div className="sample-row">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip-btn"
              onClick={() => void handleFilterRun(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handleFilterRun();
          }}
        >
          <input
            type="text"
            className="text-input"
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            placeholder='Try: "high risk pending payouts over 500" or "disputes under 500"'
          />
          <button type="submit" className="btn btn-emerald">
            Apply Grid Filter
          </button>
          {activeFilterCompile &&
            (Object.keys(activeFilterCompile.filterModel).length > 0 ||
              activeFilterCompile.quickFilterText) && (
              <button
                type="button"
                className="btn"
                title="Clear filter"
                onClick={() => void handleFilterRun('clear filters')}
              >
                <X size={13} />
              </button>
            )}
        </form>

        <div className="filter-ast-box">
          <span>
            {activeFilterCompile && activeFilterCompile.matchedSummary.length > 0
              ? `Compiled: ${activeFilterCompile.matchedSummary.join(' AND ')}`
              : 'Ready: Compiles English predicates into AG Grid FilterModel JSON + QuickFilter.'}
          </span>
          {activeFilterCompile &&
            Object.keys(activeFilterCompile.filterModel).length > 0 && (
              <span className="mono" style={{ color: '#38bdf8' }}>
                {JSON.stringify(activeFilterCompile.filterModel)}
              </span>
            )}
        </div>
      </div>
    </section>
  );
}
