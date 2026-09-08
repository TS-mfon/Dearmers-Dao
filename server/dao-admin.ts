import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const db = await database();
    const body = req.body || {};
    const daoId = String(req.query.daoId || body.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    const profile = await db.collection("profiles").findOne({ identity: `privy:${identity.sub}` });
    const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
    const wallet = String(identity.wallet || profile?.wallet || "").toLowerCase();
    if (!dao || String(dao.admin || "").toLowerCase() !== wallet) return json(res, 403, { error: "DAO admin authorization required." });
    if (req.method === "GET") return json(res, 200, { dao, proposals: await db.collection("proposals").find({ daoId, status: { $in: ["tied", "manual_funding", "tied_pending_admin", "approved_pending_manual_transfer"] } }).sort({ updatedAt: -1 }).limit(100).toArray(), members: await db.collection("daoMembers").find({ daoId }).sort({ joinedAt: -1 }).limit(200).toArray(), announcements: await db.collection("announcements").find({ daoId }).sort({ createdAt: -1 }).limit(100).toArray() });
    const action = String(req.query.action || body.action || "");
    if (action === "resolve-tie") {
      if (!body.proposalId || typeof body.support !== "boolean") return json(res, 400, { error: "Proposal and decision are required." });
      const query = ObjectId.isValid(String(body.proposalId)) ? { _id: new ObjectId(String(body.proposalId)), daoId } : { proposalId: String(body.proposalId), daoId };
      await db.collection("proposals").updateOne(query, { $set: { status: body.support ? "passed" : "defeated", tieResolvedBy: identity.sub, updatedAt: new Date() } });
    } else if (action === "manual-funding") {
      if (!body.proposalId || !String(body.reference || "").trim()) return json(res, 400, { error: "Proposal and transfer reference are required." });
      const query = ObjectId.isValid(String(body.proposalId)) ? { _id: new ObjectId(String(body.proposalId)), daoId } : { proposalId: String(body.proposalId), daoId };
      await db.collection("proposals").updateOne(query, { $set: { status: "manually_funded", fundingReference: String(body.reference).slice(0, 300), fundedBy: identity.sub, updatedAt: new Date() } });
    } else if (action === "settings") {
      const weeklyCap = Number(body.weeklyCap);
      if (!Number.isFinite(weeklyCap) || weeklyCap < 0) return json(res, 400, { error: "Weekly cap must be a non-negative number." });
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { weeklyCap, updatedAt: new Date() } });
    } else return json(res, 400, { error: "Unsupported DAO admin action." });
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: action, actor: identity.sub, target: body.proposalId || null, createdAt: new Date() });
    return json(res, 200, { ok: true, action });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
