import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chains, createAccount, createClient } from "genlayer-js";
import { method, json, safeError } from "./_http.js";

const allowed = new Set(["register_dao", "update_dao", "set_active", "set_constitution", "evaluate_proposal"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    if (req.headers["x-internal-api-key"] !== process.env.INTERNAL_API_SECRET) return json(res, 401, { error: "Internal evaluation access required." });
    const { action, address, args } = req.body || {};
    if (typeof action !== "string" || !allowed.has(action) || typeof address !== "string" || !Array.isArray(args)) {
      return json(res, 400, { error: "Invalid platform signer request." });
    }
    const privateKey = process.env.GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY || process.env.GENLAYER_PRIVATE_KEY;
    const endpoint = process.env.GENLAYER_RPC_URL;
    if (!privateKey || !endpoint) return json(res, 503, { error: "GenLayer platform signer is not configured." });
    const network = process.env.GENLAYER_NETWORK || "studionet";
    const chain = network === "testnet-bradbury" ? chains.testnetBradbury : network === "testnet-asimov" ? chains.testnetAsimov : chains.studionet;
    const client = createClient({ chain, account: createAccount(privateKey as `0x${string}`), endpoint });
    const hash = await client.writeContract({ address, functionName: action, function: action, args } as never);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const receipt = await client.getTransaction({ hash } as never) as unknown as Record<string, unknown>;
      const status = String(receipt.statusName || receipt.status || "").toUpperCase();
      if (status === "FINALIZED") return json(res, 200, { hash, status });
      if (status.includes("ERROR") || status.includes("UNDETERMINED")) return json(res, 502, { error: `GenLayer transaction ended with ${status}.` });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return json(res, 504, { error: "GenLayer finality timed out; retry with the same request." });
  } catch (error) {
    return json(res, 500, { error: safeError(error) });
  }
}
