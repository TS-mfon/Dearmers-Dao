import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET"])) return;
  try {
    const daoId = String(req.query.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    const db = await database();
    const events = await db.collection("auditLogs").find({ scopeId: daoId }).sort({ createdAt: -1 }).limit(200).toArray();
    return json(res, 200, { events });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
