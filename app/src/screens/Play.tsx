import { useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { GameTable } from "./GameTable";
import { useGames, findGameByAddress } from "../hooks/useGames";
import { GameSummary } from "../chain/games";

export function Play() {
  const { addr } = useParams();
  const navigate = useNavigate();
  const { games, loaded, fetchFailed } = useGames();
  // Once the table resolves, keep it. The lobby poll briefly loses a game while
  // it commits between the ER and base layer (e.g. right after a prize claim) —
  // dropping to "not found" mid-game would unmount the live table and replay the
  // whole delegation/attestation setup on remount.
  const held = useRef<GameSummary | null>(null);
  const fresh = findGameByAddress(games, addr);
  if (fresh) held.current = fresh;
  if (held.current && addr !== held.current.pubkey.toBase58()) held.current = null;
  const g = fresh ?? held.current;

  if (!g) {
    return (
      <main className="screen center-screen">
        <div className="ribbon"><div className="band">Liar's Dice</div></div>
        <div className="muted" style={{ marginTop: 20 }}>
          {fetchFailed ? "Couldn't reach the fleet — check your connection and retry." : loaded ? "Table not found — it may have ended." : "Loading table…"}
        </div>
        {loaded && <Link className="btn btn-blue btn-sm" to="/games" style={{ marginTop: 14 }}>Back to Open Waters</Link>}
      </main>
    );
  }

  return <GameTable game={g} onExit={() => navigate("/games")} />;
}
