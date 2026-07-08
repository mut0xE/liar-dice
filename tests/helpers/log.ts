import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { LiarDice } from "../../target/types/liar_dice";

export function logSection(title: string): void {
  console.log("");
  console.log(`== ${title} ==`);
}

// ── Human-readable dice / bid formatting (for the round narrative) ───────────
const FACE_WORDS = ["", "one", "two", "three", "four", "five", "six"];

/** "two", "five", ... (falls back to the number for anything out of range). */
export function faceWord(face: number): string {
  return FACE_WORDS[face] ?? String(face);
}

/** A bid as English: (1, 4) -> `1 four`, (3, 1) -> `3 ones`. */
export function bidPhrase(quantity: number, face: number): string {
  return `${quantity} ${faceWord(face)}${quantity === 1 ? "" : "s"}`;
}

/** The live face of a hand as `[3,2,2,6,6]`. */
export function diceStr(dice: number[], count: number): string {
  return `[${dice.slice(0, count).join(",")}]`;
}

/** A running scoreboard line: `host 5 dice, playerB 4 dice`. */
export function scoreLine(
  seats: { label: string }[],
  diceCounts: number[]
): string {
  return seats.map((s, i) => `${s.label} ${diceCounts[i]} dice`).join(", ");
}

export function logTx(label: string, tx: string, isEr = false): void {
  const tag = isEr ? "[ER]" : "[devnet]";
  console.log(`${label} ${tag}  ${tx}`);
}

export function logAccount(label: string, pubkey: PublicKey): void {
  console.log(`   ${label}: ${pubkey.toBase58()}`);
}

export function logField(label: string, value: unknown): void {
  const v = value instanceof BN ? value.toString() : JSON.stringify(value);
  console.log(`   ${label}: ${v}`);
}

export function logError(label: string, err: any): void {
  console.log(`${label}: ${err?.message || err}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Live on-chain PDA table — logs EVERY pda whether it exists or not.
// ─────────────────────────────────────────────────────────────────────────
export type PdaEntry = { label: string; pubkey: PublicKey };

/**
 * For each PDA, query the given (live) connection and print whether it exists,
 * who owns it, and its size. PDAs that don't exist are shown too, so you can
 * see exactly what is and isn't on-chain at this point in the flow.
 */
export async function logPdas(
  connection: Connection,
  title: string,
  entries: PdaEntry[]
): Promise<void> {
  const endpoint = (connection as any)._rpcEndpoint || "";
  const isEr = /magicblock|router/i.test(endpoint);
  const where = isEr ? "ER" : "devnet";
  console.log("");
  console.log(`PDAs (${title}) @ ${where}`);

  const width = Math.max(...entries.map((e) => e.label.length));
  const infos = await connection.getMultipleAccountsInfo(
    entries.map((e) => e.pubkey)
  );

  entries.forEach((e, i) => {
    const label = e.label.padEnd(width);
    const key = e.pubkey.toBase58();
    const mark = infos[i] ? "exists" : "-";
    console.log(`   ${label}  ${key}  ${mark}`);
  });
}

export async function logGame(
  program: Program<LiarDice>,
  game: PublicKey,
  label: string
): Promise<void> {
  const g = await program.account.game.fetch(game);
  console.log("");
  console.log(`game — ${label}`);
  console.log(
    `   status=${JSON.stringify(g.status)}  round=${String(
      g.round
    )}  turn=${String(g.currentTurn)}`
  );
  console.log(
    `   players=${g.players.length}  dice_counts=[${g.diceCounts.join(
      ","
    )}]  active=[${g.isActive.join(",")}]`
  );
  console.log(
    `   phase=${JSON.stringify(g.phase)}  bid=${
      g.currentBid ? JSON.stringify(g.currentBid) : "none"
    }  reveals=${g.lastReveal.length}`
  );
  console.log(`   pot_lamports=${g.potLamports.toString()}`);
}

export async function logHand(
  program: Program<LiarDice>,
  hand: PublicKey,
  label: string
): Promise<void> {
  const h = await program.account.playerHand.fetch(hand);
  console.log(`hand — ${label}  ${hand.toBase58()}`);
  console.log(
    `   rolled=${h.rolled} revealed=${h.revealed} dice_count=${
      h.diceCount
    } dice=[${h.dice.join(",")}]`
  );
}

export async function logLamports(
  connection: Connection,
  pubkey: PublicKey,
  label: string
): Promise<void> {
  const lamports = await connection.getBalance(pubkey);
  console.log(
    `${label.padEnd(18)} ${(lamports / 1_000_000_000).toFixed(
      9
    )} SOL  ${pubkey.toBase58()}`
  );
}

/**
 * One grouped balance snapshot — every named account's SOL side by side, so a
 * before/after pair around an instruction reads as a clean table.
 */
export async function logBalances(
  connection: Connection,
  title: string,
  entries: { label: string; pubkey: PublicKey }[]
): Promise<void> {
  console.log("");
  console.log(`balances — ${title}`);
  const width = Math.max(...entries.map((e) => e.label.length));
  const infos = await connection.getMultipleAccountsInfo(
    entries.map((e) => e.pubkey)
  );
  entries.forEach((e, i) => {
    const lamports = infos[i]?.lamports ?? 0;
    console.log(
      `   ${e.label.padEnd(width)}  ${(lamports / 1_000_000_000).toFixed(
        9
      )} SOL  ${e.pubkey.toBase58()}`
    );
  });
}

/**
 * Fetch a game before and after running `action`, printing both snapshots so
 * the on-chain effect of an instruction is obvious side by side.
 */
export async function logChange(
  program: Program<LiarDice>,
  game: PublicKey,
  label: string,
  action: () => Promise<void>
): Promise<void> {
  await logGame(program, game, "BEFORE " + label);
  await action();
  await logGame(program, game, "AFTER " + label);
}
