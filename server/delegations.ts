import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAddress, type Address, type Hex } from "viem";
import { database } from "./_db.js";
import { encrypt } from "./_crypto.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const body = req.body || {};
    const creationKey = String(body.creationKey || req.query.creationKey || "");
    if (!creationKey || creationKey.length > 100) return json(res, 400, { error: "A valid creation key is required." });
    const db = await database();
    if (req.method === "GET") {
      const record = await db.collection("delegations").findOne({ creationKey, actor: identity.sub }, { projection: { _id: 0, creationKey: 1, treasury: 1, executor: 1, token: 1, status: 1, daoId: 1, daoAddress: 1, updatedAt: 1 } });
      return json(res, 200, { delegation: record || null });
    }
    const { action = "confirm", daoId, daoAddress, treasury, executor, token, permissions, wallet, signature } = body;
    if (!['stage', 'confirm'].includes(String(action))) return json(res, 400, { error: "Unsupported delegation action." });
    if (![treasury, executor, token].every(Boolean)) return json(res, 400, { error: "Missing delegation fields." });
    if (!isAddress(String(treasury)) || !isAddress(String(executor)) || !isAddress(String(token)) || String(wallet).toLowerCase() !== String(treasury).toLowerCase()) return json(res, 400, { error: "Delegation addresses are invalid." });
    if (daoId || daoAddress) return json(res, 400, { error: "Creation delegations cannot rebind an existing DAO." });
    const addresses = { treasury: String(treasury).toLowerCase(), executor: String(executor).toLowerCase(), token: String(token).toLowerCase() };
    if (action === "stage") {
      if (!permissions) return json(res, 400, { error: "MetaMask permission context is required." });
      const current = await db.collection("delegations").findOne({ creationKey, actor: identity.sub });
      if (current?.status === "active") return json(res, 409, { error: "This delegation already belongs to a created DAO. Start a new DAO draft to create another isolated delegation." });
      if (current?.status === "ready_for_creation") return json(res, 200, { ok: true, status: "ready_for_creation" });
      await db.collection("delegations").updateOne({ creationKey, actor: identity.sub }, { $set: { creationKey, actor: identity.sub, ...addresses, payload: encrypt(permissions), status: "pending_confirmation", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      return json(res, 200, { ok: true, status: "pending_confirmation" });
    }
    if (!wallet || !signature) return json(res, 400, { error: "Confirm the staged delegation with the MetaMask treasury wallet." });
    const staged = await db.collection("delegations").findOne({ creationKey, actor: identity.sub, ...addresses, status: "pending_confirmation", payload: { $exists: true } });
    if (!staged) return json(res, 409, { error: "The MetaMask permission was not staged. Request the delegation again." });
    const resource = `${creationKey}:${addresses.treasury}:${addresses.executor}`;
    if (!await verifyWallet("store-delegation", wallet as Address, resource, signature as Hex)) return json(res, 401, { error: "Invalid wallet signature." });
    await db.collection("delegations").updateOne({ creationKey, actor: identity.sub }, { $set: { status: "ready_for_creation", confirmedAt: new Date(), updatedAt: new Date() } });
    json(res, 200, { ok: true, status: "ready_for_creation" });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
