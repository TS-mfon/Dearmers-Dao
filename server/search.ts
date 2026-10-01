import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, method, json, searchPattern, searchTerm } from "./_http.js";
import { publicDaoProjection, publicProfileProjection } from "./_profiles.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET"])) return;
  try {
    const query = searchTerm(req.query.q);
    const expression = searchPattern(req.query.q);
    if (!expression) return json(res, 200, { query: "", daos: [], profiles: [] });
    const db = await database();
    const [daos, profiles] = await Promise.all([
      db.collection("daoIndex").find({ banned: { $ne: true }, active: { $ne: false }, $or: [{ name: expression }, { description: expression }, { category: expression }, { mission: expression }, { tags: expression }, { dao: expression }] }).sort({ updatedAt: -1 }).limit(20).project(publicDaoProjection).toArray(),
      // Findable means not banned, not private, and reachable at a URL: a profile with neither a
      // handle nor a wallet is withheld rather than linked somewhere that cannot resolve. Before
      // scripts/migrate-handles.ts runs, that is how wallet-less members stay out of results
      // instead of becoming dead links -- and it is why no DID is needed to navigate to anyone.
      db.collection("profiles").find({ banned: { $ne: true }, profileVisibility: { $ne: "private" }, $and: [{ $or: [{ handle: { $type: "string" } }, { wallet: { $type: "string" } }] }, { $or: [{ handle: expression }, { username: expression }, { displayName: expression }, { github: expression }, { bio: expression }] }] }).sort({ reputationScore: -1 }).limit(20).project(publicProfileProjection).toArray(),
    ]);
    return json(res, 200, { query, daos, profiles });
  } catch (error) { return errorResponse(res, error); }
}
