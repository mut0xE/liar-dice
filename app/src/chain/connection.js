import { Connection, PublicKey } from "@solana/web3.js";
import { ConnectionMagicRouter, getAuthToken, verifyTeeRpcIntegrity, } from "@magicblock-labs/ephemeral-rollups-sdk";
import { DEVNET_ENDPOINT, DEVNET_TEE_ENDPOINT, ROUTER_ENDPOINT } from "./constants";
export function baseConnection() {
    return new Connection(DEVNET_ENDPOINT, { commitment: "confirmed" });
}
export function routerConnection() {
    return new ConnectionMagicRouter(ROUTER_ENDPOINT, {
        wsEndpoint: ROUTER_ENDPOINT.replace(/^https:\/\//, "wss://"),
    });
}
// Resolve the TEE validator identity + fqdn (attested before trusting private dice).
export async function teeValidator() {
    const fqdn = DEVNET_TEE_ENDPOINT;
    await verifyTeeRpcIntegrity(fqdn);
    const res = (await fetch(fqdn, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
    }).then((r) => r.json()));
    return { identity: new PublicKey(res.result.identity), fqdn };
}
// Authed TEE connection. `signMessage` signs the auth challenge as `pubkey`
// (wallet-adapter's signMessage, or a session key's nacl signer). The token
// identity decides which private accounts this connection may read.
export async function authedErConnection(fqdn, signMessage, pubkey) {
    const { token } = await getAuthToken(fqdn, pubkey, signMessage);
    const http = `${fqdn.replace(/\/$/, "")}?token=${token}`;
    const ws = http.replace(/^http/, "ws");
    return new Connection(http, { wsEndpoint: ws, commitment: "confirmed" });
}
