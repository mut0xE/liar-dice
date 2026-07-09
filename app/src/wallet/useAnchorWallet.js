import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
// Adapts wallet-adapter into the { publicKey, signTransaction, signAllTransactions }
// shape Anchor's AnchorProvider expects. Returns null until connected.
export function useAnchorWallet() {
    const { publicKey, signTransaction, signAllTransactions } = useWallet();
    return useMemo(() => {
        if (!publicKey || !signTransaction || !signAllTransactions)
            return null;
        return { publicKey, signTransaction, signAllTransactions };
    }, [publicKey, signTransaction, signAllTransactions]);
}
