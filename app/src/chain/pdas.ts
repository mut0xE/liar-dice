import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  PROGRAM_ID,
  GAME_SEED,
  HAND_SEED,
  VAULT_SEED,
  IDENTITY_SEED,
} from "./constants";

const SESSION_TOKEN_SEED = "session_token_v2";

export function gamePda(host: PublicKey, gameId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, host.toBuffer(), gameId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}
export function handPda(game: PublicKey, player: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [HAND_SEED, game.toBuffer(), player.toBuffer()],
    PROGRAM_ID
  )[0];
}
export function vaultPda(game: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED, game.toBuffer()], PROGRAM_ID)[0];
}
export function programIdentityPda(): PublicKey {
  return PublicKey.findProgramAddressSync([IDENTITY_SEED], PROGRAM_ID)[0];
}
export function permissionPda(hand: PublicKey): PublicKey {
  return permissionPdaFromAccount(hand);
}
export function sessionTokenPda(
  sessionSigner: PublicKey,
  authority: PublicKey,
  sessionProgramId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_SEED),
      PROGRAM_ID.toBytes(),
      sessionSigner.toBytes(),
      authority.toBytes(),
    ],
    sessionProgramId
  )[0];
}
