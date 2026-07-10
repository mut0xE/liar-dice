import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { readerErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { useAnchorWallet } from "../wallet/useAnchorWallet";

export function useGameState(fqdn: string, gamePubkey: PublicKey) {
  const wallet = useAnchorWallet();
  const [game, setGame] = useState<any | null>(null);
  // Latest loader, so callers can force an immediate refresh (e.g. right after
  // submitting a bid) instead of waiting up to a full poll tick for state to move.
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let sub: number | undefined;
    let program: any;
    let poll: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    let inFlight = false;
    (async () => {
      const conn = await readerErConnection(fqdn);
      program = programOn(conn, wallet);
      // Best-effort load, guarded against overlapping fetches so the interval
      // poll and the subscription callback never stampede the RPC.
      const load = async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          const next = await program.account.game.fetch(gamePubkey);
          if (!stopped) setGame(next);
        } catch {
          // Transient RPC/ws error — the next poll tick retries.
        } finally {
          inFlight = false;
        }
      };
      loadRef.current = load;
      await load();
      // Low-latency path: react to account writes immediately.
      sub = conn.onAccountChange(gamePubkey, load, "confirmed");
      // Safety net: `onAccountChange` is best-effort and can silently drop a
      // notification (ws reconnect, token refresh), which otherwise leaves a
      // client stuck on a stale turn forever. Re-fetch on an interval so a
      // missed update self-heals within a tick.
      poll = setInterval(load, 2000);
    })();
    return () => {
      stopped = true;
      loadRef.current = null;
      if (poll !== undefined) clearInterval(poll);
      if (sub !== undefined && program) program.provider.connection.removeAccountChangeListener(sub);
    };
  }, [wallet, fqdn, gamePubkey]);

  // Force an out-of-band refetch; used after we submit an action so the button
  // lock (which keys off `currentTurn`) releases as soon as the ER has advanced.
  const refresh = useCallback(async () => {
    if (loadRef.current) await loadRef.current();
  }, []);

  return { game, refresh };
}
