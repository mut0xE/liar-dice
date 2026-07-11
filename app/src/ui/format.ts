import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

export const short = (k: PublicKey) =>
  k.toBase58().slice(0, 4) + "…" + k.toBase58().slice(-4);

export const sol = (l: BN | number) =>
  ((typeof l === "number" ? l : l.toNumber()) / LAMPORTS_PER_SOL).toFixed(3);
