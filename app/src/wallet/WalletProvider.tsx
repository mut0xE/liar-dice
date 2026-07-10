import { ReactNode, useCallback, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolWalletProvider,
} from "@solana/wallet-adapter-react";
import type { WalletError } from "@solana/wallet-adapter-base";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { DEVNET_ENDPOINT } from "../chain/constants";

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const onError = useCallback((e: WalletError) => {
    // Surface adapter errors instead of silently swallowing them.
    console.error("[wallet]", e.name, e.message);
  }, []);
  return (
    <ConnectionProvider endpoint={DEVNET_ENDPOINT}>
      <SolWalletProvider wallets={wallets} autoConnect={false} onError={onError}>
        {children}
      </SolWalletProvider>
    </ConnectionProvider>
  );
}
