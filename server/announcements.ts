import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";
import { escapeHtml, sendEmail } from "./_email.js";
import { findDaoForIdentity } from "./dao-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") return json(res, 200, { announcements: await db.collection("announcements").find({ daoId: String(req.query.daoId || "") }).sort({ createdAt: -1 }).limit(50).toArray() });
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const { daoId, title, body, ctaUrl } = req.body || {};
    if (!daoId || !title || !body) return json(res, 400, { error: "DAO, title, and body are required." });
    const dao = await findDaoForIdentity(db, String(daoId), identity, String(req.body.wallet || ""));
    if (!dao) return json(res, 403, { error: "Only the bound DAO admin can publish announcements." });
    const eventKey = `dao:${daoId}:announcement:${String(title).toLowerCase()}:${String(body).slice(0, 32)}`;
    const existing = await db.collection("announcements").findOne({ eventKey });
    if (existing) return json(res, 200, { ok: true, duplicate: true, announcement: existing });
    const item = { daoId: String(daoId), eventKey, title: String(title).slice(0, 140), body: String(body).slice(0, 5000), ctaUrl: ctaUrl ? String(ctaUrl).slice(0, 500) : null, createdAt: new Date(), createdBy: identity.sub };
    await db.collection("announcements").insertOne(item);
    const followers = await db.collection("follows").find({ target: String(daoId).toLowerCase() }).project({ follower: 1, actor: 1 }).toArray();
    const identities = followers.map((follower) => follower.actor).filter(Boolean);
    const profiles = identities.length ? await db.collection("profiles").find({ identity: { $in: identities }, emailVerified: true, emailNotifications: { $ne: false } }).project({ identity: 1, email: 1 }).toArray() : [];
    if (followers.length) await db.collection("notifications").insertMany(followers.map((follower) => ({ identity: follower.actor || null, wallet: follower.follower || null, kind: "dao_announcement", daoId, title: item.title, body: item.body, readAt: null, createdAt: new Date() })));
    if (profiles.length) { const emails = profiles.map((profile) => String(profile.email || "")).filter(Boolean); try { const delivery = await sendEmail({ to: emails, subject: `${dao.name}: ${item.title}`, html: `<h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.body)}</p>`, eventKey }); await db.collection("emailJobs").updateOne({ eventKey }, { $set: { eventKey, status: "sent", providerId: delivery.id, sent: delivery.sent, updatedAt: new Date() } }, { upsert: true }); } catch (error) { await db.collection("emailJobs").updateOne({ eventKey }, { $set: { eventKey, status: "failed", error: safeError(error), updatedAt: new Date() } }, { upsert: true }); } }
    return json(res, 201, { ok: true, announcement: item });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
