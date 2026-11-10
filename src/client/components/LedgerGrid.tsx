import {
  AllCommunityModule,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  ModuleRegistry,
  type SelectionChangedEvent,
  colorSchemeDarkBlue,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { Download, Search } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import type { LedgerItem, LedgerStatus, RiskLevel } from '../../shared/types.ts';

ModuleRegistry.registerModules([AllCommunityModule]);

const payflowGridTheme = themeQuartz.withPart(colorSchemeDarkBlue).withParams({
  backgroundColor: '#091122',
  headerBackgroundColor: '#0e1930',
  oddRowBackgroundColor: '#0b1427',
  borderColor: 'rgba(148, 163, 184, 0.14)',
  accentColor: '#38bdf8',
  fontSize: 12,
  rowHeight: 42,
  headerHeight: 36,
});

interface LedgerGridProps {
  items: LedgerItem[];
  quickFilterText: string;
  onQuickFilterChange: (text: string) => void;
  onGridApiReady: (api: GridApi<LedgerItem>) => void;
  onVisibleItemsChange: (visible: LedgerItem[]) => void;
  onSelectionChange: (selected: LedgerItem[]) => void;
  onSelectRowForInspect: (item: LedgerItem) => void;
  onCellEdit: (id: string, field: 'costCenter' | 'notes', value: string) => void;
  onExecuteRow: (item: LedgerItem) => void;
  onApproveRow: (item: LedgerItem) => void;
}

const STATUS_BADGE: Record<LedgerStatus, { label: string; cls: string }> = {
  APPROVED: { label: 'APPROVED', cls: 'pill-approved' },
  PENDING_REVIEW: { label: 'PENDING REVIEW', cls: 'pill-pending' },
  BLOCKED_BY_POLICY: { label: 'BLOCKED POLICY', cls: 'pill-blocked' },
  SETTLED_PAYPAL: { label: 'SETTLED PAYPAL', cls: 'pill-settled' },
  DISPUTE_OPEN: { label: 'DISPUTE OPEN', cls: 'pill-dispute' },
  DISPUTE_RESOLVED: { label: 'DISPUTE CLOSED', cls: 'pill-settled' },
  FAILED: { label: 'FAILED', cls: 'pill-blocked' },
};

const RISK_CLS: Record<RiskLevel, string> = {
  LOW: 'pill-low',
  MEDIUM: 'pill-medium',
  HIGH: 'pill-high',
};

export function LedgerGrid({
  items,
  quickFilterText,
  onQuickFilterChange,
  onGridApiReady,
  onVisibleItemsChange,
  onSelectionChange,
  onSelectRowForInspect,
  onCellEdit,
  onExecuteRow,
  onApproveRow,
}: LedgerGridProps) {
  const gridApiRef = useRef<GridApi<LedgerItem> | null>(null);
  const lastVisibleSigRef = useRef<string>('');

  const syncVisibleRows = useCallback(
    (api: GridApi<LedgerItem>) => {
      const visible: LedgerItem[] = [];
      api.forEachNodeAfterFilter((node) => {
        if (node.data) visible.push(node.data);
      });
      const sig = visible.map((i) => `${i.id}:${i.status}:${i.riskScore}:${i.amountUsd}`).join('|');
      if (sig !== lastVisibleSigRef.current) {
        lastVisibleSigRef.current = sig;
        onVisibleItemsChange(visible);
      }
    },
    [onVisibleItemsChange]
  );

  const colDefs = useMemo<ColDef<LedgerItem>[]>(() => {
    const defs: ColDef<LedgerItem>[] = [
      {
        headerName: 'Ref ID',
        field: 'referenceId',
        width: 126,
        filter: 'agTextColumnFilter',
        cellRenderer: (p: ICellRendererParams<LedgerItem>) => {
          const item = p.data;
          if (!item) return null;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, justifyContent: 'center', height: '100%' }}>
              <span className="mono" style={{ color: '#38bdf8', fontWeight: 600 }}>
                {item.referenceId}
              </span>
              {item.paypalResourceId && (
                <span className="mono" style={{ fontSize: 10, color: '#64748b' }}>
                  {item.paypalResourceId.slice(0, 14)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        headerName: 'Counterparty / Email',
        field: 'payee',
        minWidth: 170,
        flex: 1,
        filter: 'agTextColumnFilter',
        cellRenderer: (p: ICellRendererParams<LedgerItem>) => {
          const item = p.data;
          if (!item) return null;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, justifyContent: 'center', height: '100%' }}>
              <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{item.payee}</span>
              <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{item.email}</span>
            </div>
          );
        },
      },
      {
        headerName: 'Type',
        field: 'actionType',
        width: 98,
        filter: 'agTextColumnFilter',
        cellRenderer: (p: ICellRendererParams<LedgerItem>) => (
          <span className="pill" style={{ background: 'rgba(148,163,184,0.14)', color: '#cbd5e1' }}>
            {p.value}
          </span>
        ),
      },
      {
        headerName: 'Cost Ctr',
        field: 'costCenter',
        width: 96,
        editable: true,
        filter: 'agTextColumnFilter',
        cellStyle: { fontFamily: 'ui-monospace, monospace', color: '#94a3b8' },
      },
      {
        headerName: 'Amount',
        field: 'amountUsd',
        width: 102,
        filter: 'agNumberColumnFilter',
        type: 'rightAligned',
        valueFormatter: (p) =>
          typeof p.value === 'number'
            ? `$${p.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '',
        cellStyle: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
      },
      {
        headerName: 'Risk',
        field: 'riskLevel',
        width: 98,
        filter: 'agTextColumnFilter',
        cellRenderer: (p: ICellRendererParams<LedgerItem>) => {
          const item = p.data;
          if (!item) return null;
          return (
            <span
              className={`pill ${RISK_CLS[item.riskLevel]}`}
              title={item.riskFactors.map((f) => `${f.label} (+${f.points})`).join(' | ') || 'No anomalies'}
            >
              {item.riskLevel} · {item.riskScore}
            </span>
          );
        },
      },
      {
        headerName: 'Status',
        field: 'status',
        width: 146,
        filter: 'agTextColumnFilter',
        cellRenderer: (p: ICellRendererParams<LedgerItem>) => {
          const badge = STATUS_BADGE[p.value as LedgerStatus] ?? {
            label: String(p.value),
            cls: 'pill-pending',
          };
          return <span className={`pill ${badge.cls}`}>{badge.label}</span>;
        },
      },
      {
        headerName: 'Toolkit Action',
        field: 'recommendedTool',
        width: 148,
        filter: 'agTextColumnFilter',
        cellStyle: { fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#38bdf8' },
      },
      {
        headerName: 'Notes (Editable)',
        field: 'notes',
        minWidth: 150,
        flex: 0.9,
        editable: true,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'PayPal Ops',
        field: 'id',
        width: 116,
        pinned: 'right',
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<LedgerItem>) => {
          const item = p.data;
          if (!item) return null;
          if (item.status === 'SETTLED_PAYPAL' || item.status === 'DISPUTE_RESOLVED') {
            return (
              <button
                type="button"
                className="btn btn-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRowForInspect(item);
                }}
              >
                Inspect ID
              </button>
            );
          }
          if (item.status === 'BLOCKED_BY_POLICY') {
            return (
              <button
                type="button"
                className="btn btn-amber btn-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onApproveRow(item);
                }}
              >
                Override
              </button>
            );
          }
          return (
            <button
              type="button"
              className="btn btn-emerald btn-xs"
              onClick={(e) => {
                e.stopPropagation();
                onExecuteRow(item);
              }}
            >
              Run PayPal
            </button>
          );
        },
      },
    ];
    return defs;
  }, [onApproveRow, onExecuteRow, onSelectRowForInspect]);

  const defaultColDef = useMemo<ColDef<LedgerItem>>(
    () => ({
      sortable: true,
      resizable: true,
      floatingFilter: true,
    }),
    []
  );

  const handleGridReady = useCallback(
    (e: GridReadyEvent<LedgerItem>) => {
      gridApiRef.current = e.api;
      onGridApiReady(e.api);
      syncVisibleRows(e.api);
    },
    [onGridApiReady, syncVisibleRows]
  );

  const handleSelectionChanged = useCallback(
    (e: SelectionChangedEvent<LedgerItem>) => {
      onSelectionChange(e.api.getSelectedRows());
    },
    [onSelectionChange]
  );

  const handleCellValueChanged = useCallback(
    (e: CellValueChangedEvent<LedgerItem>) => {
      const field = e.colDef.field;
      if (e.data && (field === 'costCenter' || field === 'notes')) {
        onCellEdit(e.data.id, field, String(e.newValue ?? ''));
      }
    },
    [onCellEdit]
  );

  return (
    <div className="grid-panel">
      <div className="grid-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 220 }}>
          <Search size={14} color="#64748b" />
          <input
            type="text"
            className="text-input"
            style={{ maxWidth: 320 }}
            value={quickFilterText}
            onChange={(e) => onQuickFilterChange(e.target.value)}
            placeholder="Instant AG Grid QuickFilter across all columns..."
          />
          <span style={{ fontSize: 11, color: '#64748b' }}>Double-click Cost Center or Notes to edit</span>
        </div>

        <button
          type="button"
          className="btn btn-xs"
          onClick={() => gridApiRef.current?.exportDataAsCsv({ fileName: 'payflow-ledger-export.csv' })}
        >
          <Download size={12} />
          Export CSV
        </button>
      </div>

      <div className="ag-wrapper">
        <AgGridReact<LedgerItem>
          theme={payflowGridTheme}
          rowData={items}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          quickFilterText={quickFilterText}
          rowSelection={{
            mode: 'multiRow',
            checkboxes: true,
            headerCheckbox: true,
            enableClickSelection: false,
          }}
          getRowId={(params) => params.data.id}
          onGridReady={handleGridReady}
          onFilterChanged={(e) => syncVisibleRows(e.api)}
          onModelUpdated={(e) => syncVisibleRows(e.api)}
          onSelectionChanged={handleSelectionChanged}
          onRowClicked={(e) => {
            if (e.data) onSelectRowForInspect(e.data);
          }}
          onCellValueChanged={handleCellValueChanged}
          animateRows
        />
      </div>
    </div>
  );
}
