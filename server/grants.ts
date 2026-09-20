import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, method, json } from "./_http.js";
import { bearerIdentity, requirePrivyIdentity } from "./_privy.js";
import { reconcileGrantApplication } from "./_grant-jobs.js";

async function startGrantWithin(applicationId: string, timeoutMs = 8_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = reconcileGrantApplication(applicationId, true).then(() => true, () => true);
  const timed = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try { return await Promise.race([started, timed]); }
  finally { if (timer) clearTimeout(timer); }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const grantId = String(req.query.grantId || "");
      if (!grantId) return json(res, 200, { grants: await db.collection("grants").find({ status: "open" }).sort({ createdAt: -1 }).limit(100).toArray() });
      const grant = await db.collection("grants").findOne({ $or: [{ grantId }, { slug: grantId }] }, { projection: { policyLease: 0, policyLeaseUntil: 0 } });
      if (!grant) return json(res, 404, { error: "Grant not found." });
      if (String(req.query.mine || "") === "1") {
        const identity = await bearerIdentity(req.headers.authorization);
        if (!identity) return json(res, 401, { error: "Sign in to view your grant application." });
        const application = await db.collection("grantApplications").findOne({ grantId: grant.grantId, actor: identity.sub });
        const applicationId = application ? String(application._id) : "";
        const job = applicationId ? await db.collection("grantJobs").findOne({ applicationId }, { projection: { lease: 0, leaseUntil: 0 } }) : null;
        return json(res, 200, { grant, application, job });
      }
      return json(res, 200, { grant });
    }
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const body = req.body || {};
    const grantId = String(body.grantId || "");
    if (!grantId || !body.projectName || !body.description) return json(res, 400, { error: "Grant, project name, and description are required." });
    const grant = await db.collection("grants").findOne({ $or: [{ grantId }, { slug: grantId }], status: "open" });
    if (!grant) return json(res, 404, { error: "This grant program is not open." });
    const links = Array.isArray(body.links) ? body.links.slice(0, 10).map((value: unknown) => String(value).trim()).filter(Boolean) : [];
    if (links.some((url: string) => { try { return new URL(url).protocol !== "https:"; } catch { return true; } })) return json(res, 400, { error: "Grant evidence links must use HTTPS." });
    const application = { grantId: String(grant.grantId), actor: identity.sub, projectName: String(body.projectName).slice(0, 160), description: String(body.description).slice(0, 5000), links, requestedAmount: String(body.requestedAmount || "").slice(0, 80), milestones: String(body.milestones || "").slice(0, 3000), team: String(body.team || "").slice(0, 2000), status: "awaiting_ai_review", evaluation: null, updatedAt: new Date() };
    const existing = await db.collection("grantApplications").findOne({ grantId: String(grant.grantId), actor: identity.sub });
    if (existing && ["recommended_for_funding", "evaluating", "awaiting_ai_review"].includes(String(existing.status))) return json(res, 409, { error: "Your grant application is already in the review pipeline." });
    if (existing && !["corrections_required", "rejected", "further_review", "transaction_failed", "evaluation_unavailable", "consensus_disputed"].includes(String(existing.status))) return json(res, 409, { error: "This grant application cannot be resubmitted in its current state." });
    const saved = await db.collection("grantApplications").findOneAndUpdate({ grantId: String(grant.grantId), actor: identity.sub }, { $set: application, $setOnInsert: { submittedAt: new Date(), createdAt: new Date() }, $unset: { genlayerTxHash: "" } }, { upsert: true, returnDocument: "after" });
    const applicationId = String(saved!._id);
    await db.collection("grantJobs").updateOne({ applicationId }, { $setOnInsert: { applicationId, grantId: String(grant.grantId), status: "queued", createdAt: new Date() } }, { upsert: true });
    const reviewStarted = await startGrantWithin(applicationId);
    const job = await db.collection("grantJobs").findOne({ applicationId }, { projection: { lease: 0, leaseUntil: 0 } });
    return json(res, 201, { ok: true, application: await db.collection("grantApplications").findOne({ _id: saved!._id }), job, warning: job?.error || (!reviewStarted ? "Application saved. GenLayer review will continue through automation." : undefined) });
  } catch (error) { return errorResponse(res, error); }
}
