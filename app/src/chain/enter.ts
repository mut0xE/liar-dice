import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { programOn } from "./program";
import { handPda, permissionPda, sessionTokenPda } from "./pdas";
import { normalizeErEndpoint, teeValidator } from "./connection";
import {
  gameplayConnectionFor,
  isAccountDelegated,
  waitForDelegation,
  waitForErClone,
} from "./delegation";
import { buildDelegateHandIx, buildInitHandPermission } from "./builders";
import { sendSessionTx } from "./sendSession";
import {
  getOrCreateSessionKey,
  sessionManager,
  buildCreateSessionIx,
  buildRevokeSessionIx,
  readSessionValidUntil,
} from "./session";
import { withTxToast } from "../ui/toast";
import { transactionErrorMessage } from "./txError";
import type { GameSummary } from "./games";

export type HandSetup = {
  session: Keypair;
  sessionToken: PublicKey;
  identity: PublicKey;
};

// The onchain `join_game` pre-funds the hand PDA for a SINGLE-member ephemeral
// permission — `rent(size_of(1))`. But `init_hand_permission` is session-signed, so
// it writes TWO members: the wallet AND the session key (the session key MUST be a
// permission member to submit/read the hand on the ER). That extra member is one
// `Member::SIZE` (33 bytes) of ER rent the program doesn't cover, so we top the hand
// PDA up here on base BEFORE delegation; the lamports ride onto the ER with the hand
// and are spent when the 2-member permission is created. (Same pre-funding idea as
// MagicBlock's private-counter example, just covering the client-added member.)
//
// ER rent is `(bytes + 60) * 32`; one extra 33-byte member ⇒ 33 * 32 = 1056 lamports.
const EPHEMERAL_RENT_PER_BYTE = 32;
const MEMBER_SIZE = 33; // repr(C): u8 flags + 32-byte pubkey, no padding
const EXTRA_PERMISSION_MEMBER_RENT = MEMBER_SIZE * EPHEMERAL_RENT_PER_BYTE; // 1056

function permissionCacheKey(permission: PublicKey): string {
  return `liar-dice:permission-ready:${permission.toBase58()}`;
}

function permissionMarkedReady(permission: PublicKey): boolean {
  try {
    return globalThis.localStorage?.getItem(permissionCacheKey(permission)) === "1";
  } catch {
    return false;
  }
}

function markPermissionReady(permission: PublicKey): void {
  try {
    globalThis.localStorage?.setItem(permissionCacheKey(permission), "1");
  } catch {
    // localStorage is just an idempotency hint; setup is still safe without it.
  }
}

type Ctx = {
  connection: Connection;
  wallet: Wallet;
  game: GameSummary;
  onStatus?: (s: string) => void;
  onDetail?: (line: string) => void;
  /** Instructions to run BEFORE delegation in the same wallet tx (e.g. join_game).
   *  Forces the tx to send even if delegation/session are otherwise up to date. */
  prependIxs?: TransactionInstruction[];
};

/**
 * Idempotently ensure the CALLER's hand is delegated to the ER, their session key
 * exists, and their dice are made private. Meant to run ONCE at join time and bundled
 * so the player signs a single wallet tx (delegate_hand [+ revoke] + create_session).
 *
 * Safe to re-run (resume): each step is guarded, so nothing pops the wallet again once
 * it's set up. The game PDA is NOT touched here — it delegates separately at start.
 */
