import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { buildRequestRoll } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useMyHand } from "../hooks/useMyHand";
import { Dice } from "../ui/Dice";
import { useWallet } from "@solana/wallet-adapter-react";
export function Roll({ game, hand, session, sessionToken, fqdn, onRolled, }) {
    const wallet = useAnchorWallet();
    const { signMessage, publicKey } = useWallet();
    const { dice, rolled, refresh } = useMyHand(fqdn, hand);
    const [busy, setBusy] = useState(false);
    const roll = async () => {
        if (!wallet || !signMessage || !publicKey)
            return;
        setBusy(true);
        try {
            const conn = await authedErConnection(fqdn, signMessage, publicKey);
            const program = programOn(conn, wallet);
            const { tx, sessionSigner } = await buildRequestRoll(program, { sessionSigner: session, authority: wallet.publicKey, sessionToken }, { game, playerHand: hand, clientSeed: Math.floor(Math.random() * 256) });
            await sendSessionTx(conn, sessionSigner, tx);
            navigator.vibrate?.(40);
            // poll for the VRF callback, stopping as soon as the dice land
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 700));
                if (await refresh())
                    break;
            }
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("main", { className: "screen center", children: [_jsx("h2", { className: "title", children: "ROLL" }), rolled && dice ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "dice-row", children: dice.map((d, i) => _jsx(Dice, { value: d, delay: i * 90 }, i)) }), _jsx("button", { className: "btn", onClick: () => onRolled(dice), children: "To the table \u2192" })] })) : (_jsx("button", { className: "btn", onClick: roll, disabled: busy, children: busy ? "Rolling (VRF)…" : "Roll dice" }))] }));
}
