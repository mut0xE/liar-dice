import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, ROUTER_ENDPOINT } from "./constants";
import { normalizeErEndpoint } from "./connection";

export type DelegationStatus = {
  isDelegated: boolean;
  fqdn?: string;
  delegationRecord?: {
    authority: string;
    owner: string;
    delegationSlot: number;
    lamports: number;
  };
};

export async function getDelegationStatus(account: PublicKey): Promise<DelegationStatus> {
  const response = await fetch(ROUTER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: account.toBase58(),
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: DelegationStatus;
  };
  if (body.error) {
    throw new Error(body.error.message ?? "MagicBlock router rejected delegation status request.");
  }
  return body.result ?? { isDelegated: false };
}

/**
 * Best-effort "is this account already delegated on MagicBlock?" check.
 *
 * Used to make the enter-rollup flow idempotent: on a resume we must NOT re-send
 * the `delegate` tx (the wallet would pop up to sign a no-op). The router returns
 * `isDelegated: false` — or errors — for an account it doesn't know about, so we
 * swallow errors and treat them as "not delegated yet".
 */
export async function isAccountDelegated(account: PublicKey): Promise<boolean> {
  try {
    const status = await getDelegationStatus(account);
    return Boolean(status.isDelegated && status.fqdn);
  } catch {
    return false;
  }
}

export async function waitForDelegation(
  account: PublicKey,
  label: string,
  tries = 30
): Promise<DelegationStatus> {
  for (let i = 0; i < tries; i++) {
    const status = await getDelegationStatus(account);
    if (status.isDelegated && status.fqdn) return status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} is not delegated on MagicBlock yet. Wait a moment and retry.`);
}

/**
 * Wait until an account is actually CLONED into the ER validator, i.e. owned by
 * our program on the ER endpoint.
 *
 * The router's `getDelegationStatus` flips to `isDelegated` as soon as the
 * base-layer delegation record exists — but the ER validator clones the account
 * a beat later. Any instruction that reads the account as `Account<T>` in that
 * window fails with AccountOwnedByWrongProgram (owner shows System / 111…11),
 * which is exactly the `init_hand_permission` 0xbbf failure. Poll here first.
 */
export async function waitForErClone(
  connection: Connection,
  account: PublicKey,
  label: string,
  tries = 30
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(account);
    if (info && info.owner.equals(PROGRAM_ID)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} has not finished syncing to the rollup yet. Wait a moment and retry.`);
}

export async function gameplayConnectionFor(accounts: PublicKey[]): Promise<{
  connection: Connection;
  fqdn: string;
  statuses: DelegationStatus[];
}> {
  const statuses = await Promise.all(accounts.map((account) => getDelegationStatus(account)));
  const missing = statuses.findIndex((status) => !status.isDelegated || !status.fqdn);
  if (missing >= 0) {
    throw new Error("Required delegated account is not ready on MagicBlock.");
  }

  const endpoints = new Set(statuses.map((status) => normalizeErEndpoint(status.fqdn!)));
  if (endpoints.size !== 1) {
    throw new Error("Delegated accounts are on different MagicBlock ER endpoints. Redelegate or resync.");
  }

  const fqdn = normalizeErEndpoint(statuses[0].fqdn!);
  return {
    connection: new Connection(fqdn, { commitment: "confirmed" }),
    fqdn,
    statuses,
  };
}
