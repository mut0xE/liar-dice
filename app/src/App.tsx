import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Lobby } from "./screens/Lobby";
import { EnterRollup } from "./screens/EnterRollup";
import { Roll } from "./screens/Roll";
import { GameSummary } from "./chain/games";
import { handPda } from "./chain/pdas";
import { useAnchorWallet } from "./wallet/useAnchorWallet";

type Phase =
  | { name: "lobby" }
  | { name: "enter"; game: GameSummary }
  | { name: "play"; game: GameSummary; session: Keypair; sessionToken: PublicKey; fqdn: string; validatorIdentity: PublicKey; rolled?: boolean };

export function App() {
  const { connected } = useWallet();
  const wallet = useAnchorWallet();
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
  if (phase.name === "play" && !phase.rolled)
    return (
      <Roll
        game={phase.game.pubkey}
        hand={handPda(phase.game.pubkey, wallet!.publicKey)}
        session={phase.session}
        sessionToken={phase.sessionToken}
        fqdn={phase.fqdn}
        onRolled={() => setPhase({ ...phase, rolled: true })}
      />
    );
  if (phase.name === "play" && phase.rolled)
    return <div className="screen center">At the table (Table screen — Task 6)</div>;
}
