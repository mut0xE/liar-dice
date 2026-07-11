import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { pushToast } from "../ui/toast";

export type WalletStatus = "connecting" | "connected" | "disconnected";

// Separate from useAnchorWallet (which many call sites treat as a plain
// null-check) so existing consumers are untouched; this adds the ability to
// tell "never connected" apart from "was connected, just dropped."
export function useWalletStatus(): WalletStatus {
  const { connecting, connected } = useWallet();
  const [status, setStatus] = useState<WalletStatus>(connecting ? "connecting" : connected ? "connected" : "disconnected");
  const wasConnected = useRef(connected);

  useEffect(() => {
    const next: WalletStatus = connecting ? "connecting" : connected ? "connected" : "disconnected";
    if (wasConnected.current && !connected) {
      pushToast({ kind: "error", label: "Wallet disconnected", detail: "Reconnect to continue playing." });
    }
    wasConnected.current = connected;
    setStatus(next);
  }, [connecting, connected]);

  return status;
}
