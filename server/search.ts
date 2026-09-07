import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET"])) return;
  try {
    const query = String(req.query.q || "").trim().slice(0, 80);
    if (!query) return json(res, 200, { query: "", daos: [], profiles: [] });
    const expression = new RegExp(escapeRegex(query), "i");
    const db = await database();
    const [daos, profiles] = await Promise.all([
      db.collection("daoIndex").find({ banned: { $ne: true }, active: { $ne: false }, $or: [{ name: expression }, { description: expression }, { category: expression }, { mission: expression }, { tags: expression }, { dao: expression }] }).sort({ updatedAt: -1 }).limit(20).project({ _id: 0 }).toArray(),
      db.collection("profiles").find({ $or: [{ username: expression }, { displayName: expression }, { github: expression }, { bio: expression }] }).sort({ reputationScore: -1 }).limit(20).project({ _id: 0, email: 0, identity: 0 }).toArray(),
    ]);
    return json(res, 200, { query, daos, profiles });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
