import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    const daoId = String(req.query.daoId || req.body?.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    if (req.method === "GET") {
      const [members, applications] = await Promise.all([
        db.collection("daoMembers").find({ daoId, status: "active" }).sort({ joinedAt: 1 }).limit(500).toArray(),
        db.collection("membershipApplications").find({ daoId, status: "pending" }).sort({ createdAt: 1 }).limit(500).toArray(),
      ]);
      return json(res, 200, { members, applications });
    }
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const profile = await db.collection("profiles").findOne({ identity: `privy:${identity.sub}` });
    const dao = await db.collection("daoIndex").findOne({ daoId, admin: String(profile?.wallet || identity.wallet || "").toLowerCase(), banned: { $ne: true } });
    if (!dao) return json(res, 403, { error: "DAO admin authorization required." });
    const applicationId = String(req.body?.applicationId || "");
    const decision = String(req.body?.decision || "");
    if (!applicationId || !["approve", "reject"].includes(decision)) return json(res, 400, { error: "Application and decision are required." });
    const application = await db.collection("membershipApplications").findOne({ _id: applicationId as never, daoId });
    if (!application) return json(res, 404, { error: "Membership application not found." });
    const status = decision === "approve" ? "approved" : "rejected";
    await db.collection("membershipApplications").updateOne({ _id: application._id }, { $set: { status, decidedBy: identity.sub, decidedAt: new Date() } });
    if (decision === "approve") await db.collection("daoMembers").updateOne({ daoId, actor: application.actor }, { $set: { daoId, actor: application.actor, wallet: application.wallet || null, role: "member", status: "active", joinedAt: new Date() } }, { upsert: true });
    await db.collection("notifications").insertOne({ identity: application.actor, kind: `membership_${status}`, daoId, title: `Membership ${status}`, body: `Your membership request for ${dao.name} was ${status}.`, readAt: null, createdAt: new Date() });
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: `membership_${status}`, actor: identity.sub, target: application.actor, createdAt: new Date() });
    return json(res, 200, { ok: true, status });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
