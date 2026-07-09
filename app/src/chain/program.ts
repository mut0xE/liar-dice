import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import idl from "../idl/liar_dice.json";
import type { LiarDice } from "../idl/liar_dice";

type AnchorWalletLike = AnchorProvider["wallet"];

export function programOn(connection: Connection, wallet: AnchorWalletLike): Program<LiarDice> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program<LiarDice>(idl as unknown as LiarDice, provider);
}
