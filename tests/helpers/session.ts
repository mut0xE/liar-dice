import { Keypair } from "@solana/web3.js";
import { writeFileSync } from "fs";

// PDA seed used by `create_session_v2` (SessionTokenManager) in gum-sdk.
export const SESSION_TOKEN_SEED = "session_token_v2";

// Session signers are generated once and appended to `.env`; every later run
// reuses the same key (via dotenv) so we don't re-pay for a fresh session each
// time. Money instructions stay wallet-signed; only gameplay uses these.
export function getHostSessionKeypair(): Keypair {
  return loadOrCreate("HOST_SESSION_KEY");
}

export function getPlayerBSessionKeypair(): Keypair {
  return loadOrCreate("PLAYER_B_SESSION_KEY");
}

function loadOrCreate(envVar: string): Keypair {
  if (process.env[envVar]) {
    const secret = JSON.parse(process.env[envVar]!) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  const keypair = Keypair.generate();
  writeFileSync(".env", `\n${envVar}=[${keypair.secretKey.toString()}]\n`, {
    flag: "a",
  });
  console.log(`[session] generated + persisted ${envVar} (added to .env)`);
  return keypair;
}
