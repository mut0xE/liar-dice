import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { pushToast } from "./toast";

export const short = (k: PublicKey) =>
  k.toBase58().slice(0, 4) + "…" + k.toBase58().slice(-4);

export const sol = (l: BN | number) =>
  ((typeof l === "number" ? l : l.toNumber()) / LAMPORTS_PER_SOL).toFixed(3);

// Every on-screen address is click-to-copy — no separate copy icon/button needed.
export const copyAddress = (key: PublicKey | string) => {
  const addr = typeof key === "string" ? key : key.toBase58();
  navigator.clipboard?.writeText(addr);
  pushToast({ kind: "success", label: "Address copied" });
};
