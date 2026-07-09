import { useCallback, useEffect, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { programOn } from "../chain/program";
import { gamePda, vaultPda, handPda } from "../chain/pdas";
import { listWaitingGames, GameSummary } from "../chain/games";
import { buildCreateGame, buildJoinGame, buildStartGame } from "../chain/builders";
import { sendWalletTx } from "../chain/sendWallet";

export function Lobby({ onEnter }: { onEnter: (g: GameSummary) => void }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const program = programOn(connection, wallet);
    setGames(await listWaitingGames(program));
  }, [connection, wallet]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!wallet) return null;
  const program = programOn(connection, wallet);

  const create = async () => {
    setBusy("create");
    try {
      const gameId = new BN(Date.now());
      const game = gamePda(wallet.publicKey, gameId);
      const { tx } = await buildCreateGame(program, {
        host: wallet.publicKey,
        game,
        gameId,
        entryFee: new BN(0.01 * LAMPORTS_PER_SOL),
        graceSeconds: 60,
      });
      await sendWalletTx(connection, wallet, tx);
      // creator also joins so the host has a hand
      const { tx: jtx } = await buildJoinGame(program, {
        player: wallet.publicKey,
        game,
        vault: vaultPda(game),
        playerHand: handPda(game, wallet.publicKey),
      });
      await sendWalletTx(connection, wallet, jtx);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const join = async (g: GameSummary) => {
    setBusy(g.pubkey.toBase58());
    try {
      const { tx } = await buildJoinGame(program, {
        player: wallet.publicKey,
        game: g.pubkey,
        vault: vaultPda(g.pubkey),
        playerHand: handPda(g.pubkey, wallet.publicKey),
      });
      await sendWalletTx(connection, wallet, tx);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const startAndEnter = async (g: GameSummary) => {
    setBusy(g.pubkey.toBase58());
    try {
      const { tx } = await buildStartGame(program, { host: wallet.publicKey, game: g.pubkey });
      await sendWalletTx(connection, wallet, tx);
      onEnter(g);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="screen">
      <h2 className="title">TABLES</h2>
      <button className="btn" onClick={create} disabled={busy === "create"}>
        {busy === "create" ? "Creating…" : "New Table"}
      </button>
      <div className="list">
        {games.map((g) => {
          const isHost = g.host.equals(wallet.publicKey);
          const joined = g.players.some((p) => p.equals(wallet.publicKey));
          return (
            <div className="card row" key={g.pubkey.toBase58()}>
              <div>
                <div className="mono">{g.pubkey.toBase58().slice(0, 8)}…</div>
                <div className="muted">
                  {g.players.length} in · {(g.entryFeeLamports.toNumber() / LAMPORTS_PER_SOL).toFixed(3)} SOL
                </div>
              </div>
              {isHost ? (
                <button className="btn small" disabled={g.players.length < 2 || !!busy}
                  onClick={() => startAndEnter(g)}>Start</button>
              ) : joined ? (
                <span className="muted">joined ✓</span>
              ) : (
                <button className="btn small" disabled={!!busy} onClick={() => join(g)}>Join</button>
              )}
            </div>
          );
        })}
        {games.length === 0 && <div className="muted">No open tables. Create one.</div>}
      </div>
    </main>
  );
}
