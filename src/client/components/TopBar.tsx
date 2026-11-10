import { KeyRound, RotateCcw, ShieldCheck, Wrench } from 'lucide-react';
import type { GatewayStatusSnapshot, PolicyConfig } from '../../shared/types.ts';

interface TopBarProps {
  gateway: GatewayStatusSnapshot;
  policy: PolicyConfig;
  aiRuntimeLabel: string;
  onChangeCap: (capUsd: number) => void;
  onOpenCredentials: () => void;
  onOpenToolkit: () => void;
  onResetDemo: () => void;
}

const CAP_OPTIONS = [500, 1000, 1500, 2500];

export function TopBar({
  gateway,
  policy,
  aiRuntimeLabel,
  onChangeCap,
  onOpenCredentials,
  onOpenToolkit,
  onResetDemo,
}: TopBarProps) {
  const isLive = gateway.executionMode === 'LIVE_SANDBOX_API';

  return (
    <header className="topbar">
      <div className="brand-group">
        <div className="brand-logo">PF</div>
        <div>
          <div className="brand-title">
            <span>PayFlow Agentic Ledger</span>
            <span className={`mode-badge ${isLive ? 'live' : 'replay'}`}>
              <ShieldCheck size={13} />
              {isLive ? 'LIVE PAYPAL SANDBOX API' : 'LOCAL SANDBOX REPLAY (₹0)'}
            </span>
          </div>
          <div className="brand-subtitle">
            {aiRuntimeLabel} · Official <span className="mono">@paypal/agent-toolkit</span> ({gateway.toolkitToolCount} tools) · AG Grid v36
          </div>
        </div>
      </div>

      <div className="topbar-controls">
        <div className="policy-pill-group" title="Autonomous Spend Cap Guardrail">
          <span>Auto-Approve Cap:</span>
          {CAP_OPTIONS.map((cap) => (
            <button
              key={cap}
              type="button"
              className={`cap-chip ${policy.maxAutoApproveUsd === cap ? 'active' : ''}`}
              onClick={() => onChangeCap(cap)}
            >
              ${cap.toLocaleString()}
            </button>
          ))}
        </div>

        <button type="button" className="btn" onClick={onOpenToolkit}>
          <Wrench size={14} />
          Toolkit ({gateway.toolkitToolCount})
        </button>

        <button type="button" className="btn" onClick={onOpenCredentials}>
          <KeyRound size={14} />
          {isLive ? 'Sandbox Connected' : 'Sandbox Keys'}
        </button>

        <button type="button" className="btn" onClick={onResetDemo}>
          <RotateCcw size={14} />
          Reset Demo
        </button>
      </div>
    </header>
  );
}
