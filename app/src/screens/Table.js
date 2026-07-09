import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda } from "../chain/pdas";
import { buildBeginBiddingAndBid, buildPlaceBid, buildChallenge } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useGameState } from "../hooks/useGameState";
import { validateBid } from "../chain/bidRules";
export function Table({ game, session, sessionToken, fqdn, myDice, onReveal, }) {
    const wallet = useAnchorWallet();
    const { signMessage, publicKey } = useWallet();
    const { game: g } = useGameState(fqdn, game);
    const [qty, setQty] = useState(1);
    const [face, setFace] = useState(2);
    const [err, setErr] = useState(null);
    const [txError, setTxError] = useState(null);
    const [busy, setBusy] = useState(false);
    const prevBid = useMemo(() => {
        const b = g?.currentBid;
        return b ? { quantity: Number(b.quantity), face: Number(b.face) } : null;
    }, [g]);
    const mySeat = useMemo(() => g?.players.findIndex((p) => p.equals(wallet.publicKey)) ?? -1, [g, wallet]);
    const myTurn = g && g.currentTurn === mySeat;
    const phase = g ? Object.keys(g.phase)[0] : "";
    useEffect(() => {
        if (phase === "revealing")
            onReveal();
    }, [phase]);
    const withProgram = async () => {
        const conn = await authedErConnection(fqdn, signMessage, publicKey);
        return { conn, program: programOn(conn, wallet) };
    };
    const s = { sessionSigner: session, authority: wallet.publicKey, sessionToken };
    const bid = async () => {
        const v = validateBid(prevBid, { quantity: qty, face });
        if (!v.ok) {
            setErr(v.reason);
            return;
        }
        setErr(null);
        setTxError(null);
        setBusy(true);
        try {
            const { conn, program } = await withProgram();
            const hand = handPda(game, wallet.publicKey);
            const hands = g.players.map((p) => handPda(game, p));
            // first bid of the round also opens bidding
            const tx = prevBid === null
                ? await buildBeginBiddingAndBid(program, s, { game, playerHand: hand, quantity: qty, face, hands })
                : await buildPlaceBid(program, s, { game, playerHand: hand, quantity: qty, face });
            await sendSessionTx(conn, tx.sessionSigner, tx.tx);
            navigator.vibrate?.(30);
        }
        catch (e) {
            setTxError(e.message ?? String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const challenge = async () => {
        setTxError(null);
        setBusy(true);
        try {
            const { conn, program } = await withProgram();
            const tx = await buildChallenge(program, s, { game });
            await sendSessionTx(conn, tx.sessionSigner, tx.tx);
            navigator.vibrate?.(60);
        }
        catch (e) {
            setTxError(e.message ?? String(e));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("main", { className: "screen", children: [_jsx("h2", { className: "title", children: "TABLE" }), _jsxs("div", { className: "muted", children: ["Round ", g?.round ?? "…", " \u00B7 ", phase] }), _jsxs("div", { className: "card", children: ["Current bid: ", prevBid ? `${prevBid.quantity} × ${prevBid.face}s` : "— none —"] }), _jsx("div", { className: "dice-row", style: { margin: "18px 0" }, children: myDice.map((d, i) => _jsx("span", { className: "mono", children: d }, i)) }), myTurn ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "row", children: [_jsxs("label", { children: ["Qty ", _jsx("input", { type: "number", min: 1, value: qty, onChange: (e) => setQty(+e.target.value) })] }), _jsxs("label", { children: ["Face ", _jsx("input", { type: "number", min: 1, max: 6, value: face, onChange: (e) => setFace(+e.target.value) })] })] }), err && _jsx("div", { className: "muted", children: err }), txError && _jsx("div", { className: "tx-error", children: txError }), _jsx("button", { className: "btn", onClick: bid, disabled: busy, children: "Raise" }), prevBid && _jsx("button", { className: "btn", onClick: challenge, disabled: busy, children: "Liar! (Challenge)" })] })) : (_jsxs("div", { className: "muted", children: ["Waiting for seat ", g?.currentTurn, "\u2026"] }))] }));
}
