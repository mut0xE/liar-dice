import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { gameplayConnectionFor, getDelegationStatus } from "../delegation";

const game = new PublicKey("11111111111111111111111111111111");
const hand = new PublicKey("So11111111111111111111111111111111111111112");

function mockRouter(results: unknown[]) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({ result: results[i++] }),
    }))
  );
}

describe("delegation routing", () => {
  it("reads router delegation status for one account", async () => {
    mockRouter([{ isDelegated: true, fqdn: "https://devnet-tee.magicblock.app/" }]);

    await expect(getDelegationStatus(game)).resolves.toMatchObject({
      isDelegated: true,
      fqdn: "https://devnet-tee.magicblock.app/",
    });
  });

  it("returns the shared ER endpoint when all required accounts match", async () => {
    mockRouter([
      { isDelegated: true, fqdn: "https://devnet-tee.magicblock.app/" },
      { isDelegated: true, fqdn: "https://devnet-tee.magicblock.app/" },
    ]);

    const route = await gameplayConnectionFor([game, hand]);
    expect(route.fqdn).toBe("https://devnet-tee.magicblock.app");
  });

  it("treats trailing-slash and non-trailing-slash ER endpoints as the same route", async () => {
    mockRouter([
      { isDelegated: true, fqdn: "https://devnet-tee.magicblock.app/" },
      { isDelegated: true, fqdn: "https://devnet-tee.magicblock.app" },
    ]);

    const route = await gameplayConnectionFor([game, hand]);
    expect(route.fqdn).toBe("https://devnet-tee.magicblock.app");
  });

  it("rejects gameplay when delegated accounts are on different ER endpoints", async () => {
    mockRouter([
      { isDelegated: true, fqdn: "https://devnet-tee.magicblock.app/" },
      { isDelegated: true, fqdn: "https://devnet-as.magicblock.app/" },
    ]);

    await expect(gameplayConnectionFor([game, hand])).rejects.toThrow(/different MagicBlock ER endpoints/);
  });
});
