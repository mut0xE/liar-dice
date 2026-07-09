import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { useAnchorWallet } from "../wallet/useAnchorWallet";

export function useMyHand(fqdn: string, hand: PublicKey) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const [dice, setDice] = useState<number[] | null>(null);
  const [rolled, setRolled] = useState(false);

  // Returns whether the hand has rolled, so callers can poll and exit early.
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!wallet || !signMessage || !publicKey) return false;
    const conn = await authedErConnection(fqdn, signMessage, publicKey);
    const program = programOn(conn, wallet);
    try {
      const h = await program.account.playerHand.fetch(hand);
      setRolled(h.rolled);
      setDice(h.rolled ? Array.from(h.dice as number[]).slice(0, h.diceCount) : null);
      return h.rolled;
    } catch {
      setRolled(false);
      return false;
    }
  }, [wallet, signMessage, publicKey, fqdn, hand]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { dice, rolled, refresh };
}
