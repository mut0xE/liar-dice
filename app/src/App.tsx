import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Lobby } from "./screens/Lobby";
import { EnterRollup } from "./screens/EnterRollup";
import { GameSummary } from "./chain/games";

type Phase =
  | { name: "lobby" }
  | { name: "enter"; game: GameSummary }
  | { name: "play"; game: GameSummary; session: Keypair; sessionToken: PublicKey; fqdn: string; validatorIdentity: PublicKey };

export function App() {
  const { connected } = useWallet();
  const [phase, setPhase] = useState<Phase>({ name: "lobby" });
  if (!connected) return <Connect />;
  if (phase.name === "lobby")
    return <Lobby onEnter={(game) => setPhase({ name: "enter", game })} />;
  if (phase.name === "enter")
    return (
      <EnterRollup
        game={phase.game}
        onReady={(r) => setPhase({ name: "play", game: phase.game, ...r })}
      />
    );
  if (phase.name === "play")
    return <div className="screen center">At the table (Roll screen — Task 5)</div>;
}
