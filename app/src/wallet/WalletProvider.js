import { jsx as _jsx } from "react/jsx-runtime";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider as SolWalletProvider, } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { DEVNET_ENDPOINT } from "../chain/constants";
export function WalletProvider({ children }) {
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
    return (_jsx(ConnectionProvider, { endpoint: DEVNET_ENDPOINT, children: _jsx(SolWalletProvider, { wallets: wallets, autoConnect: true, children: children }) }));
}
