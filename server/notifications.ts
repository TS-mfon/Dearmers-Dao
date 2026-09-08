import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";
import { ObjectId } from "mongodb";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const db = await database();
    if (req.method === "GET") return json(res, 200, { notifications: await db.collection("notifications").find({ identity: identity.sub }).sort({ createdAt: -1 }).limit(100).toArray() });
    const id = String(req.body?.id || "");
    if (id && ObjectId.isValid(id)) await db.collection("notifications").updateOne({ _id: new ObjectId(id), identity: identity.sub }, { $set: { readAt: new Date() } });
    else await db.collection("notifications").updateMany({ identity: identity.sub, readAt: null }, { $set: { readAt: new Date() } });
    json(res, 200, { ok: true });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
