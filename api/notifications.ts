import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const wallet = String(req.method === "GET" ? req.query.wallet : req.body?.wallet || "").toLowerCase() as Address;
    const signature = String(req.method === "GET" ? req.query.signature : req.body?.signature || "") as Hex;
    if (!wallet || !signature || !await verifyWallet("notifications", wallet, wallet, signature)) return json(res, 401, { error: "Valid wallet authorization required." });
    const db = await database();
    if (req.method === "GET") return json(res, 200, { notifications: await db.collection("notifications").find({ wallet }).sort({ createdAt: -1 }).limit(100).toArray() });
    await db.collection("notifications").updateMany({ wallet, readAt: null }, { $set: { readAt: new Date() } });
    json(res, 200, { ok: true });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
