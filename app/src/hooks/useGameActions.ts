import { useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { programOn } from "../chain/program";
import { gamePda, vaultPda, handPda } from "../chain/pdas";
import { GameSummary } from "../chain/games";
import {
  buildCreateGame,
  buildJoinGame,
  buildStartGame,
  buildDelegateGameIx,
  buildCancelGame,
} from "../chain/builders";
import { sendWalletTx } from "../chain/sendWallet";
import { setUpHand } from "../chain/enter";
import { teeValidator } from "../chain/connection";

/**
 * All on-chain lobby actions in one place. The chain flow here is unchanged from
 * the original Lobby — only relocated so both the Games list and the Waiting Room
 * can drive create / join / start. Each action returns the game address so the
 * caller can navigate to the right route on success.
 */
export function useGameActions() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [busy, setBusy] = useState<string | null>(null);

  const create = async (feeSol: number, graceSeconds: number): Promise<string> => {
    if (!wallet) throw new Error("Wallet not connected");
    const program = programOn(connection, wallet);
    const me = wallet.publicKey;
    setBusy("create");
    try {
      const gameId = new BN(Date.now());
      const game = gamePda(me, gameId);
      const entryFee = new BN(Math.round(feeSol * LAMPORTS_PER_SOL));

      // ONE wallet tx does the whole create flow: create_game + join_game +
      // (topup + delegate_hand + create_session, added by setUpHand). Bundling
      // create_game and join_game as prepend ixs means a rejected signature
      // creates NOTHING — no half-made ghost table.
      const createIx = (
        await buildCreateGame(program, { host: me, game, gameId, entryFee, graceSeconds })
      ).tx.instructions[0];
      const joinIx = (
        await buildJoinGame(program, {
          player: me,
          game,
          vault: vaultPda(game),
          playerHand: handPda(game, me),
        })
      ).tx.instructions[0];

      const pending: GameSummary = {
        pubkey: game,
        host: me,
        gameId,
        entryFeeLamports: entryFee,
        players: [me],
        status: "Waiting",
        potLamports: entryFee,
        round: 0,
        phase: "Rolling",
        currentTurn: 0,
        currentBid: null,
        activeSeats: [true],
        winner: null,
      };
      await setUpHand({ connection, wallet, game: pending, prependIxs: [createIx, joinIx] });
      return game.toBase58();
    } finally {
      setBusy(null);
    }
  };

  // Join a table AND set the caller up on the ER in one flow: join_game +
  // delegate_hand + create_session. Delegation happens ONCE, here.
  const join = async (g: GameSummary): Promise<string> => {
    if (!wallet) throw new Error("Wallet not connected");
    const program = programOn(connection, wallet);
    const me = wallet.publicKey;
    setBusy(g.pubkey.toBase58());
    try {
      const joinIx = (
        await buildJoinGame(program, {
          player: me,
          game: g.pubkey,
          vault: vaultPda(g.pubkey),
          playerHand: handPda(g.pubkey, me),
        })
      ).tx.instructions[0];
      await setUpHand({ connection, wallet, game: g, prependIxs: [joinIx] });
      return g.pubkey.toBase58();
    } finally {
      setBusy(null);
    }
  };

  // Host: start the game AND delegate the game PDA in one wallet tx.
  const start = async (g: GameSummary): Promise<string> => {
    if (!wallet) throw new Error("Wallet not connected");
    const program = programOn(connection, wallet);
    const me = wallet.publicKey;
    setBusy(g.pubkey.toBase58());
    try {
      const { identity } = await teeValidator();
      const startIx = (await buildStartGame(program, { host: me, game: g.pubkey })).tx.instructions[0];
      const delegateGameIx = await buildDelegateGameIx(program, {
        payer: me,
        host: g.host,
        game: g.pubkey,
        gameId: g.gameId,
        validatorIdentity: identity,
      });
      const tx = new Transaction().add(startIx, delegateGameIx);
      await sendWalletTx(connection, wallet, tx, { label: "Start + delegate game" });
      return g.pubkey.toBase58();
    } finally {
      setBusy(null);
    }
  };

  // Host: cancel a game that never started. Refunds every seated player's entry
  // fee from the vault in one base-layer tx. A hand still delegated to the ER at
  // cancel time is refunded but NOT closed (no instruction can undelegate it once
  // this sets the game to Cancelled) — see the note in cancel_game.rs.
  const cancel = async (g: GameSummary): Promise<void> => {
    if (!wallet) throw new Error("Wallet not connected");
    if (g.status !== "Waiting") throw new Error("Only a game that hasn't started can be cancelled");
    if (!g.host.equals(wallet.publicKey)) throw new Error("Only the host can cancel this game");
    const program = programOn(connection, wallet);
    setBusy("cancel");
    try {
      const { tx } = await buildCancelGame(program, {
        host: wallet.publicKey,
        game: g.pubkey,
        vault: vaultPda(g.pubkey),
        players: g.players,
      });
      await sendWalletTx(connection, wallet, tx, { label: "Cancel game & refund crew" });
    } finally {
      setBusy(null);
    }
  };

  return { busy, create, join, start, cancel };
}
