import { Connection, SendTransactionError } from "@solana/web3.js";

function compactLogs(logs: string[]): string {
  return logs
    .filter((line) => line.includes("Program log:") || line.includes("failed:") || line.includes("Error"))
    .slice(-8)
    .map((line) => line.replace(/^Program log:\s*/, ""))
    .join("\n");
}

export async function transactionErrorMessage(error: unknown, connection: Connection): Promise<string> {
  const base = error instanceof Error ? error.message : String(error);
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
