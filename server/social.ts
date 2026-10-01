import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address } from "viem";
import { database } from "./_db.js";
import { errorResponse, method, json, searchPattern } from "./_http.js";
import { bearerIdentity } from "./_privy.js";
import { publicProfileProjection } from "./_profiles.js";
import { normalizeHandle } from "../shared/profile.js";

function walletOf(value: unknown) { return String(value || "").toLowerCase() as Address; }

/**
 * Resolves a public handle to the internal key `follows.target` is stored under. Follow rows are
 * keyed by the lowercased `privy:<did>` (or a wallet) and predate the handle, so resolving here
 * keeps every existing row addressable while the client only ever sends a handle.
 */
async function profileTarget(db: Awaited<ReturnType<typeof database>>, query: Record<string, unknown>) {
  const handle = normalizeHandle(query.handle);
  if (handle) {
    const profile = await db.collection("profiles").findOne({ $or: [{ handle }, { "usernameHistory.from": handle }] }, { projection: { identity: 1, wallet: 1 } });
    if (!profile) return "";
    return String(profile.identity || profile.wallet || "").toLowerCase();
  }
  return String(query.target || "").trim().toLowerCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const kind = String(req.query.kind || "profile");
      const query = String(req.query.q || "").trim();
      if (kind === "profile-follow") {
        const target = await profileTarget(db, req.query as Record<string, unknown>);
        const identity = await bearerIdentity(req.headers.authorization).catch(() => null);
        if (!target) return json(res, 400, { error: "That profile could not be found." });
        const followers = await db.collection("follows").countDocuments({ target, targetType: "profile" });
        const following = identity ? await db.collection("follows").findOne({ actor: identity.sub, target, targetType: "profile" }) : null;
        const profileActor = target.startsWith("privy:") ? target.slice("privy:".length) : target;
        const followingCount = await db.collection("follows").countDocuments({ actor: profileActor, targetType: "profile" });
        if (req.query.list === "followers" || req.query.list === "following") {
          const records = req.query.list === "followers" ? await db.collection("follows").find({ target, targetType: "profile" }).sort({ createdAt: -1 }).limit(100).toArray() : await db.collection("follows").find({ actor: profileActor, targetType: "profile" }).sort({ createdAt: -1 }).limit(100).toArray();
          const ids = records.map((record) => req.query.list === "followers" ? record.actor : record.target).filter(Boolean);
          const profiles = ids.length ? await db.collection("profiles").find({ $or: [{ identity: { $in: ids.map((id) => `privy:${id}`) } }, { wallet: { $in: ids } }] }, { projection: publicProfileProjection }).toArray() : [];
          return json(res, 200, { profiles, count: req.query.list === "followers" ? followers : followingCount });
        }
        return json(res, 200, { following: Boolean(following), followers, followingCount });
      }
      if (kind === "profile") {
        // Unescaped input reached Mongo here: `?q=(` was a 500, and a backtracking pattern a ReDoS.
        const expression = searchPattern(query);
        // Reachable at a URL, so a result is never a dead link. See the note in server/search.ts.
        const findable = { banned: { $ne: true }, profileVisibility: { $ne: "private" }, $or: [{ handle: { $type: "string" } }, { wallet: { $type: "string" } }] };
        const profiles = await db.collection("profiles").find(expression ? { ...findable, $or: [{ handle: expression }, { username: expression }, { displayName: expression }, { github: expression }] } : findable).sort({ updatedAt: -1 }).limit(30).project(publicProfileProjection).toArray();
        return json(res, 200, { profiles });
      }
      const identity = await bearerIdentity(req.headers.authorization).catch(() => null);
      const wallet = walletOf(req.query.wallet);
      if (!identity && !wallet) return json(res, 400, { error: "A session or wallet is required." });
      const collection = kind === "bookmarks" ? "bookmarks" : "follows";
      return json(res, 200, { items: await db.collection(collection).find(identity ? { actor: identity.sub } : { follower: wallet }).project({ actor: 0 }).sort({ createdAt: -1 }).limit(100).toArray() });
    }
    const body = req.body || {};
    const privy = await bearerIdentity(req.headers.authorization).catch(() => null);
    if (!privy) return json(res, 401, { error: "Sign in with Privy to update social preferences." });
    const wallet = walletOf(body.wallet);
    const action = String(body.action || "");
    const target = body.handle ? await profileTarget(db, body) : String(body.target || body.daoId || body.following || "").toLowerCase();
    if (!target) return json(res, 400, { error: body.handle ? "That profile could not be found." : "A target is required." });
    if (!["follow", "unfollow", "bookmark", "unbookmark"].includes(action)) return json(res, 400, { error: "Unsupported social action." });
    const collection = action.startsWith("bookmark") ? "bookmarks" : "follows";
    const targetType = String(body.targetType || "dao");
    if (!["dao", "profile"].includes(targetType)) return json(res, 400, { error: "Unsupported target type." });
    if (action === "follow" && targetType === "profile" && (target === privy.sub.toLowerCase() || target === `privy:${privy.sub}`.toLowerCase())) return json(res, 400, { error: "You cannot follow your own profile." });
    const filter = { actor: privy.sub, target, targetType };
    if (action === "unfollow" || action === "unbookmark") await db.collection(collection).deleteOne(filter);
    else await db.collection(collection).updateOne(filter, { $set: { actor: privy.sub, follower: wallet || null, target, targetType, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    const count = await db.collection(collection).countDocuments({ target, targetType });
    if (action === "follow") {
      // The notification links to the follower by handle. It used to embed their Privy DID.
      const follower = await db.collection("profiles").findOne({ identity: `privy:${privy.sub}` }, { projection: { handle: 1, displayName: 1, username: 1 } });
      const handle = String(follower?.handle || "");
      const name = String(follower?.displayName || follower?.username || "Someone");
      await db.collection("notifications").updateOne(
        { identity: target.replace(/^privy:/, ""), kind: "new_follower", actor: privy.sub },
        { $setOnInsert: { identity: target.replace(/^privy:/, ""), kind: "new_follower", actor: privy.sub, title: "New follower", body: `${name} followed your profile.`, readAt: null, createdAt: new Date(), ...(handle ? { targetUrl: `/u/${encodeURIComponent(handle)}` } : {}) } },
        { upsert: true },
      );
    }
    return json(res, 200, { ok: true, action, count });
  } catch (error) { return errorResponse(res, error); }
}
