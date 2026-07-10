import { useCallback, useEffect, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { authedErConnection, sessionErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { useAnchorWallet } from "../wallet/useAnchorWallet";

export function useMyHand(fqdn: string, hand: PublicKey, session?: Keypair) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const [dice, setDice] = useState<number[] | null>(null);
  const [rolled, setRolled] = useState(false);
  const [rolledRound, setRolledRound] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Returns whether the hand has rolled, so callers can poll and exit early.
  const refresh = useCallback(async (expectedRound?: number): Promise<boolean> => {
    if (!wallet) return false;
    const readWith = async (useSession: boolean) => {
      if (useSession && session) return sessionErConnection(fqdn, session);
      if (!signMessage || !publicKey) return null;
      return authedErConnection(fqdn, signMessage, publicKey);
    };
    try {
      const conn = await readWith(Boolean(session));
      if (!conn) return false;
      const program = programOn(conn, wallet);
      const h = await program.account.playerHand.fetch(hand);
      const nextRound = Number(h.rolledRound);
      setRolled(h.rolled);
      setRolledRound(nextRound);
      setRevealed(Boolean(h.revealed));
      setDice(h.rolled && (expectedRound === undefined || nextRound === expectedRound)
        ? Array.from(h.dice as number[]).slice(0, h.diceCount)
        : null);
      return Boolean(h.rolled && (expectedRound === undefined || nextRound === expectedRound));
    } catch {
      return false;
    }
  }, [wallet, signMessage, publicKey, fqdn, hand, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { dice, rolled, rolledRound, revealed, refresh };
}
