import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { GameTable } from "./GameTable";
import { useGames, findGameByAddress } from "../hooks/useGames";
import { GameSummary } from "../chain/games";

// A freshly-opened table can lag a few seconds behind a just-confirmed tx before
// the lobby scan finds it — give it this long before calling it "not found".
const NOT_FOUND_GRACE_MS = 12_000;

export function Play() {
  const { addr } = useParams();
  const navigate = useNavigate();
  const { games, loaded, fetchFailed, refresh } = useGames();
  // Once the table resolves, keep it. The lobby poll briefly loses a game while
  // it commits between the ER and base layer (e.g. right after a prize claim) —
  // dropping to "not found" mid-game would unmount the live table and replay the
  // whole delegation/attestation setup on remount.
  const held = useRef<GameSummary | null>(null);
  const fresh = findGameByAddress(games, addr);
  if (fresh) held.current = fresh;
  if (held.current && addr !== held.current.pubkey.toBase58()) held.current = null;
  const g = fresh ?? held.current;

  // First render time for THIS address — resets whenever the route param changes.
  const firstSeenAt = useRef<number>(Date.now());
  const [, forceTick] = useState(0);
  useEffect(() => {
    firstSeenAt.current = Date.now();
  }, [addr]);

  // While waiting, poll faster than the lobby's normal cadence and tick a
  // re-render so the grace-window check below keeps re-evaluating.
  useEffect(() => {
    if (g) return;
    const fast = setInterval(refresh, 1500);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      clearInterval(fast);
      clearInterval(tick);
    };
  }, [g, refresh]);

  if (!g) {
    const withinGrace = Date.now() - firstSeenAt.current < NOT_FOUND_GRACE_MS;
    const stillWaiting = !fetchFailed && withinGrace;
    return (
      <main className="screen center-screen">
        <div className="ribbon"><div className="band">Liar's Dice</div></div>
        <div className="muted" style={{ marginTop: 20 }}>
          {fetchFailed
            ? "Couldn't reach the fleet — check your connection and retry."
            : stillWaiting
              ? "Finding your table…"
              : "Table not found — it may have started or been cancelled."}
        </div>
        {loaded && !stillWaiting && (
          <Link className="btn btn-blue btn-sm" to="/games" style={{ marginTop: 14 }}>Back to Open Waters</Link>
        )}
      </main>
    );
  }

  return <GameTable game={g} onExit={() => navigate("/games")} />;
}
