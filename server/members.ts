import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, method, json } from "./_http.js";
import { bearerIdentity, requirePrivyIdentity } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";
import { actorLabel, displayNames } from "./_profiles.js";
import { ObjectId, type Document } from "mongodb";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    const daoId = String(req.query.daoId || req.body?.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    if (req.method === "GET") {
      const identity = await bearerIdentity(req.headers.authorization);
      const admin = identity ? await findDaoForIdentity(db, daoId, identity) : null;
      const [memberDocs, applicationDocs, memberCount] = await Promise.all([
        db.collection("daoMembers").find({ daoId, status: "active" }).sort({ joinedAt: 1 }).limit(500).toArray(),
        admin ? db.collection("membershipApplications").find({ daoId, status: "pending" }).sort({ createdAt: 1 }).limit(500).toArray() : Promise.resolve([]),
        db.collection("daoMembers").countDocuments({ daoId, status: "active" }),
      ]);
      // Privy DIDs must never leave the API. Responses carry display fields and an opaque id only.
      const profiles = await displayNames(db, [...memberDocs, ...applicationDocs].map((doc) => doc.actor));
      const publicActor = (doc: Document) => {
        const profile = profiles.get(String(doc.actor || ""));
        return { displayName: actorLabel(profile, doc.wallet), username: profile?.username || "", avatarUrl: profile?.avatarUrl || "" };
      };
      const members = memberDocs.map((member) => ({ memberId: String(member._id), role: String(member.role || "member"), status: String(member.status || "active"), joinedAt: member.joinedAt, wallet: member.wallet || null, ...publicActor(member) }));
      const applications = applicationDocs.map((application) => ({ _id: String(application._id), status: String(application.status || "pending"), reason: application.reason || "", createdAt: application.createdAt, ...publicActor(application) }));
      return json(res, 200, { members, applications, memberCount });
    }
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const dao = await findDaoForIdentity(db, daoId, identity, String(req.body?.wallet || ""));
    if (!dao) return json(res, 403, { error: "DAO admin authorization required." });
    const applicationId = String(req.body?.applicationId || "");
    const decision = String(req.body?.decision || "");
    if (!applicationId || !["approve", "reject"].includes(decision)) return json(res, 400, { error: "Application and decision are required." });
    const application = ObjectId.isValid(applicationId) ? await db.collection("membershipApplications").findOne({ _id: new ObjectId(applicationId), daoId, status: "pending" }) : null;
    if (!application) return json(res, 404, { error: "Membership application not found." });
    const status = decision === "approve" ? "approved" : "rejected";
    await db.collection("membershipApplications").updateOne({ _id: application._id }, { $set: { status, decidedBy: identity.sub, decidedAt: new Date() } });
    if (decision === "approve") await db.collection("daoMembers").updateOne({ daoId, actor: application.actor }, { $set: { daoId, actor: application.actor, wallet: application.wallet || null, role: "member", status: "active", joinedAt: new Date() } }, { upsert: true });
    await db.collection("notifications").insertOne({ identity: application.actor, kind: `membership_${status}`, daoId, title: `Membership ${status}`, body: `Your membership request for ${dao.name} was ${status}.`, readAt: null, createdAt: new Date() });
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: `membership_${status}`, actor: identity.sub, target: application.actor, createdAt: new Date() });
    return json(res, 200, { ok: true, status });
  } catch (error) { return errorResponse(res, error); }
}
