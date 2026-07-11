import { useEffect, useState } from "react";
import { Toast, subscribeToasts, dismissToast } from "./toast";

const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-6);
// ER (PER/TEE) txs only exist on the rollup, so link them through the explorer's
// custom-cluster mode pointed at the TEE endpoint; base-layer txs go to devnet.
const explorer = (sig: string, erFqdn?: string) =>
  erFqdn
    ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(erFqdn)}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const icon: Record<Toast["kind"], string> = {
  pending: "⏳",
  success: "✓",
  error: "✕",
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div className={"toast toast-" + t.kind} key={t.id}>
          <span className="toast-icon">{icon[t.kind]}</span>
          <div className="toast-body">
            <div className="toast-label">{t.label}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
            {t.sig && (
              <a className="toast-link" href={explorer(t.sig, t.erFqdn)} target="_blank" rel="noreferrer">
                {short(t.sig)} ↗
              </a>
            )}
          </div>
          <button className="toast-close" onClick={() => dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
