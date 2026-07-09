import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { LiarDice } from "../idl/liar_dice";

export type GameStatus = "Waiting" | "Active" | "Ended";
const STATUS_OFFSET = 8 + 32 + 8; // discriminator + host + game_id

export function statusFromAccountData(data: Buffer | Uint8Array): GameStatus {
  const b = data[STATUS_OFFSET];
  return b === 0 ? "Waiting" : b === 1 ? "Active" : "Ended";
}

export type GameSummary = {
  pubkey: PublicKey;
  host: PublicKey;
  gameId: BN;
  entryFeeLamports: BN;
  players: PublicKey[];
};

// List all joinable (Waiting) games straight off base layer — token-free.
export async function listWaitingGames(program: Program<LiarDice>): Promise<GameSummary[]> {
  const all = await program.account.game.all();
  return all
    .filter((g) => Object.keys(g.account.status)[0] === "waiting")
    .map((g) => ({
      pubkey: g.publicKey,
      host: g.account.host,
      gameId: g.account.gameId,
      entryFeeLamports: g.account.entryFeeLamports,
      players: g.account.players,
    }));
}
