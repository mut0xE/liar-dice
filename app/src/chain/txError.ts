import { Connection, SendTransactionError } from "@solana/web3.js";

// Player-facing text for the program's error codes (mirrors errors.rs order).
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "It's not your turn",
  6001: "The game already moved on — state refreshed",
  6002: "Bid face must be between 1 and 6",
  6003: "Bid quantity must be at least 1",
  6004: "Bid exceeds the dice left on the table",
  6005: "A bid must raise the quantity or the face",
  6006: "There's no bid to challenge yet",
  6007: "Roll your dice first",
  6008: "The table is full",
  6009: "Need at least 2 players",
  6010: "That player is already out",
  6011: "You already joined this table",
  6012: "Incorrect entry amount",
  6013: "You're not allowed to do that",
  6014: "Amount overflow",
  6015: "A required player hand was missing",
  6016: "That was already done by someone else",
  6017: "The game doesn't have a winner yet",
  6018: "The round was already settled",
  6019: "You already rolled this round",
  6020: "Timeout grace must be greater than zero",
  6021: "The timer hasn't run out yet",
  6022: "That player isn't the one holding up the game",
};

// Runtime (non-Anchor) instruction errors, surfaced as raw enum names in the
// confirm result, e.g. {"InstructionError":[0,"ReadonlyDataModified"]}.
const RUNTIME_ERRORS: Record<string, string> = {
  ReadonlyDataModified:
    "This game was already committed back to Solana — there's nothing left to do here.",
  AccountNotFound: "That account no longer exists — the game may have ended.",
  InsufficientFunds: "Not enough SOL to cover this transaction.",
};

// "Transaction reverted (custom program error: 6004)" →
// "Bid exceeds the dice left on the table (code 6004)".
export function friendlyProgramError(message: string): string {
  const m = /custom program error: (\d+)/.exec(message);
  if (m) {
    const code = Number(m[1]);
    const text = PROGRAM_ERRORS[code];
    return text ? `${text} (code ${code})` : message;
  }
  // Raw runtime enum inside a reverted-tx JSON blob → plain sentence.
  for (const [name, text] of Object.entries(RUNTIME_ERRORS)) {
    if (message.includes(name)) return text;
  }
  return message;
}

function compactLogs(logs: string[]): string {
  return logs
    .filter((line) => line.includes("Program log:") || line.includes("failed:") || line.includes("Error"))
    .slice(-8)
    .map((line) => line.replace(/^Program log:\s*/, ""))
    .join("\n");
}

export async function transactionErrorMessage(error: unknown, connection: Connection): Promise<string> {
  const base = friendlyProgramError(error instanceof Error ? error.message : String(error));
  if (error instanceof SendTransactionError) {
    try {
      const logs = await error.getLogs(connection);
      if (logs?.some((line) => line.includes("InstructionFallbackNotFound"))) {
        return [
          "The deployed liar-dice program does not recognize one of the instructions this app is sending.",
          "Most likely the devnet program was not redeployed after adding delegate_hand/delegate_game.",
          "Run `anchor build && anchor deploy`, then refresh and join a newly created table.",
        ].join("\n");
      }
      if (logs?.length) return `${base}\n${compactLogs(logs)}`;
    } catch {
      return base;
    }
  }
  return base;
}
