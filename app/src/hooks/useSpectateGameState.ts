import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { readerErConnection } from "../chain/connection";
import { programOn, readOnlyWallet } from "../chain/program";

// Same polling/subscription shape as useGameState, but authed with the bundled
// public reader identity instead of the visitor's wallet — a spectator watches
// without ever connecting a session or delegating anything of their own.
export function useSpectateGameState(fqdn: string, gamePubkey: PublicKey) {
  const [game, setGame] = useState<any | null>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let sub: number | undefined;
    let program: any;
    let poll: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    let inFlight = false;
    (async () => {
      const conn = await readerErConnection(fqdn);
      program = programOn(conn, readOnlyWallet());
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
      sub = conn.onAccountChange(gamePubkey, load, "confirmed");
      poll = setInterval(load, 2000);
    })();
    return () => {
      stopped = true;
      loadRef.current = null;
      if (poll !== undefined) clearInterval(poll);
      if (sub !== undefined && program) program.provider.connection.removeAccountChangeListener(sub);
    };
  }, [fqdn, gamePubkey]);

  const refresh = useCallback(async () => {
    if (loadRef.current) await loadRef.current();
  }, []);

  return { game, refresh };
}
