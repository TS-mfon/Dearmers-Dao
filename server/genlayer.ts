import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chains, createAccount, createClient } from "genlayer-js";
import { method, json, safeError } from "./_http.js";

const allowed = new Set(["register_dao", "update_dao", "set_active", "set_constitution", "evaluate_proposal"]);

function getChain() {
  const network = process.env.GENLAYER_NETWORK || "studio-dev";
  if (network === "testnet-bradbury") return chains.testnetBradbury;
  if (network === "testnet-asimov") return chains.testnetAsimov;
  if (network === "studionet") return chains.studionet;
  if (network === "studio-dev") return chains.studioDevnet;
  return chains.studionet;
}

function client() {
  const privateKey = process.env.GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY || process.env.GENLAYER_PRIVATE_KEY;
  const endpoint = process.env.GENLAYER_RPC_URL;
  if (!privateKey || !endpoint) throw new Error("GenLayer platform signer is not configured.");
  return createClient({ chain: getChain(), account: createAccount(privateKey as `0x${string}`), endpoint });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    if (!process.env.INTERNAL_API_SECRET || req.headers["x-internal-api-key"] !== process.env.INTERNAL_API_SECRET) return json(res, 401, { error: "Internal evaluation access required." });
    const { action, address, args, hash } = req.body || {};
    const genlayer = client();
    if (action === "get_transaction") {
      if (typeof hash !== "string" || !hash) return json(res, 400, { error: "Transaction hash is required." });
      const transaction = await genlayer.getTransaction({ hash } as never) as unknown as Record<string, unknown>;
      const status = String(transaction.statusName || transaction.status || "PENDING").toUpperCase();
      return json(res, 200, { hash, status, transaction });
    }
    if (typeof action !== "string" || !allowed.has(action) || typeof address !== "string" || !Array.isArray(args)) {
      return json(res, 400, { error: "Invalid platform signer request." });
    }
    const fees = await genlayer.estimateTransactionFeesForWrite({ address, functionName: action, args, value: 0n } as never);
    const txHash = await genlayer.writeContract({ address, functionName: action, args, value: 0n, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } } as never);
    return json(res, 200, { hash: txHash, status: "SUBMITTED", explorerUrl: `${process.env.GENLAYER_EXPLORER_URL || "https://explorer-studio-dev.genlayer.com"}/tx/${txHash}` });
  } catch (error) {
    return json(res, 500, { error: safeError(error) });
  }
}
