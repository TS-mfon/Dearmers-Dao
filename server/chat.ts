import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const daoId = String(req.query.daoId || req.body?.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    const member = await db.collection("daoMembers").findOne({ daoId, actor: identity.sub, status: "active" });
    const dao = await db.collection("daoIndex").findOne({ daoId });
    const admin = dao ? await findDaoForIdentity(db, daoId, identity) : null;
    if (!member && !admin) return json(res, 403, { error: "DAO membership is required for chat." });
    const profile = await db.collection("profiles").findOne({ identity: `privy:${identity.sub}` });
    if (req.method === "GET") {
      const before = req.query.before ? new Date(String(req.query.before)) : new Date();
      const messages = await db.collection("chatMessages").find({ daoId, createdAt: { $lt: before } }).sort({ createdAt: -1 }).limit(50).toArray();
      const actors = [...new Set(messages.map((message) => String(message.actor || "")).filter(Boolean))];
      const profiles = await db.collection("profiles").find({ $or: actors.flatMap((actor) => [{ identity: actor }, { identity: `privy:${actor}` }]) }).project({ _id: 0, identity: 1, username: 1, displayName: 1, avatarUrl: 1 }).toArray();
      const profileByIdentity = new Map(profiles.map((item) => [String(item.identity), item]));
      return json(res, 200, { messages: messages.reverse().map((message) => { const actor = String(message.actor || ""); const author = profileByIdentity.get(actor) || profileByIdentity.get(`privy:${actor}`); const label = String(author?.displayName || author?.username || message.wallet || "DAO member"); return { ...message, actor: label, actorId: actor, author: author ? { username: author.username || "", displayName: author.displayName || "", avatarUrl: author.avatarUrl || "" } : null }; }) });
    }
    const text = String(req.body?.text || "").trim();
    if (!text || text.length > 1000) return json(res, 400, { error: "Message must be between 1 and 1000 characters." });
    const recent = await db.collection("chatMessages").countDocuments({ daoId, actor: identity.sub, createdAt: { $gt: new Date(Date.now() - 10_000) } });
    if (recent >= 3) return json(res, 429, { error: "Slow down before sending another message." });
    const item = { daoId, actor: identity.sub, wallet: profile?.wallet || identity.wallet || null, text, createdAt: new Date(), author: { username: profile?.username || "", displayName: profile?.displayName || "", avatarUrl: profile?.avatarUrl || "" } };
    await db.collection("chatMessages").insertOne(item);
    return json(res, 201, { message: { ...item, actor: profile?.displayName || profile?.username || profile?.wallet || "DAO member", actorId: identity.sub } });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
