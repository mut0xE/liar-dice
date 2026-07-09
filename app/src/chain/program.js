import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "../idl/liar_dice.json";
export function programOn(connection, wallet) {
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    return new Program(idl, provider);
}
