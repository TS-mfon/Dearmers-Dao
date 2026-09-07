import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const grantId = String(req.query.grantId || "");
      if (!grantId) return json(res, 200, { grants: await db.collection("grants").find({ status: "open" }).sort({ createdAt: -1 }).limit(100).toArray() });
      const grant = await db.collection("grants").findOne({ $or: [{ grantId }, { slug: grantId }] }, { projection: { _id: 0 } });
      return json(res, grant ? 200 : 404, grant ? { grant } : { error: "Grant not found." });
    }
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const body = req.body || {};
    const grantId = String(body.grantId || "");
    if (!grantId || !body.projectName || !body.description) return json(res, 400, { error: "Grant, project name, and description are required." });
    const application = { grantId, actor: identity.sub, projectName: String(body.projectName).slice(0, 160), description: String(body.description).slice(0, 5000), links: Array.isArray(body.links) ? body.links.slice(0, 10).map(String) : [], status: "submitted", createdAt: new Date(), updatedAt: new Date() };
    const result = await db.collection("grantApplications").updateOne({ grantId, actor: identity.sub }, { $set: application, $setOnInsert: { submittedAt: new Date() } }, { upsert: true });
    const applicationId = result.upsertedId ? String(result.upsertedId) : String((await db.collection("grantApplications").findOne({ grantId, actor: identity.sub }))?._id);
    await db.collection("grantJobs").updateOne({ applicationId }, { $set: { applicationId, status: "queued", updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    return json(res, 201, { ok: true, application });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
