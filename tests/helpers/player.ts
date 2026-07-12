import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { LiarDice } from "../../target/types/liar_dice";
import { handPda, sessionTokenPda } from "./accounts";
import { authedErConnection, erProgramOn, sendBuilt } from "./connections";
import { Built } from "./instructions";

// One player: wallet is the real identity, session signs moves on the ER (no popups),
// tee is this player's own private TEE connection.
export type Player = {
  label: string;
  wallet: Keypair;
  session: Keypair;
  hand: PublicKey; // this player's dice PDA
  sessionToken: PublicKey; // links session -> wallet
  tee?: Program<LiarDice>; // set in connectToTee: private-hand reads + sends
};

// Build a player (PDAs are deterministic, so derive them up front).
export function makePlayer(
  program: Program<LiarDice>,
  game: PublicKey,
  label: string,
  wallet: Keypair,
  session: Keypair,
  sessionProgramId: PublicKey
): Player {
  return {
    label,
    wallet,
    session,
    hand: handPda(program.programId, game, wallet.publicKey),
    sessionToken: sessionTokenPda(
      program.programId,
      session.publicKey,
      wallet.publicKey,
      sessionProgramId
    ),
  };
}

// The session accounts every gameplay builder needs.
export function sessionCtx(p: Player) {
  return {
    sessionSigner: p.session,
    authority: p.wallet.publicKey,
    sessionToken: p.sessionToken,
  };
}

// Send a built tx over THIS player's own TEE connection.
export function sendTee(
  p: Player,
  built: Built,
  opts?: { feePayer?: PublicKey; printLogs?: boolean }
): Promise<string> {
  return sendBuilt(p.tee!.provider.connection, built, opts);
}

// Give each player their OWN token-authed TEE connection.
// Returns one shared program authed as the provided wallet, for PUBLIC game reads only.
export async function connectToTee(
  program: Program<LiarDice>,
  wallet: anchor.Wallet,
  fqdn: string,
  players: Player[]
): Promise<Program<LiarDice>> {
  for (const p of players) {
    const conn = await authedErConnection(fqdn, p.wallet); // authed as THIS player
    p.tee = erProgramOn(program, conn, wallet);
  }
  const publicConn = await authedErConnection(fqdn, wallet.payer);
  return erProgramOn(program, publicConn, wallet);
}

// Prove privacy: each player may read only their OWN hand, never another's.
// (flow.ts spells these out as individual test cases; stall.ts uses this matrix.)
export async function assertHandsPrivate(players: Player[]): Promise<void> {
  const canRead = async (reader: Player, hand: PublicKey): Promise<boolean> => {
    try {
      await reader.tee!.account.playerHand.fetch(hand);
      return true;
    } catch {
      return false;
    }
  };
  let ok = true;
  for (const reader of players) {
    for (const owner of players) {
      const expected = reader === owner; // only the owner may read
      const allowed = await canRead(reader, owner.hand);
      const mark = allowed === expected ? "✓" : "✗ UNEXPECTED";
      console.log(
        `   ${mark}  ${reader.label} token → ${owner.label}'s hand: ` +
          `${allowed ? "READABLE" : "denied"}`
      );
      if (allowed !== expected) ok = false;
    }
  }
  if (!ok)
    throw new Error("PRIVACY BROKEN: a player read another player's hand");
}
