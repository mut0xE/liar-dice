import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Lobby } from "./screens/Lobby";
import { EnterRollup } from "./screens/EnterRollup";
import { Roll } from "./screens/Roll";
import { Table } from "./screens/Table";
import { GameSummary } from "./chain/games";
import { handPda } from "./chain/pdas";
import { useAnchorWallet } from "./wallet/useAnchorWallet";

type Phase =
  | { name: "lobby" }
  | { name: "enter"; game: GameSummary }
  | { name: "play"; game: GameSummary; session: Keypair; sessionToken: PublicKey; fqdn: string; validatorIdentity: PublicKey; sub: "rolling" | "table" | "reveal"; myDice?: number[] };

export function App() {
  const { connected } = useWallet();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<Phase>({ name: "lobby" });
  if (!connected || !wallet) return <Connect />;
  if (phase.name === "lobby")
    return <Lobby onEnter={(game) => setPhase({ name: "enter", game })} />;
  if (phase.name === "enter")
    return (
      <EnterRollup
        game={phase.game}
        onReady={(r) => setPhase({ name: "play", game: phase.game, ...r, sub: "rolling" })}
      />
    );
  if (phase.name === "play" && phase.sub === "rolling")
    return (
      <Roll
        game={phase.game.pubkey}
        hand={handPda(phase.game.pubkey, wallet!.publicKey)}
        session={phase.session}
        sessionToken={phase.sessionToken}
        fqdn={phase.fqdn}
        onRolled={(dice: number[]) => setPhase({ ...phase, sub: "table", myDice: dice })}
      />
    );
  if (phase.name === "play" && phase.sub === "table")
    return (
      <Table
        game={phase.game.pubkey}
        session={phase.session}
        sessionToken={phase.sessionToken}
        fqdn={phase.fqdn}
        myDice={phase.myDice ?? []}
        onReveal={() => setPhase({ ...phase, sub: "reveal" })}
      />
    );
  if (phase.name === "play" && phase.sub === "reveal")
    return <div className="screen center">Revealing… (Task 7)</div>;
}
