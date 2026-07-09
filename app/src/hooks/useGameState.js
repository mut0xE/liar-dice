import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
export function useGameState(fqdn, gamePubkey) {
    const wallet = useAnchorWallet();
    const { signMessage, publicKey } = useWallet();
    const [game, setGame] = useState(null);
    useEffect(() => {
        if (!wallet || !signMessage || !publicKey)
            return;
        let sub;
        let program;
        (async () => {
            const conn = await authedErConnection(fqdn, signMessage, publicKey);
            program = programOn(conn, wallet);
            const load = async () => setGame(await program.account.game.fetch(gamePubkey));
            await load();
            sub = conn.onAccountChange(gamePubkey, load, "confirmed");
        })();
        return () => { if (sub !== undefined && program)
            program.provider.connection.removeAccountChangeListener(sub); };
    }, [wallet, signMessage, publicKey, fqdn, gamePubkey]);
    return { game };
}
