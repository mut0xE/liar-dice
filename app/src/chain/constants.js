import { PublicKey } from "@solana/web3.js";
export const PROGRAM_ID = new PublicKey("4Q9UvCjAeKP8xRBLNoSx3ZCp4vmrGXpKcZ1td3RRbzMN");
export const DEVNET_ENDPOINT = import.meta.env.VITE_HELIUS_RPC_URL || "https://api.devnet.solana.com";
export const DEVNET_TEE_ENDPOINT = "https://devnet-tee.magicblock.app";
export const ROUTER_ENDPOINT = "https://devnet-router.magicblock.app/";
export const GAME_SEED = Buffer.from("game");
export const HAND_SEED = Buffer.from("hand");
export const VAULT_SEED = Buffer.from("vault");
export const IDENTITY_SEED = Buffer.from("identity");
