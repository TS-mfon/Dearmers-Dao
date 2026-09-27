import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, method, json } from "./_http.js";
import { actorLabel, displayNames } from "./_profiles.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET"])) return;
  try {
    const daoId = String(req.query.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    const db = await database();
    const events = await db.collection("auditLogs").find({ scopeId: daoId }).sort({ createdAt: -1 }).limit(200).toArray();
    // Audit rows store raw Privy DIDs in `actor` and `target`; resolve to names and drop the identifiers.
    const profiles = await displayNames(db, events.flatMap((event) => [event.actor, event.target]));
    return json(res, 200, { events: events.map(({ actor, target, ...event }) => ({ ...event, actorLabel: actorLabel(profiles.get(String(actor || "")), actor), targetLabel: target ? actorLabel(profiles.get(String(target)), target) : "" })) });
  } catch (error) { return errorResponse(res, error); }
}
