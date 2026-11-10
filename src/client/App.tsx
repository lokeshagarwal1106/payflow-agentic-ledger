import type { GridApi } from 'ag-grid-community';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, detectBrowserZeroCostAi } from './api.ts';
import { AiCopilotPanel } from './components/AiCopilotPanel.tsx';
import { CredentialsModal } from './components/CredentialsModal.tsx';
import { KpiRibbon } from './components/KpiRibbon.tsx';
import { LedgerGrid } from './components/LedgerGrid.tsx';
import { TopBar } from './components/TopBar.tsx';
import { WireInspector } from './components/WireInspector.tsx';
import type {
  AgGridCompileResult,
  LedgerItem,
  LedgerStateResponse,
  PayPalToolCallPlan,
  ToolkitCatalogItem,
} from '../shared/types.ts';

export function App() {
  const [state, setState] = useState<LedgerStateResponse | null>(null);
  const [tools, setTools] = useState<ToolkitCatalogItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<LedgerItem[]>([]);
  const [selectedRows, setSelectedRows] = useState<LedgerItem[]>([]);
  const [inspectedItemId, setInspectedItemId] = useState<string | null>('row-006');
  const [inspectedPlan, setInspectedPlan] = useState<{
    plan: PayPalToolCallPlan;
    schemaCheck: { valid: boolean; issues: string[] };
  } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'plan' | 'wire' | 'tools'>('plan');
  const [quickFilterText, setQuickFilterText] = useState('');
  const [activeCompile, setActiveCompile] = useState<AgGridCompileResult | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);
  const [busyIngest, setBusyIngest] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);

  const gridApiRef = useRef<GridApi<LedgerItem> | null>(null);
  const aiLabel = detectBrowserZeroCostAi();

  const notify = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
  }, []);

  const refreshPlan = useCallback(async (id: string | null) => {
    if (!id) {
      setInspectedPlan(null);
      return;
    }
    try {
      const res = await api.getItemPlan(id);
      setInspectedPlan({ plan: res.plan, schemaCheck: res.schemaCheck });
    } catch {
      setInspectedPlan(null);
    }
  }, []);

  useEffect(() => {
    void Promise.all([api.getLedger(), api.getToolkitCatalog()]).then(([ledger, toolkit]) => {
      setState(ledger);
      setVisibleItems(ledger.items);
      setTools(toolkit.tools);
      const firstAlert = ledger.items.find((i) => i.status === 'BLOCKED_BY_POLICY') ?? ledger.items[0];
      if (firstAlert) {
        setInspectedItemId(firstAlert.id);
        void refreshPlan(firstAlert.id);
      }
    });
  }, [refreshPlan]);

  const handleSelectInspect = useCallback(
    (item: LedgerItem) => {
      setInspectedItemId(item.id);
      setInspectorTab('plan');
      void refreshPlan(item.id);
    },
    [refreshPlan]
  );

  const handleIngest = useCallback(
    async (rawText: string) => {
      setBusyIngest(true);
      try {
        const res = await api.ingestText(rawText);
        setState(res.state);
        if (res.added.length > 0) {
          setInspectedItemId(res.added[0].id);
          void refreshPlan(res.added[0].id);
          notify(`Extracted & risk-scored ${res.added.length} ledger item(s).`);
        } else {
          notify('No valid currency amounts detected in pasted text.', true);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true);
      } finally {
        setBusyIngest(false);
      }
    },
    [notify, refreshPlan]
  );

  const handleCompileFilter = useCallback(
    async (query: string): Promise<AgGridCompileResult | null> => {
      try {
        const compiled = await api.compileFilter(query);
        setActiveCompile(compiled);
        setQuickFilterText(compiled.quickFilterText);
        if (gridApiRef.current) {
          gridApiRef.current.setFilterModel(
            Object.keys(compiled.filterModel).length > 0 ? compiled.filterModel : null
          );
          gridApiRef.current.onFilterChanged();
        }
        return compiled;
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true);
        return null;
      }
    },
    [notify]
  );

  const handleChangeCap = useCallback(
    async (capUsd: number) => {
      try {
        const updated = await api.updatePolicy({ maxAutoApproveUsd: capUsd });
        setState(updated);
        if (inspectedItemId) void refreshPlan(inspectedItemId);
        notify(`Autonomous spend cap updated to $${capUsd.toLocaleString()} — ledger risk re-evaluated.`);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true);
      }
    },
    [inspectedItemId, notify, refreshPlan]
  );

  const handleExecuteItem = useCallback(
    async (id: string, forceOverride = false) => {
      setBusyAction(true);
      try {
        const res = await api.executeItem(id, forceOverride);
        setState(res.state);
        setInspectedItemId(id);
        setInspectorTab('wire');
        notify(
          `Executed ${res.wireEntry?.toolName ?? 'PayPal action'} (${res.wireEntry?.executionMode}) -> ${res.item.paypalResourceId}`
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true);
      } finally {
        setBusyAction(false);
      }
    },
    [notify]
  );

  const handleApproveItem = useCallback(
    async (id: string) => {
      setBusyAction(true);
      try {
        const res = await api.approveItem(id);
        setState(res.state);
        setInspectedItemId(id);
        void refreshPlan(id);
        notify(`Human override approved for ${res.item.referenceId}.`);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true);
      } finally {
        setBusyAction(false);
      }
    },
    [notify, refreshPlan]
  );

  const handleBatchPayout = useCallback(async () => {
    const eligibleIds = selectedRows
      .filter(
        (i) =>
          i.status !== 'SETTLED_PAYPAL' &&
          i.status !== 'DISPUTE_RESOLVED' &&
          i.status !== 'BLOCKED_BY_POLICY'
      )
      .map((i) => i.id);
    if (eligibleIds.length === 0) return;

    setBusyAction(true);
    try {
      const res = await api.executeBatchPayout(eligibleIds, false);
      setState(res.state);
      gridApiRef.current?.deselectAll();
      setInspectorTab('wire');
      notify(
        `Batch payout dispatched ${res.dispatchedCount} item(s) via ${res.wireEntry?.executionMode ?? 'PayPal'}.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), true);
    } finally {
      setBusyAction(false);
    }
  }, [notify, selectedRows]);

  const handleCellEdit = useCallback(
    async (id: string, field: 'costCenter' | 'notes', value: string) => {
      try {
        const res = await api.patchItem(id, { [field]: value });
        setState(res.state);
        notify(`Saved inline AG Grid edit (${field}) for ${res.item.referenceId}.`);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true);
      }
    },
    [notify]
  );

  const handleReset = useCallback(async () => {
    const fresh = await api.resetDemo();
    setState(fresh);
    setActiveCompile(null);
    setQuickFilterText('');
    gridApiRef.current?.setFilterModel(null);
    gridApiRef.current?.deselectAll();
    const first = fresh.items.find((i) => i.status === 'BLOCKED_BY_POLICY') ?? fresh.items[0];
    if (first) {
      setInspectedItemId(first.id);
      void refreshPlan(first.id);
    }
    notify('Workspace reset to deterministic hackathon demo dataset.');
  }, [notify, refreshPlan]);

  if (!state) {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center' }}>
        Loading PayFlow Agentic Ledger...
      </div>
    );
  }

  const inspectedItem = state.items.find((i) => i.id === inspectedItemId) ?? null;

  return (
    <div className="app-shell">
      <TopBar
        gateway={state.gateway}
        policy={state.policy}
        aiRuntimeLabel={aiLabel}
        onChangeCap={(cap) => void handleChangeCap(cap)}
        onOpenCredentials={() => setCredsOpen(true)}
        onOpenToolkit={() => setInspectorTab('tools')}
        onResetDemo={() => void handleReset()}
      />

      {toast && (
        <div className={`toast-banner ${toast.isError ? 'error' : ''}`}>
          <span>{toast.msg}</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => setToast(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <KpiRibbon
        visibleItems={visibleItems}
        selectedItems={selectedRows}
        busyBatch={busyAction}
        onExecuteBatch={() => void handleBatchPayout()}
      />

      <AiCopilotPanel
        onIngestText={handleIngest}
        onCompileFilter={handleCompileFilter}
        activeFilterCompile={activeCompile}
        busyIngest={busyIngest}
      />

      <main className="workspace-split">
        <LedgerGrid
          items={state.items}
          quickFilterText={quickFilterText}
          onQuickFilterChange={setQuickFilterText}
          onGridApiReady={(gridApi) => {
            gridApiRef.current = gridApi;
          }}
          onVisibleItemsChange={setVisibleItems}
          onSelectionChange={setSelectedRows}
          onSelectRowForInspect={handleSelectInspect}
          onCellEdit={(id, field, val) => void handleCellEdit(id, field, val)}
          onExecuteRow={(item) => void handleExecuteItem(item.id, false)}
          onApproveRow={(item) => void handleApproveItem(item.id)}
        />

        <WireInspector
          activeTab={inspectorTab}
          onChangeTab={setInspectorTab}
          selectedItem={inspectedItem}
          selectedPlan={inspectedPlan}
          wireLog={state.wireLog}
          tools={tools}
          busyAction={busyAction}
          onExecuteItem={(id, force) => void handleExecuteItem(id, force)}
          onApproveItem={(id) => void handleApproveItem(id)}
        />
      </main>

      <CredentialsModal
        open={credsOpen}
        gateway={state.gateway}
        onClose={() => setCredsOpen(false)}
        onSaveCredentials={async (cid, sec) => {
          const res = await api.setCredentials(cid, sec);
          setState(res.state);
          notify(res.message);
        }}
        onDisconnect={async () => {
          const res = await api.clearCredentials();
          setState(res.state);
          notify('Switched back to zero-cost Local Sandbox Replay mode.');
        }}
      />
    </div>
  );
}
