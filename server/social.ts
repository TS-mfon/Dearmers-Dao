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
        const followers = await db.collection("follows").countDocuments({ target, targetType: "profile" });
        const following = identity ? await db.collection("follows").findOne({ actor: identity.sub, target, targetType: "profile" }) : null;
        const profileActor = target.startsWith("privy:") ? target.slice("privy:".length) : target;
        const followingCount = await db.collection("follows").countDocuments({ actor: profileActor, targetType: "profile" });
        if (req.query.list === "followers" || req.query.list === "following") {
          const records = req.query.list === "followers" ? await db.collection("follows").find({ target, targetType: "profile" }).sort({ createdAt: -1 }).limit(100).toArray() : await db.collection("follows").find({ actor: profileActor, targetType: "profile" }).sort({ createdAt: -1 }).limit(100).toArray();
          const ids = records.map((record) => req.query.list === "followers" ? record.actor : record.target).filter(Boolean);
          const profiles = ids.length ? await db.collection("profiles").find({ $or: [{ identity: { $in: ids.map((id) => `privy:${id}`) } }, { wallet: { $in: ids } }] }, { projection: { _id: 0, email: 0 } }).toArray() : [];
          return json(res, 200, { profiles, count: req.query.list === "followers" ? followers : followingCount });
        }
        return json(res, 200, { following: Boolean(following), followers, followingCount });
      }
      if (kind === "profile") {
        const profiles = await db.collection("profiles").find(query ? { $or: [{ username: new RegExp(query, "i") }, { displayName: new RegExp(query, "i") }, { github: new RegExp(query, "i") }] } : {}).sort({ updatedAt: -1 }).limit(30).project({ _id: 0, wallet: 1, identity: 1, username: 1, displayName: 1, bio: 1, avatarUrl: 1, bannerUrl: 1, github: 1 }).toArray();
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
    const targetType = String(body.targetType || "dao");
    if (!["dao", "profile"].includes(targetType)) return json(res, 400, { error: "Unsupported target type." });
    if (action === "follow" && targetType === "profile" && (target === privy.sub.toLowerCase() || target === `privy:${privy.sub}`.toLowerCase())) return json(res, 400, { error: "You cannot follow your own profile." });
    const filter = { actor: privy.sub, target, targetType };
    if (action === "unfollow" || action === "unbookmark") await db.collection(collection).deleteOne(filter);
    else await db.collection(collection).updateOne(filter, { $set: { actor: privy.sub, follower: wallet || null, target, targetType, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    const count = await db.collection(collection).countDocuments({ target, targetType });
    if (action === "follow") await db.collection("notifications").updateOne({ identity: target.replace(/^privy:/, ""), kind: "new_follower", actor: privy.sub }, { $setOnInsert: { identity: target.replace(/^privy:/, ""), kind: "new_follower", actor: privy.sub, title: "New follower", body: "Someone followed your profile.", readAt: null, createdAt: new Date(), targetUrl: `/profile/identity/${encodeURIComponent(`privy:${privy.sub}`)}` } }, { upsert: true });
    return json(res, 200, { ok: true, action, count });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
