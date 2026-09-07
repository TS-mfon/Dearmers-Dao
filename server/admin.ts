import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";
import { escapeHtml, sendEmail } from "./_email.js";
import { ObjectId } from "mongodb";

const admins = () => new Set((process.env.ADMIN_WALLETS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
async function isAdmin(db: Awaited<ReturnType<typeof database>>, identity: { sub: string; wallet?: string }, wallet: string) {
  const profile = await db.collection("profiles").findOne({ identity: `privy:${identity.sub}` });
  const candidate = String(wallet || identity.wallet || profile?.wallet || "").toLowerCase();
  return Boolean(candidate && admins().has(candidate));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const db = await database();
    const body = req.body || {};
    const wallet = String(req.query.wallet || body.wallet || "");
    if (!await isAdmin(db, identity, wallet)) return json(res, 403, { error: "Protocol admin authorization required." });
    if (req.method === "GET") return json(res, 200, { users: await db.collection("profiles").find({}).sort({ updatedAt: -1 }).limit(100).toArray(), daos: await db.collection("daoIndex").find({}).sort({ updatedAt: -1 }).limit(100).toArray(), proposals: await db.collection("proposals").find({ status: { $in: ["tied", "manual_funding", "tied_pending_admin", "approved_pending_manual_transfer"] } }).sort({ updatedAt: -1 }).limit(100).toArray(), applications: await db.collection("membershipApplications").find({ status: "pending" }).sort({ createdAt: 1 }).limit(200).toArray() });
    const action = String(req.query.action || body.action || "");
    if (["ban-user", "ban-dao"].includes(action)) {
      const collection = action === "ban-user" ? "profiles" : "daoIndex";
      const key = action === "ban-user" ? "wallet" : "daoId";
      await db.collection(collection).updateOne({ [key]: String(body.target).toLowerCase() }, { $set: { banned: Boolean(body.banned), bannedAt: new Date(), bannedBy: identity.sub } });
    } else if (action === "protocol-announcement") {
      const title = String(body.title || "").trim();
      const content = String(body.body || "").trim();
      if (!title || !content) return json(res, 400, { error: "Bulletin title and body are required." });
      const eventKey = `protocol:${title.toLowerCase()}:${content.slice(0, 32)}`;
      const existing = await db.collection("announcements").findOne({ eventKey });
      if (!existing) {
        const item = { scope: "protocol", eventKey, title: title.slice(0, 140), body: content.slice(0, 5000), createdAt: new Date(), createdBy: identity.sub };
        await db.collection("announcements").insertOne(item);
        const recipients = await db.collection("profiles").find({ emailVerified: true, emailNotifications: { $ne: false } }).project({ identity: 1, email: 1 }).toArray();
        const emails = recipients.map((recipient) => String(recipient.email || "")).filter(Boolean);
        if (recipients.length) await db.collection("notifications").insertMany(recipients.map((recipient) => ({ identity: recipient.identity, kind: "protocol_bulletin", title: item.title, body: item.body, readAt: null, createdAt: new Date() })));
        if (emails.length) { try { const delivery = await sendEmail({ to: emails, subject: item.title, html: `<h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.body)}</p>`, eventKey }); await db.collection("emailJobs").updateOne({ eventKey }, { $set: { eventKey, status: "sent", providerId: delivery.id, sent: delivery.sent, updatedAt: new Date() } }, { upsert: true }); } catch (error) { await db.collection("emailJobs").updateOne({ eventKey }, { $set: { eventKey, status: "failed", error: safeError(error), updatedAt: new Date() } }, { upsert: true }); } }
      }
    } else if (action === "approve-membership" || action === "reject-membership") {
      const applicationId = String(body.applicationId || "");
      if (!ObjectId.isValid(applicationId)) return json(res, 400, { error: "A valid membership application is required." });
      const application = await db.collection("membershipApplications").findOne({ _id: new ObjectId(applicationId), status: "pending" });
      if (!application) return json(res, 404, { error: "Membership application not found." });
      const status = action === "approve-membership" ? "approved" : "rejected";
      await db.collection("membershipApplications").updateOne({ _id: new ObjectId(applicationId) }, { $set: { status, decidedBy: identity.sub, decidedAt: new Date() } });
      if (status === "approved") await db.collection("daoMembers").updateOne({ daoId: application.daoId, actor: application.actor }, { $set: { daoId: application.daoId, actor: application.actor, wallet: application.wallet || null, role: "member", status: "active", joinedAt: new Date() } }, { upsert: true });
      await db.collection("notifications").insertOne({ identity: application.actor, kind: `membership_${status}`, daoId: application.daoId, title: `Membership ${status}`, body: `Your membership request was ${status}.`, readAt: null, createdAt: new Date() });
    } else if (action === "resolve-tie") {
      const proposalId = String(body.proposalId || "");
      if (!proposalId || typeof body.support !== "boolean") return json(res, 400, { error: "Proposal and tie decision are required." });
      const query = ObjectId.isValid(proposalId) ? { _id: new ObjectId(proposalId) } : { proposalId };
      await db.collection("proposals").updateOne(query, { $set: { status: body.support ? "passed" : "defeated", tieResolvedBy: identity.sub, tieResolutionReason: String(body.reason || "").slice(0, 1000), updatedAt: new Date() } });
    } else if (action === "manual-funding") {
      const proposalId = String(body.proposalId || "");
      if (!proposalId || !body.reference) return json(res, 400, { error: "Proposal and transfer reference are required." });
      const query = ObjectId.isValid(proposalId) ? { _id: new ObjectId(proposalId) } : { proposalId };
      await db.collection("proposals").updateOne(query, { $set: { status: "manually_funded", fundingReference: String(body.reference).slice(0, 300), fundedBy: identity.sub, updatedAt: new Date() } });
    } else return json(res, 400, { error: "Unsupported admin action." });
    await db.collection("auditLogs").insertOne({ scopeId: "protocol", type: action, actor: identity.sub, target: body.target || body.proposalId || null, createdAt: new Date() });
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
