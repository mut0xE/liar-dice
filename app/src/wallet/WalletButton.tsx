import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function isAvailable(w: Wallet) {
  return (
    w.readyState === WalletReadyState.Installed ||
    w.readyState === WalletReadyState.Loadable
  );
}

// Single source of truth for wallet connection UI. Disconnected → a "Connect
// Wallet" button that opens a picker (Phantom, Solflare, …). Connected → an
// address chip with copy / disconnect. Disconnect fully clears the selection so
// the next connect starts from the picker instead of silently reusing the old
// wallet.
export function WalletButton() {
  const { publicKey, wallet, wallets, select, connect, disconnect, connecting } =
    useWallet();
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // True only after the user picks a wallet. Gates the select→connect handoff so
  // we never silently reconnect a persisted wallet on page load.
  const wantsConnect = useRef(false);

  // `select` only picks the adapter; finish connecting once it's ready — but
  // only when the user actually asked to this session.
  useEffect(() => {
    if (wallet && wantsConnect.current && !publicKey && !connecting) {
      wantsConnect.current = false;
      connect().catch((e) => setError(e?.message ?? String(e)));
    }
  }, [wallet, publicKey, connecting, connect]);

  // Close the account menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const pick = useCallback(
    (w: Wallet) => {
      setError(null);
      setPickerOpen(false);
      if (!isAvailable(w)) {
        window.open(w.adapter.url, "_blank");
        return;
      }
      wantsConnect.current = true;
      if (wallet?.adapter.name === w.adapter.name) {
        // Already selected — select() won't re-fire the effect, so connect now.
        wantsConnect.current = false;
        connect().catch((e) => setError(e?.message ?? String(e)));
      } else {
        select(w.adapter.name);
      }
    },
    [wallet, connect, select],
  );

  const handleDisconnect = useCallback(async () => {
    setMenuOpen(false);
    try {
      await disconnect();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    // Clear the persisted selection so the next Connect shows the picker fresh
    // rather than clinging to this wallet.
    try {
      window.localStorage.removeItem("walletName");
    } catch {
      /* ignore */
    }
    select(null as never);
  }, [disconnect, select]);

  const handleCopy = useCallback(() => {
    if (!publicKey) return;
    navigator.clipboard?.writeText(publicKey.toBase58());
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [publicKey]);

  if (!publicKey) {
    return (
      <div className="wallet-btn-root">
        <button
          className="btn"
          onClick={() => setPickerOpen(true)}
          disabled={connecting}
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </button>
        {error && <div className="tx-error">{error}</div>}

        {pickerOpen && (
          <div className="wallet-overlay" onClick={() => setPickerOpen(false)}>
            <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
              <div className="wallet-modal-title">Choose a wallet</div>
              {wallets.map((w) => {
                const avail = isAvailable(w);
                return (
                  <button
                    key={w.adapter.name}
                    className="wallet-option"
                    onClick={() => pick(w)}
                  >
                    {w.adapter.icon && (
                      <img
                        className="wallet-option-icon"
                        src={w.adapter.icon}
                        alt=""
                      />
                    )}
                    <span>{w.adapter.name}</span>
                    <span className="wallet-option-state">
                      {avail ? "Detected" : "Install"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const address = publicKey.toBase58();
  return (
    <div className="wallet-btn-root" ref={rootRef}>
      <button
        className="wallet-chip"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
      >
        <span className="wallet-dot" />
        {wallet?.adapter.icon && (
          <img className="wallet-chip-icon" src={wallet.adapter.icon} alt="" />
        )}
        <span className="mono">{short(address)}</span>
        <span className={`wallet-caret${menuOpen ? " open" : ""}`}>▾</span>
      </button>
      {menuOpen && (
        <div className="wallet-menu">
          <button className="wallet-menu-item" onClick={handleCopy}>
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <button className="wallet-menu-item danger" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
