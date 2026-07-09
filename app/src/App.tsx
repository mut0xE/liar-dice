import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Lobby } from "./screens/Lobby";
import { GameSummary } from "./chain/games";

type Phase = { name: "lobby" } | { name: "game"; game: GameSummary };

export function App() {
  const { connected } = useWallet();
  const [phase, setPhase] = useState<Phase>({ name: "lobby" });
  if (!connected) return <Connect />;
  if (phase.name === "lobby")
    return <Lobby onEnter={(game) => setPhase({ name: "game", game })} />;
  // EnterRollup/Roll/Table rendered here in Tasks 4–7
  return <div className="screen center">Entering table {phase.game.pubkey.toBase58().slice(0, 8)}…</div>;
}
