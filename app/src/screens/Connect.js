import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
export function Connect() {
    const { connection } = useConnection();
    const { publicKey, connect, connecting } = useWallet();
    const [sol, setSol] = useState(null);
    useEffect(() => {
        if (!publicKey)
            return;
        connection.getBalance(publicKey).then((b) => setSol(b / LAMPORTS_PER_SOL));
    }, [publicKey, connection]);
    return (_jsxs("main", { className: "screen center", children: [_jsx("h1", { className: "title", children: "LIAR'S DICE" }), !publicKey ? (_jsx("button", { className: "btn", onClick: () => connect(), disabled: connecting, children: connecting ? "Connecting…" : "Connect Wallet" })) : (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "mono", children: [publicKey.toBase58().slice(0, 8), "\u2026"] }), _jsxs("div", { className: "balance", children: [sol === null ? "…" : sol.toFixed(3), " SOL"] }), sol !== null && sol < 0.05 && (_jsx("a", { className: "link", href: "https://faucet.solana.com", target: "_blank", children: "Low balance \u2014 get devnet SOL" }))] }))] }));
}