export async function setUpHand(ctx: Ctx): Promise<HandSetup> {
  const { connection, wallet, game } = ctx;
  const status = ctx.onStatus ?? (() => {});
  const detail = ctx.onDetail ?? (() => {});

  const session = getOrCreateSessionKey(game.pubkey.toBase58());
  const manager = sessionManager(wallet, connection);
  const sessionToken = sessionTokenPda(session.publicKey, wallet.publicKey, manager.program.programId);
  const hand = handPda(game.pubkey, wallet.publicKey);
  const permission = permissionPda(hand);

  status("Attesting TEE validator…");
  const { identity } = await teeValidator();
  detail(`validator ${identity.toBase58().slice(0, 8)}…`);

  const baseProgram = programOn(connection, wallet);

  // Only include delegate_hand if the hand is still on base (resume-safe: no popup
  // for an already-delegated hand).
  status("Checking hand delegation…");
  const handDelegated = await isAccountDelegated(hand);
  const enterTx = new Transaction();
  if (ctx.prependIxs?.length) enterTx.add(...ctx.prependIxs);
  if (!handDelegated) {
    status("Delegating your hand to the rollup…");
    // Top up the hand PDA for the session-key permission member BEFORE delegating,
    // so the lamports travel onto the ER with the hand (see note above). Must precede
    // the delegate ix — once delegated, base-layer top-ups no longer reach the ER clone.
    enterTx.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: hand,
        lamports: EXTRA_PERMISSION_MEMBER_RENT,
      })
    );
    enterTx.add(
      await buildDelegateHandIx(baseProgram, {
        player: wallet.publicKey,
        host: game.host,
        game: game.pubkey,
        gameId: game.gameId,
        playerHand: hand,
        validatorIdentity: identity,
      })
    );
  } else {
    detail("hand already delegated — skipping");
  }

  // Session token: create only if missing/expired (within 5 min of expiry).
  const validUntil = await readSessionValidUntil(connection, sessionToken);
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenUsable = validUntil !== null && validUntil > nowSec + 300;
  const isRefresh = !tokenUsable && validUntil !== null;
  if (!tokenUsable) {
    if (isRefresh) {
      status("Refreshing expired session key…");
      detail("session key expired — minting a fresh one");
      enterTx.add(
        await buildRevokeSessionIx(manager, {
          sessionToken,
          authority: wallet.publicKey,
          feePayer: wallet.publicKey,
        })
      );
    }
    enterTx.add(
      await buildCreateSessionIx(manager, {
        targetProgram: baseProgram.programId,
        sessionSigner: session.publicKey,
        feePayer: wallet.publicKey,
      })
    );
  }

  if (enterTx.instructions.length > 0) {
    enterTx.feePayer = wallet.publicKey;
    enterTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    // If we're creating a session, the granted key co-signs its own creation.
    if (!tokenUsable) enterTx.partialSign(session);
    const label = !tokenUsable
      ? isRefresh
        ? "Refresh session key"
        : "Delegate hand + session"
      : "Delegate hand";
    await withTxToast(label, async () => {
      try {
        const signed = await wallet.signTransaction(enterTx);
        const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, "confirmed");
        return sig;
      } catch (error) {
        throw new Error(await transactionErrorMessage(error, connection));
      }
    });
  }

  // Dice are made private LAZILY on the player's first action (see
  // `ensureHandPermission`, called from the roll/bid path) rather than here, so
  // joining the table stays fast even with many players and the permission tx
  // isn't paid until the seat actually plays.
  void permission;
  return { session, sessionToken, identity };
}

/**
 * Idempotently make the caller's hand private on the ER by creating its ephemeral
 * permission. Deferred to the player's FIRST action (roll/bid) instead of running
 * eagerly at join. Safe to call before every action: guarded by a localStorage hint
 * and an on-chain existence check, so it sends at most one "Make dice private" tx.
 *
 * Runs on the ER connection/program the caller already uses for gameplay — no extra
 * router round-trip. Must complete before the first roll writes dice, or there's a
 * brief window where the rolled dice are world-readable.
 */
export async function ensureHandPermission(
  erConnection: Connection,
  erProgram: ReturnType<typeof programOn>,
  s: { session: Keypair; authority: PublicKey; sessionToken: PublicKey },
  hand: PublicKey
): Promise<void> {
  const permission = permissionPda(hand);
  if (permissionMarkedReady(permission)) return;
  await waitForErClone(erConnection, hand, "Your hand");
  if (await erConnection.getAccountInfo(permission)) {
    markPermissionReady(permission);
    return;
  }
  const permTx = await buildInitHandPermission(
    erProgram,
    { sessionSigner: s.session, authority: s.authority, sessionToken: s.sessionToken },
    { playerHand: hand, permission }
  );
  await sendSessionTx(erConnection, permTx.sessionSigner, permTx.tx, "Make dice private");
  markPermissionReady(permission);
}

/**
 * Resolve the ER endpoint for gameplay once the game is delegated (after start).
 * Requires BOTH the game and the caller's hand delegated to the same validator.
 */
export async function resolveGameplayEndpoint(
  game: PublicKey,
  hand: PublicKey
): Promise<{ fqdn: string }> {
  await waitForDelegation(game, "Game");
  await waitForDelegation(hand, "Your hand");
  const { fqdn } = await gameplayConnectionFor([game, hand]);
  return { fqdn: normalizeErEndpoint(fqdn) };
}
