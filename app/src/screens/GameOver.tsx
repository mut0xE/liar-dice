import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda, vaultPda } from "../chain/pdas";
import { buildEndGame } from "../chain/builders";
import { sendWalletTx } from "../chain/sendWallet";
import { useGameState } from "../hooks/useGameState";

export function GameOver({ game, fqdn, onPlayAgain }: { game: PublicKey; fqdn: string; onPlayAgain: () => void }) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const { game: g } = useGameState(fqdn, game);
  const [status, setStatus] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // winner = the single remaining is_active seat
  const winnerIdx = g?.isActive?.findIndex((a: boolean) => a) ?? -1;
  const winner: PublicKey | undefined = winnerIdx >= 0 ? g?.players[winnerIdx] : undefined;

  const payout = async () => {
    if (!g || !winner) return;
    setPayError(null);
    setBusy(true);
    setStatus("Ending game + paying winner…");
    try {
      const conn = await authedErConnection(fqdn, signMessage!, publicKey!);
      const program = programOn(conn, wallet!);
      const hands = (g.players as PublicKey[]).map((p) => handPda(game, p));
      const { tx } = await buildEndGame(program, {
        caller: wallet!.publicKey, game, vault: vaultPda(game), winner, handAccounts: hands,
      });
      // end_game runs on the ER; wallet-signed, skipPreflight
      await sendWalletTx(conn, wallet!, tx, { skipPreflight: true });
      setStatus("Paid. Pot sent to winner on base layer.");
    } catch (e) {
      setPayError((e as Error).message ?? String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen center">
      <h2 className="title">GAME OVER</h2>
      <div className="card">
        Winner: {winner ? winner.toBase58().slice(0, 8) + "…" : "resolving…"}
      </div>
      {payError && <div className="tx-error">{payError}</div>}
      {status
        ? <div className="muted">{status}</div>
        : <button className="btn" onClick={payout} disabled={busy}>Pay the winner</button>}
      <button className="btn" onClick={onPlayAgain} disabled={busy}>Play again</button>
    </main>
  );
}
