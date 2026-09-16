import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, isAddress, parseAbi, type Address } from "viem";
import { base, mainnet } from "viem/chains";
import type { Document } from "mongodb";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity, verifiedEmbeddedWallet } from "./_privy.js";

const balanceAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

async function satisfiesGate(dao: Document, wallet: Address) {
  const gate = dao.gate || dao.metadata?.gate;
  if (!gate?.asset || !isAddress(String(gate.asset))) return false;
  const chainName = String(gate.chain || "base");
  const config = chainName === "ethereum"
    ? { chain: mainnet, rpc: process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com" }
    : { chain: base, rpc: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org" };
  const client = createPublicClient({ chain: config.chain as typeof base, transport: http(config.rpc, { timeout: 10_000 }) });
  const balance = await client.readContract({ address: gate.asset as Address, abi: balanceAbi, functionName: "balanceOf", args: [wallet] });
  return balance > 0n;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const actor = identity.sub;
    if (req.method === "GET") {
      const daoId = String(req.query.daoId || "");
      if (!daoId) return json(res, 400, { error: "DAO id is required." });
      const member = await db.collection("daoMembers").findOne({ daoId, actor }, { projection: { _id: 0 } });
      const application = await db.collection("membershipApplications").findOne({ daoId, actor }, { projection: { _id: 0 } });
      return json(res, 200, { member, application });
    }
    const body = req.body || {};
    const daoId = String(body.daoId || "");
    const action = String(body.action || "join");
    if (!daoId || !["join", "apply"].includes(action)) return json(res, 400, { error: "DAO id and a valid membership action are required." });
    const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
    if (!dao) return json(res, 404, { error: "DAO was not found." });
    const wallet = await verifiedEmbeddedWallet(identity, String(body.wallet || ""));
    if (action === "join" && (dao.access === "token" || dao.access === "nft")) {
      if (!await satisfiesGate(dao, wallet as Address)) return json(res, 403, { error: "Your Privy wallet does not currently satisfy this DAO's asset gate." });
    }
    if (action === "join" && dao.access !== "private" && dao.access !== "whitelist") {
      await db.collection("daoMembers").updateOne({ daoId, actor }, { $set: { daoId, actor, wallet, role: "member", status: "active", joinedAt: new Date() } }, { upsert: true });
      return json(res, 200, { ok: true, status: "active" });
    }
    await db.collection("membershipApplications").updateOne({ daoId, actor }, { $set: { daoId, actor, wallet, reason: String(body.reason || "").slice(0, 1000), status: "pending", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    return json(res, 200, { ok: true, status: "pending" });
  } catch (error) { return json(res, 401, { error: safeError(error) }); }
}
