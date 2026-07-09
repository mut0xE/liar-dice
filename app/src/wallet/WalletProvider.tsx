import { ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolWalletProvider,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { DEVNET_ENDPOINT } from "../chain/constants";

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={DEVNET_ENDPOINT}>
      <SolWalletProvider wallets={wallets} autoConnect>
        {children}
      </SolWalletProvider>
    </ConnectionProvider>
  );
}
