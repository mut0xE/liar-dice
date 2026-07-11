import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { programOn } from "../chain/program";
import { listAllGames, GameSummary } from "../chain/games";

/** Pure lookup: find a game in a list by its base58 address. Exported for tests. */
export function findGameByAddress(
  games: GameSummary[],
  addr: string | undefined,
): GameSummary | null {
  if (!addr) return null;
  return games.find((g) => g.pubkey.toBase58() === addr) ?? null;
}

/**
 * Shared games fetch + gentle polling. Every routed page (Games list, Waiting
 * Room, Play) reads from the same source so a deep-link / refresh still resolves
 * the game by address rather than relying on router state.
 */
export function useGames(pollMs = 10000) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erWarning, setErWarning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setLoaded(true);
      return;
    }
    const program = programOn(connection, wallet);
    try {
      const canReadEr = Boolean(import.meta.env.VITE_ER_READER_SECRET || wallet.signMessage);
      setErWarning(canReadEr ? null : "Ongoing games are hidden until this wallet can sign the rollup read challenge.");
      setGames(await listAllGames(program, wallet, wallet));
    } catch (e) {
      // Public devnet getProgramAccounts rate-limits (429) and hiccups. Keep the
      // last good list and try again on the next poll instead of leaving the
      // lobby stuck on its loading state forever.
      console.warn("[games] refresh failed, keeping last list", e);
    } finally {
      // Always flip out of the loading state so the lobby renders (empty or not).
      setLoaded(true);
    }
  }, [connection, wallet]);

  useEffect(() => {
    refresh();
    // Public devnet rate-limits getProgramAccounts; poll gently to avoid 429s.
    const t = setInterval(refresh, pollMs);
    // A player returning to the app (tab focus / PWA resume) should see the live
    // seat list immediately, not last session's snapshot — a failed poll keeps
    // the stale list otherwise.
    const onWake = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [refresh, pollMs]);

  const byStatus = useMemo(
    () => ({
      waiting: games.filter((g) => g.status === "Waiting"),
      active: games.filter((g) => g.status === "Active"),
      ended: games.filter((g) => g.status === "Ended" || g.status === "Cancelled"),
    }),
    [games],
  );

  return { games, loaded, erWarning, refresh, ...byStatus };
}
