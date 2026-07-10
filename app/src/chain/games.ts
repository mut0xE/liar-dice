import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { LiarDice } from "../idl/liar_dice";
import { programOn } from "./program";
import { readerErConnection, resetReaderErConnection } from "./connection";

export type GameStatus = "Waiting" | "Active" | "Ended";
export type GamePhase = "Rolling" | "Bidding" | "Revealing";
const STATUS_OFFSET = 8 + 32 + 8; // discriminator + host + game_id

export function statusFromAccountData(data: Buffer | Uint8Array): GameStatus {
  const b = data[STATUS_OFFSET];
  return b === 0 ? "Waiting" : b === 1 ? "Active" : "Ended";
}

export type Bid = { quantity: number; face: number; bidder: number };

export type GameSummary = {
  pubkey: PublicKey;
  host: PublicKey;
  gameId: BN;
  entryFeeLamports: BN;
  players: PublicKey[];
  status: GameStatus;
  potLamports: BN;
  round: number;
  phase: GamePhase;
  currentTurn: number;
  currentBid: Bid | null;
  // Seats still alive. For an Ended game a single survivor is the winner.
  activeSeats: boolean[];
  winner: PublicKey | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGame(pubkey: PublicKey, a: any): GameSummary {
  const status = (
    Object.keys(a.status)[0] as string
  ).replace(/^./, (c) => c.toUpperCase()) as GameStatus;
  const phase = (
    Object.keys(a.phase)[0] as string
  ).replace(/^./, (c) => c.toUpperCase()) as GamePhase;
  const activeSeats: boolean[] = a.isActive;
  const players: PublicKey[] = a.players;

  let winner: PublicKey | null = null;
  if (status === "Ended") {
    const aliveIdxs = activeSeats
      .map((alive, i) => (alive ? i : -1))
      .filter((i) => i >= 0);
    if (aliveIdxs.length === 1) winner = players[aliveIdxs[0]] ?? null;
  }

  return {
    pubkey,
    host: a.host,
    gameId: a.gameId,
    entryFeeLamports: a.entryFeeLamports,
    players,
    status,
    potLamports: a.potLamports,
    round: a.round,
    phase,
    currentTurn: a.currentTurn,
    currentBid: a.currentBid ?? null,
    activeSeats,
    winner,
  };
}

// Fetch every game off base layer in one pass (token-free) and map to summaries.
export async function listGames(program: Program<LiarDice>): Promise<GameSummary[]> {
  const all = await program.account.game.all();
  return all
    .map((g) => mapGame(g.publicKey, g.account))
    .sort((a, b) => b.gameId.cmp(a.gameId)); // newest first
}

// List all joinable (Waiting) games straight off base layer — token-free.
export async function listWaitingGames(program: Program<LiarDice>): Promise<GameSummary[]> {
  return (await listGames(program)).filter((g) => g.status === "Waiting");
}

// Delegated (Active/Ongoing) games no longer show up on base layer: once a game
// is delegated, the delegation program owns its account there, so base-layer
// getProgramAccounts (owner == our program) drops it. On the ER endpoint the
// account is owned by our program again, so read active games from there.
// Best-effort: returns [] on any ER hiccup so the lobby never breaks.
type AnchorWalletLike = Parameters<typeof programOn>[1];

export async function listErGames(wallet: AnchorWalletLike): Promise<GameSummary[]> {
  try {
    const conn = await readerErConnection();
    const erProgram = programOn(conn, wallet);
    const all = await erProgram.account.game.all();
    return all.map((g) => mapGame(g.publicKey, g.account));
  } catch {
    resetReaderErConnection(); // token likely expired/invalid — re-auth next tick
    return [];
  }
}

// Full lobby view: base-layer games (Waiting + Ended) merged with delegated
// games read off the ER (Active/Ongoing). ER copy wins on conflict since it
// holds the freshest live state for a game in progress.
export async function listAllGames(
  baseProgram: Program<LiarDice>,
  wallet: AnchorWalletLike
): Promise<GameSummary[]> {
  const [base, er] = await Promise.all([listGames(baseProgram), listErGames(wallet)]);
  const byKey = new Map<string, GameSummary>();
  for (const g of base) byKey.set(g.pubkey.toBase58(), g);
  for (const g of er) byKey.set(g.pubkey.toBase58(), g); // ER overrides base
  return [...byKey.values()].sort((a, b) => b.gameId.cmp(a.gameId));
}
