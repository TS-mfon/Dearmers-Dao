import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { bearerIdentity } from "./_privy.js";

function walletOf(value: unknown) { return String(value || "").toLowerCase() as Address; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const kind = String(req.query.kind || "profile");
      const query = String(req.query.q || "").trim();
      if (kind === "profile-follow") {
        const target = String(req.query.target || "").trim().toLowerCase();
        const identity = await bearerIdentity(req.headers.authorization).catch(() => null);
        if (!target) return json(res, 400, { error: "A profile target is required." });
        return json(res, 200, { following: Boolean(identity && await db.collection("follows").findOne({ actor: identity.sub, target })), count: await db.collection("follows").countDocuments({ target }) });
      }
      if (kind === "profile") {
        const profiles = await db.collection("profiles").find(query ? { $or: [{ username: new RegExp(query, "i") }, { displayName: new RegExp(query, "i") }, { github: new RegExp(query, "i") }] } : {}).sort({ reputationScore: -1 }).limit(30).project({ _id: 0, wallet: 1, username: 1, displayName: 1, bio: 1, avatarUrl: 1, github: 1, reputationScore: 1 }).toArray();
        return json(res, 200, { profiles });
      }
      const identity = await bearerIdentity(req.headers.authorization).catch(() => null);
      const wallet = walletOf(req.query.wallet);
      if (!identity && !wallet) return json(res, 400, { error: "A session or wallet is required." });
      const collection = kind === "bookmarks" ? "bookmarks" : "follows";
      return json(res, 200, { items: await db.collection(collection).find(identity ? { actor: identity.sub } : { follower: wallet }).sort({ createdAt: -1 }).limit(100).toArray() });
    }
    const body = req.body || {};
    const privy = await bearerIdentity(req.headers.authorization).catch(() => null);
    if (!privy) return json(res, 401, { error: "Sign in with Privy to update social preferences." });
    const wallet = walletOf(body.wallet);
    const target = String(body.target || body.daoId || body.following || "").toLowerCase();
    const action = String(body.action || "");
    if (!target) return json(res, 400, { error: "A target is required." });
    if (!["follow", "unfollow", "bookmark", "unbookmark"].includes(action)) return json(res, 400, { error: "Unsupported social action." });
    const collection = action.startsWith("bookmark") ? "bookmarks" : "follows";
    const filter = { actor: privy.sub, target };
    if (action === "unfollow" || action === "unbookmark") await db.collection(collection).deleteOne(filter);
    else await db.collection(collection).updateOne(filter, { $set: { actor: privy.sub, follower: wallet || null, target, targetType: body.targetType || "dao", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    const count = await db.collection(collection).countDocuments({ target });
    return json(res, 200, { ok: true, action, count });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
