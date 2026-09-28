import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, method, json } from "./_http.js";
import { publicDaoProjection } from "./_profiles.js";

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET"])) return;
  try {
    const query = String(req.query.q || "").trim().slice(0, 80);
    if (!query) return json(res, 200, { query: "", daos: [], profiles: [] });
    const expression = new RegExp(escapeRegex(query), "i");
    const db = await database();
    const [daos, profiles] = await Promise.all([
      db.collection("daoIndex").find({ banned: { $ne: true }, active: { $ne: false }, $or: [{ name: expression }, { description: expression }, { category: expression }, { mission: expression }, { tags: expression }, { dao: expression }] }).sort({ updatedAt: -1 }).limit(20).project(publicDaoProjection).toArray(),
      // `identity` is a Privy DID and is served deliberately: it is the public profile route key for
      // wallet-less members (`/profile/identity/<did>` in App.tsx and ProfilePage.tsx). Retiring it
      // needs a public handle to route on first — see the remaining risks in Memory.md.
      db.collection("profiles").find({ $or: [{ username: expression }, { displayName: expression }, { github: expression }, { bio: expression }] }).sort({ reputationScore: -1 }).limit(20).project({ _id: 0, email: 0 }).toArray(),
    ]);
    return json(res, 200, { query, daos, profiles });
  } catch (error) { return errorResponse(res, error); }
}
