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

// Stub wallet for spectator reads — signing methods throw if ever called.
export function readOnlyWallet(): AnchorWalletLike {
  const publicKey = readerIdentity();
  const refuse = () => {
    throw new Error("Read-only spectator wallet cannot sign transactions.");
  };
  return { publicKey, signTransaction: refuse, signAllTransactions: refuse } as AnchorWalletLike;
}
