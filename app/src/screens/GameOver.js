import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda, vaultPda } from "../chain/pdas";
import { buildEndGame } from "../chain/builders";
import { sendWalletTx } from "../chain/sendWallet";
import { useGameState } from "../hooks/useGameState";
export function GameOver({ game, fqdn, onPlayAgain }) {
    const wallet = useAnchorWallet();
    const { signMessage, publicKey } = useWallet();
    const { game: g } = useGameState(fqdn, game);
    const [status, setStatus] = useState("");
    const [payError, setPayError] = useState(null);
    const [busy, setBusy] = useState(false);
    // winner = the single remaining is_active seat
    const winnerIdx = g?.isActive?.findIndex((a) => a) ?? -1;
    const winner = winnerIdx >= 0 ? g?.players[winnerIdx] : undefined;
    const payout = async () => {
        if (!g || !winner)
            return;
        setPayError(null);
        setBusy(true);
        setStatus("Ending game + paying winner…");
        try {
            const conn = await authedErConnection(fqdn, signMessage, publicKey);
            const program = programOn(conn, wallet);
            const hands = g.players.map((p) => handPda(game, p));
            const { tx } = await buildEndGame(program, {
                caller: wallet.publicKey, game, vault: vaultPda(game), winner, handAccounts: hands,
            });
            // end_game runs on the ER; wallet-signed, skipPreflight
            await sendWalletTx(conn, wallet, tx, { skipPreflight: true });
            setStatus("Paid. Pot sent to winner on base layer.");
        }
        catch (e) {
            setPayError(e.message ?? String(e));
            setStatus("");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("main", { className: "screen center", children: [_jsx("h2", { className: "title", children: "GAME OVER" }), _jsxs("div", { className: "card", children: ["Winner: ", winner ? winner.toBase58().slice(0, 8) + "…" : "resolving…"] }), payError && _jsx("div", { className: "tx-error", children: payError }), status
                ? _jsx("div", { className: "muted", children: status })
                : _jsx("button", { className: "btn", onClick: payout, disabled: busy, children: "Pay the winner" }), _jsx("button", { className: "btn", onClick: onPlayAgain, disabled: busy, children: "Play again" })] }));
}
