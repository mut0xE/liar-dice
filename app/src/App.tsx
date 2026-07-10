import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Lobby } from "./screens/Lobby";
import { GameTable } from "./screens/GameTable";
import { GameSummary } from "./chain/games";
import { useAnchorWallet } from "./wallet/useAnchorWallet";
import { WalletButton } from "./wallet/WalletButton";
import { Toaster } from "./ui/Toaster";

type Phase =
  | { name: "lobby" }
  | { name: "play"; game: GameSummary };

export function App() {
  const { connected } = useWallet();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<Phase>({ name: "lobby" });
  if (!connected || !wallet) return <><Connect /><Toaster /></>;

  const screen = renderScreen();
  return (
    <>
      <header className="app-header">
        <WalletButton />
      </header>
      {screen}
      <Toaster />
    </>
  );

  function renderScreen() {
  if (phase.name === "lobby")
    return <Lobby onEnter={(game) => setPhase({ name: "play", game })} />;
  if (phase.name === "play")
    return <GameTable game={phase.game} onExit={() => setPhase({ name: "lobby" })} />;
  }
}
