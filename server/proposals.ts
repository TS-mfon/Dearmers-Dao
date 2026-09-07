import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    const daoId = String(req.query.daoId || req.body?.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    if (req.method === "GET") {
      const proposals = await db.collection("proposals").find({ daoId }).sort({ createdAt: -1 }).limit(100).toArray();
      return json(res, 200, { proposals });
    }
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    if (!title || !description) return json(res, 400, { error: "Title and description are required." });
    const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
    if (!dao) return json(res, 404, { error: "DAO was not found." });
    const member = await db.collection("daoMembers").findOne({ daoId, actor: identity.sub, status: "active" });
    if (!member && String(dao.admin || "").toLowerCase() !== String(body.wallet || "").toLowerCase()) return json(res, 403, { error: "Active DAO membership is required to submit a proposal." });
    const existing = await db.collection("proposals").findOne({ daoId, actor: identity.sub, clientKey: String(body.clientKey || "") });
    if (existing) return json(res, 200, { proposal: existing, duplicate: true });
    const proposal = { daoId, actor: identity.sub, wallet: body.wallet || null, title: title.slice(0, 160), description: description.slice(0, 10000), recipient: body.recipient || null, amount: String(body.amount || "0"), category: String(body.category || "general").slice(0, 80), evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 20).map(String) : [], status: "evaluating", evaluation: null, clientKey: String(body.clientKey || crypto.randomUUID()), createdAt: new Date(), updatedAt: new Date() };
    const inserted = await db.collection("proposals").insertOne(proposal);
    const stored = { ...proposal, _id: inserted.insertedId };
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: "proposal_submitted", actor: identity.sub, proposalId: String(inserted.insertedId), createdAt: new Date() });
    const evaluator = process.env.GENLAYER_EVALUATOR_ADDRESS;
    if (evaluator && process.env.INTERNAL_API_SECRET) {
      const origin = process.env.APP_URL || `https://${process.env.VERCEL_URL || "dreamersdao.me"}`;
      void fetch(`${origin}/api/genlayer`, { method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": process.env.INTERNAL_API_SECRET! }, body: JSON.stringify({ action: "evaluate_proposal", address: evaluator, args: [daoId, String(inserted.insertedId), JSON.stringify({ title: proposal.title, description: proposal.description, amount: proposal.amount, recipient: proposal.recipient, category: proposal.category, evidence: proposal.evidence, constitution: dao.constitution, mission: dao.mission })] }) }).then(async (response) => { const result = await response.json().catch(() => ({})); if (!response.ok || !result.hash) throw new Error(String(result.error || "GenLayer evaluation failed.")); await db.collection("proposalJobs").updateOne({ proposalId: String(inserted.insertedId) }, { $set: { proposalId: String(inserted.insertedId), status: "submitted", result, updatedAt: new Date() } }, { upsert: true }); const review = await fetch(`${origin}/api/reviews`, { method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": process.env.INTERNAL_API_SECRET! }, body: JSON.stringify({ daoId, daoAddress: dao.dao, proposalId: String(inserted.insertedId), genlayerTxHash: result.hash, evaluatorAddress: evaluator }) }); if (!review.ok) throw new Error(String((await review.json().catch(() => ({})) as { error?: string }).error || "GenLayer review relay failed.")); }).catch(async (error) => { await db.collection("proposalJobs").updateOne({ proposalId: String(inserted.insertedId) }, { $set: { proposalId: String(inserted.insertedId), status: "failed", error: safeError(error), updatedAt: new Date() } }, { upsert: true }); });
    }
    else await db.collection("proposalJobs").insertOne({ proposalId: String(inserted.insertedId), status: "blocked_missing_genlayer_config", createdAt: new Date(), updatedAt: new Date() });
    return json(res, 201, { proposal: stored });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
