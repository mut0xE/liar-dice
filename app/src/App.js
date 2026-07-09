import { jsx as _jsx } from "react/jsx-runtime";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connect } from "./screens/Connect";
import { Lobby } from "./screens/Lobby";
import { EnterRollup } from "./screens/EnterRollup";
import { Roll } from "./screens/Roll";
import { Table } from "./screens/Table";
import { Reveal } from "./screens/Reveal";
import { GameOver } from "./screens/GameOver";
import { handPda } from "./chain/pdas";
import { useAnchorWallet } from "./wallet/useAnchorWallet";
export function App() {
    const { connected } = useWallet();
    const wallet = useAnchorWallet();
    const [phase, setPhase] = useState({ name: "lobby" });
    if (!connected || !wallet)
        return _jsx(Connect, {});
    if (phase.name === "lobby")
        return _jsx(Lobby, { onEnter: (game) => setPhase({ name: "enter", game }) });
    if (phase.name === "enter")
        return (_jsx(EnterRollup, { game: phase.game, onReady: (r) => setPhase({ name: "play", game: phase.game, ...r, sub: "rolling" }) }));
    if (phase.name === "play" && phase.sub === "rolling")
        return (_jsx(Roll, { game: phase.game.pubkey, hand: handPda(phase.game.pubkey, wallet.publicKey), session: phase.session, sessionToken: phase.sessionToken, fqdn: phase.fqdn, onRolled: (dice) => setPhase({ ...phase, sub: "table", myDice: dice }) }));
    if (phase.name === "play" && phase.sub === "table")
        return (_jsx(Table, { game: phase.game.pubkey, session: phase.session, sessionToken: phase.sessionToken, fqdn: phase.fqdn, myDice: phase.myDice ?? [], onReveal: () => setPhase({ ...phase, sub: "reveal" }) }));
    if (phase.name === "play" && phase.sub === "reveal")
        return (_jsx(Reveal, { game: phase.game.pubkey, session: phase.session, sessionToken: phase.sessionToken, fqdn: phase.fqdn, onDone: (ended) => {
                if (ended) {
                    setPhase({ ...phase, sub: "gameover" });
                }
                else {
                    setPhase({ ...phase, sub: "rolling", myDice: undefined });
                }
            } }));
    if (phase.name === "play" && phase.sub === "gameover")
        return (_jsx(GameOver, { game: phase.game.pubkey, fqdn: phase.fqdn, onPlayAgain: () => setPhase({ name: "lobby" }) }));
}
