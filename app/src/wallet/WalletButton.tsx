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

// Wallet connection UI: a connect button when disconnected, an address chip when connected.
export function WalletButton() {
  const { publicKey, wallet, wallets, select, disconnect, connecting } =
    useWallet();
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
      // Select only — DON'T call adapter.connect() ourselves here. The provider
      // attaches its 'connect' listener in an effect keyed on the adapter, which
      // only runs after the re-render select() triggers. Calling .connect()
      // synchronously right after select() raced ahead of that effect: if the
      // wallet responded fast, its 'connect' event fired before the listener was
      // attached and was lost — publicKey never updated until a refresh
      // re-mounted everything in the right order ("doesn't connect until I
      // refresh"). select() sets hasUserSelectedAWallet=true internally, which
      // arms the provider's own autoConnect effect to call adapter.connect()
      // itself — in the SAME component as the listener effect, so React runs
      // them in declaration order and the race can't happen. Connect errors
      // surface via the app-level onError toast (wallet/WalletProvider.tsx).
      select(w.adapter.name);
    },
    [select],
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
