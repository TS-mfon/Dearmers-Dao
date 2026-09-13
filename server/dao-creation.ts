import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAddress, keccak256, stringToHex } from "viem";
import { database } from "./_db.js";
import { HttpError, errorResponse, json, method } from "./_http.js";
import { requirePrivyIdentity, verifiedWallet } from "./_privy.js";
import { reconcileCreation } from "./_dao-creation.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization); const db = await database(); const body = req.body || {};
    const clientKey = String(body.clientKey || req.query.clientKey || "");
    if (!clientKey || clientKey.length > 100) throw new HttpError(400, "A valid creation key is required.");
    const existing = await db.collection("daoCreationJobs").findOne({ clientKey, actor: identity.sub });
    if (req.method === "GET") {
      if (!existing) throw new HttpError(404, "Creation job not found.");
      return json(res, 200, { clientKey, daoId: existing.daoId, daoAddress: existing.daoAddress, txHash: existing.txHash, status: existing.status, indexed: existing.status === "ready", error: existing.error });
    }
    if (!existing) {
      if (body.action === "resume") throw new HttpError(404, "Creation job not found.");
      const name = String(body.name || "").trim(); const treasury = String(body.treasury || "").toLowerCase();
      if (!name || name.length > 100 || !isAddress(treasury) || !body.constitution || !body.mission || !/^\d+(\.\d{1,6})?$/.test(String(body.weeklyLimit))) throw new HttpError(400, "Complete the DAO identity, constitution, treasury, and weekly limit.");
      const admin = await verifiedWallet(identity, String(body.admin || treasury));
      const delegation = await db.collection("delegations").findOne({ creationKey: clientKey, actor: identity.sub, treasury });
      if (!delegation) throw new HttpError(409, "Record a fresh treasury delegation before creating the DAO.");
      const daoId = keccak256(stringToHex(`${process.env.DEARMERS_REGISTRY_ADDRESS}:${identity.sub}:${clientKey}`));
      await db.collection("daoCreationJobs").insertOne({ clientKey, daoId, actor: identity.sub, admin, treasury, payload: { name, metadataUri: String(body.metadataUri || "{}"), mode: Number(body.mode), description: String(body.description || "").slice(0, 2000), mission: String(body.mission).slice(0, 5000), constitution: String(body.constitution).slice(0, 15000), category: String(body.category || "general"), access: String(body.access || "public"), weeklyLimit: String(body.weeklyLimit), gate: body.gate || null, logoUri: body.logoUri, bannerUri: body.bannerUri }, status: "queued", createdAt: new Date(), updatedAt: new Date() });
    }
    await reconcileCreation(clientKey);
    const job = await db.collection("daoCreationJobs").findOne({ clientKey, actor: identity.sub });
    return json(res, 202, { clientKey, daoId: job?.daoId, daoAddress: job?.daoAddress, txHash: job?.txHash, status: job?.status, indexed: job?.status === "ready", error: job?.error });
  } catch (error) { return errorResponse(res, error); }
}
