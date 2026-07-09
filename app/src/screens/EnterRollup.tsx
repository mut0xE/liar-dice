import { useEffect, useRef, useState } from "react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { programOn } from "../chain/program";
import { handPda, permissionPda, sessionTokenPda } from "../chain/pdas";
import { teeValidator } from "../chain/connection";
import { buildDelegateIx, buildInitHandPermission } from "../chain/builders";
import { getOrCreateSessionKey, sessionManager, buildCreateSessionIx } from "../chain/session";
import { sendWalletTx } from "../chain/sendWallet";
import { GameSummary } from "../chain/games";

export function EnterRollup({
  game,
  onReady,
}: {
  game: GameSummary;
  onReady: (a: { session: Keypair; sessionToken: PublicKey; fqdn: string; validatorIdentity: PublicKey }) => void;
}) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [status, setStatus] = useState("Preparing…");
  const ran = useRef(false);

  useEffect(() => {
    if (!wallet || ran.current) return;
    ran.current = true;
    (async () => {
      const program = programOn(connection, wallet);
      const session = getOrCreateSessionKey(game.pubkey.toBase58());
      const manager = sessionManager(wallet, connection);
      const sessionToken = sessionTokenPda(session.publicKey, wallet.publicKey, manager.program.programId);
      const hand = handPda(game.pubkey, wallet.publicKey);

      setStatus("Attesting TEE validator…");
      const { identity, fqdn } = await teeValidator();

      setStatus("Delegating to the rollup…");
      const delegateIx = await buildDelegateIx(program, {
        player: wallet.publicKey,
        host: game.host,
        game: game.pubkey,
        gameId: game.gameId,
        playerHand: hand,
        validatorIdentity: identity,
      });
      const enterTx = new Transaction().add(delegateIx);
      if (!(await connection.getAccountInfo(sessionToken))) {
        const sessionIx = await buildCreateSessionIx(manager, {
          targetProgram: program.programId,
          sessionSigner: session.publicKey,
          feePayer: wallet.publicKey,
        });
        enterTx.add(sessionIx);
        // the granted key co-signs its own creation
        enterTx.feePayer = wallet.publicKey;
        enterTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        enterTx.partialSign(session);
        const signed = await wallet.signTransaction(enterTx);
        const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, "confirmed");
      } else {
        await sendWalletTx(connection, wallet, enterTx);
      }

      setStatus("Making your dice private…");
      const { tx: permTx } = await buildInitHandPermission(program, {
        player: wallet.publicKey,
        playerHand: hand,
        permission: permissionPda(hand),
      });
      await sendWalletTx(connection, wallet, permTx);

      setStatus("Ready.");
      onReady({ session, sessionToken, fqdn, validatorIdentity: identity });
    })().catch((e) => setStatus("Error: " + (e as Error).message));
  }, [wallet, connection, game, onReady]);

  return (
    <main className="screen center">
      <h2 className="title">ENTER THE ROLLUP</h2>
      <div className="muted">{status}</div>
    </main>
  );
}
