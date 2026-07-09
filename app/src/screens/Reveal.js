import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda } from "../chain/pdas";
import { buildReveal, buildSettleRound } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useGameState } from "../hooks/useGameState";
import { Dice } from "../ui/Dice";
export function Reveal({ game, session, sessionToken, fqdn, onDone, }) {
    const wallet = useAnchorWallet();
    const { signMessage, publicKey } = useWallet();
    const { game: g } = useGameState(fqdn, game);
    const [status, setStatus] = useState("Revealing your dice…");
    const [settleError, setSettleError] = useState(null);
    const [busy, setBusy] = useState(false);
    const revealed = useRef(false);
    const s = { sessionSigner: session, authority: wallet.publicKey, sessionToken };
    const withProgram = async () => {
        const conn = await authedErConnection(fqdn, signMessage, publicKey);
        return { conn, program: programOn(conn, wallet) };
    };
    // reveal my hand once
    useEffect(() => {
        if (!wallet || !signMessage || !publicKey || revealed.current)
            return;
        revealed.current = true;
        (async () => {
            const { conn, program } = await withProgram();
            const tx = await buildReveal(program, s, { game, playerHand: handPda(game, publicKey) });
            await sendSessionTx(conn, tx.sessionSigner, tx.tx);
            setStatus("Revealed. Waiting for opponents…");
        })().catch((e) => setStatus("Error: " + e.message));
    }, [wallet, signMessage, publicKey]);
    // once everyone has revealed, anyone may settle
    const settle = async () => {
        setSettleError(null);
        setBusy(true);
        setStatus("Settling…");
        try {
            const { conn, program } = await withProgram();
            const tx = await buildSettleRound(program, s, { game });
            await sendSessionTx(conn, tx.sessionSigner, tx.tx);
            const fresh = await program.account.game.fetch(game);
            const ended = Object.keys(fresh.status)[0] === "ended";
            onDone(ended);
        }
        catch (e) {
            setSettleError(e.message ?? String(e));
            setStatus("Settling failed — try again.");
        }
        finally {
            setBusy(false);
        }
    };
    const reveals = g?.lastReveal ?? [];
    return (_jsxs("main", { className: "screen center", children: [_jsx("h2", { className: "title", children: "SHOWDOWN" }), _jsx("div", { className: "muted", children: status }), reveals.map((r, i) => (_jsx("div", { className: "dice-row", children: r.dice.slice(0, r.diceCount).map((d, j) => _jsx(Dice, { value: d, delay: j * 80 }, j)) }, i))), settleError && _jsx("div", { className: "tx-error", children: settleError }), _jsx("button", { className: "btn", onClick: settle, disabled: busy, children: "Settle round" })] }));
}
