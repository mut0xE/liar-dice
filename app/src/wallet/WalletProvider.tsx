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
import {
  SolanaMobileWalletAdapter,
  createDefaultAuthorizationResultCache,
  createDefaultAddressSelector,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { DEVNET_ENDPOINT } from "../chain/constants";

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new SolanaMobileWalletAdapter({
        addressSelector: createDefaultAddressSelector(),
        appIdentity: {
          name: "Liar's Dice",
          uri: window.location.origin,
          icon: "icon-192.png",
        },
        authorizationResultCache: createDefaultAuthorizationResultCache(),
        cluster: WalletAdapterNetwork.Devnet,
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      }),
    ],
    [],
  );
  const onError = useCallback((e: WalletError) => {
    // Surface adapter errors instead of silently swallowing them.
    console.error("[wallet]", e.name, e.message);
  }, []);
  return (
    <ConnectionProvider endpoint={DEVNET_ENDPOINT}>
      <SolWalletProvider wallets={wallets} autoConnect onError={onError}>
        {children}
      </SolWalletProvider>
    </ConnectionProvider>
  );
}
