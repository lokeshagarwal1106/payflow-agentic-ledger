import { KeyRound, X } from 'lucide-react';
import { useState } from 'react';
import type { GatewayStatusSnapshot } from '../../shared/types.ts';

interface CredentialsModalProps {
  open: boolean;
  gateway: GatewayStatusSnapshot;
  onClose: () => void;
  onSaveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function CredentialsModal({
  open,
  gateway,
  onClose,
  onSaveCredentials,
  onDisconnect,
}: CredentialsModalProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    try {
      await onSaveCredentials(clientId, clientSecret);
      setClientId('');
      setClientSecret('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="panel-title">
            <KeyRound size={15} color="#38bdf8" />
            <span>Free PayPal Developer Sandbox Credentials</span>
          </div>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          Leave blank to run at <strong>₹0 / $0</strong> in <strong>Local Sandbox Replay</strong> mode. Or paste free REST Sandbox keys from{' '}
          <span className="mono" style={{ color: '#38bdf8' }}>developer.paypal.com/dashboard</span> to execute live requests against{' '}
          <span className="mono">api-m.sandbox.paypal.com</span>. Keys live only in server RAM for this session and are never written to disk.
        </p>

        {errorMsg && (
          <div className="toast-banner error">{errorMsg}</div>
        )}

        <form onSubmit={(e) => void handleConnect(e)} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <input
            type="text"
            className="text-input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="PayPal Sandbox Client ID"
            required
          />
          <input
            type="password"
            className="text-input"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="PayPal Sandbox Secret"
            required
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            {gateway.hasCredentials && (
              <button
                type="button"
                className="btn btn-amber"
                disabled={busy}
                onClick={() => void onDisconnect().then(onClose)}
              >
                Switch to Local Replay
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              {busy ? 'Verifying OAuth...' : 'Verify & Connect Sandbox'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
