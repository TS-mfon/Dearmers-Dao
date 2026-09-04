import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

function walletOf(value: unknown) { return String(value || "").toLowerCase() as Address; }
function resource(action: string, target: string) { return `${action}:${target}`; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const kind = String(req.query.kind || "profile");
      const query = String(req.query.q || "").trim();
      if (kind === "profile") {
        const profiles = await db.collection("profiles").find(query ? { $or: [{ username: new RegExp(query, "i") }, { displayName: new RegExp(query, "i") }, { github: new RegExp(query, "i") }] } : {}).sort({ reputationScore: -1 }).limit(30).project({ _id: 0, wallet: 1, username: 1, displayName: 1, bio: 1, avatarUrl: 1, github: 1, reputationScore: 1 }).toArray();
        return json(res, 200, { profiles });
      }
      const wallet = walletOf(req.query.wallet);
      if (!wallet) return json(res, 400, { error: "Wallet is required." });
      const collection = kind === "bookmarks" ? "bookmarks" : "follows";
      return json(res, 200, { items: await db.collection(collection).find({ follower: wallet }).sort({ createdAt: -1 }).limit(100).toArray() });
    }
    const body = req.body || {};
    const wallet = walletOf(body.wallet);
    const target = String(body.target || body.daoId || body.following || "").toLowerCase();
    const action = String(body.action || "");
    const signature = body.signature as Hex;
    if (!wallet || !target || !signature || !await verifyWallet(action, wallet, resource(action, target), signature)) return json(res, 401, { error: "Valid wallet authorization required." });
    if (!["follow", "unfollow", "bookmark", "unbookmark"].includes(action)) return json(res, 400, { error: "Unsupported social action." });
    const collection = action.startsWith("bookmark") ? "bookmarks" : "follows";
    const filter = { follower: wallet, target };
    if (action === "unfollow" || action === "unbookmark") await db.collection(collection).deleteOne(filter);
    else await db.collection(collection).updateOne(filter, { $set: { ...filter, targetType: body.targetType || "dao", createdAt: new Date() } }, { upsert: true });
    return json(res, 200, { ok: true, action });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
