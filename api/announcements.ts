import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") return json(res, 200, { announcements: await db.collection("announcements").find({ daoId: String(req.query.daoId || "") }).sort({ createdAt: -1 }).limit(50).toArray() });
    const { wallet, signature, daoId, title, body, ctaUrl } = req.body || {};
    if (!wallet || !signature || !daoId || !title || !body || !await verifyWallet("publish-announcement", wallet as Address, String(daoId), signature as Hex)) return json(res, 401, { error: "DAO admin signature required." });
    const dao = await db.collection("daoIndex").findOne({ daoId: String(daoId), admin: String(wallet).toLowerCase(), banned: { $ne: true } });
    if (!dao) return json(res, 403, { error: "Only the bound DAO admin can publish announcements." });
    const item = { daoId: String(daoId), title: String(title).slice(0, 140), body: String(body).slice(0, 5000), ctaUrl: ctaUrl ? String(ctaUrl).slice(0, 500) : null, createdAt: new Date() };
    await db.collection("announcements").insertOne(item);
    await db.collection("notifications").insertMany((await db.collection("follows").find({ target: String(daoId).toLowerCase() }).project({ follower: 1 }).toArray()).map((follower) => ({ wallet: follower.follower, kind: "dao_announcement", daoId, title: item.title, body: item.body, readAt: null, createdAt: new Date() })));
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
