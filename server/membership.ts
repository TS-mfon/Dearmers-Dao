import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

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
    if (action === "join" && (dao.access === "token" || dao.access === "nft")) {
      if (!body.wallet) return json(res, 409, { error: "Connect an external wallet to verify this DAO's gate." });
      return json(res, 409, { error: "Wallet ownership verification is required before joining this gated DAO." });
    }
    if (action === "join" && dao.access !== "private" && dao.access !== "whitelist") {
      await db.collection("daoMembers").updateOne({ daoId, actor }, { $set: { daoId, actor, wallet: body.wallet || null, role: "member", status: "active", joinedAt: new Date() } }, { upsert: true });
      return json(res, 200, { ok: true, status: "active" });
    }
    await db.collection("membershipApplications").updateOne({ daoId, actor }, { $set: { daoId, actor, wallet: body.wallet || null, reason: String(body.reason || "").slice(0, 1000), status: "pending", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    return json(res, 200, { ok: true, status: "pending" });
  } catch (error) { return json(res, 401, { error: safeError(error) }); }
}
