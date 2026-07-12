import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import idl from "../idl/liar_dice.json";
import type { LiarDice } from "../idl/liar_dice";
import { readerIdentity } from "./connection";

type AnchorWalletLike = AnchorProvider["wallet"];

export function programOn(connection: Connection, wallet: AnchorWalletLike): Program<LiarDice> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program<LiarDice>(idl as unknown as LiarDice, provider);
}

// Stub wallet for spectator reads: Anchor's Provider needs a wallet-shaped object
// to construct, but a spectator never sends a transaction — every signing method
// throws if it's ever accidentally called, instead of silently misbehaving.
export function readOnlyWallet(): AnchorWalletLike {
  const publicKey = readerIdentity();
  const refuse = () => {
    throw new Error("Read-only spectator wallet cannot sign transactions.");
  };
  return { publicKey, signTransaction: refuse, signAllTransactions: refuse } as AnchorWalletLike;
}
