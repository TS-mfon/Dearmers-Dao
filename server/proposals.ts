import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

function origin() { return process.env.APP_URL || `https://${process.env.VERCEL_URL || "dreamersdao.me"}`; }
function evaluatorAddress() { return process.env.GENLAYER_V2_EVALUATOR_ADDRESS || process.env.GENLAYER_EVALUATOR_ADDRESS || process.env.GENLAYER_EVALUATOR || ""; }
function proposalQuery(proposalId: string) { return ObjectId.isValid(proposalId) ? { _id: new ObjectId(proposalId) } : { proposalId }; }

async function internal(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${origin()}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": process.env.INTERNAL_API_SECRET || "" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || `${path} failed.`));
  return result as Record<string, unknown>;
}

async function refreshJob(db: Awaited<ReturnType<typeof database>>, proposal: Record<string, unknown>, job: Record<string, unknown>) {
  const hash = String(job.genlayerTxHash || "");
  if (!hash || ["complete", "failed", "rejected", "corrections_required"].includes(String(job.status))) return job;
  const statusResult = await internal("/api/genlayer", { action: "get_transaction", hash });
  const status = String(statusResult.status || "PENDING").toUpperCase();
  if (status !== "FINALIZED") {
    await db.collection("proposalJobs").updateOne({ proposalId: String(proposal._id) }, { $set: { status: "evaluating", genlayerStatus: status, updatedAt: new Date() } });
    return { ...job, status: "evaluating", genlayerStatus: status };
  }
  const evaluator = String(job.evaluatorAddress || evaluatorAddress());
  const review = await internal("/api/reviews", { daoId: proposal.daoId, daoAddress: job.daoAddress, proposalId: String(proposal._id), genlayerTxHash: hash, evaluatorAddress: evaluator });
  const finalStatus = String(review.status || (review.decision === "approve" ? "active_voting" : review.decision === "revision" ? "corrections_required" : review.decision === "reject" ? "rejected_by_genlayer" : "escalated"));
  const nextJob = { ...job, status: finalStatus === "active_voting" ? "complete" : finalStatus, genlayerStatus: "FINALIZED", reviewTxHash: review.baseTransactionHash || null, updatedAt: new Date() };
  await db.collection("proposalJobs").updateOne({ proposalId: String(proposal._id) }, { $set: nextJob });
  return nextJob;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    const daoId = String(req.query.daoId || req.body?.daoId || "");
    if (req.method === "GET") {
      const proposalId = String(req.query.proposalId || "");
      if (proposalId) {
        const proposal = await db.collection("proposals").findOne(proposalQuery(proposalId));
        if (!proposal) return json(res, 404, { error: "Proposal was not found." });
        let job = await db.collection("proposalJobs").findOne({ proposalId: String(proposal._id) }, { projection: { _id: 0 } });
        if (job && ["submitted", "evaluating", "relaying"].includes(String(job.status))) {
          try { job = await refreshJob(db, proposal as unknown as Record<string, unknown>, job as unknown as Record<string, unknown>) as never; } catch (error) { await db.collection("proposalJobs").updateOne({ proposalId: String(proposal._id) }, { $set: { status: "failed", error: safeError(error), updatedAt: new Date() } }); job = { ...job, status: "failed", error: safeError(error) } as never; }
        }
        const current = await db.collection("proposals").findOne(proposalQuery(proposalId));
        return json(res, 200, { proposal: current, job });
      }
      if (!daoId) return json(res, 400, { error: "DAO id is required." });
      const proposals = await db.collection("proposals").find({ daoId }).sort({ createdAt: -1 }).limit(100).toArray();
      return json(res, 200, { proposals });
    }
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    if (!title || !description) return json(res, 400, { error: "Title and description are required." });
    const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
    if (!dao) return json(res, 404, { error: "DAO was not found." });
    const member = await db.collection("daoMembers").findOne({ daoId, actor: identity.sub, status: "active" });
    if (!member && String(dao.admin || "").toLowerCase() !== String(body.wallet || "").toLowerCase()) return json(res, 403, { error: "Active DAO membership is required to submit a proposal." });
    const clientKey = String(body.clientKey || crypto.randomUUID());
    const existing = await db.collection("proposals").findOne({ daoId, actor: identity.sub, clientKey });
    if (existing) return json(res, 200, { proposal: existing, duplicate: true, job: await db.collection("proposalJobs").findOne({ proposalId: String(existing._id) }, { projection: { _id: 0 } }) });
    const proposal = { daoId, actor: identity.sub, wallet: body.wallet || null, title: title.slice(0, 160), description: description.slice(0, 10000), recipient: body.recipient || null, amount: String(body.amount || "0"), category: String(body.category || "general").slice(0, 80), evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 20).map(String) : [], status: "evaluating", evaluation: null, clientKey, createdAt: new Date(), updatedAt: new Date() };
    const inserted = await db.collection("proposals").insertOne(proposal);
    const proposalId = String(inserted.insertedId);
    const evaluator = evaluatorAddress();
    const job = { proposalId, daoId, daoAddress: String(dao.dao || ""), evaluatorAddress: evaluator, status: evaluator && process.env.INTERNAL_API_SECRET ? "submitting" : "blocked_missing_genlayer_config", createdAt: new Date(), updatedAt: new Date() };
    await db.collection("proposalJobs").insertOne(job);
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: "proposal_submitted", actor: identity.sub, proposalId, createdAt: new Date() });
    if (!evaluator || !process.env.INTERNAL_API_SECRET) return json(res, 201, { proposal: { ...proposal, _id: inserted.insertedId }, job: { ...job, error: "GenLayer v2 evaluator is not configured." } });
    try {
      const result = await internal("/api/genlayer", { action: "evaluate_proposal", address: evaluator, args: [daoId, proposalId, JSON.stringify({ title: proposal.title, description: proposal.description, amount: proposal.amount, recipient: proposal.recipient, category: proposal.category, evidence: proposal.evidence, constitution: dao.constitution, mission: dao.mission })] });
      const submittedJob = { ...job, status: "submitted", genlayerTxHash: String(result.hash), explorerUrl: String(result.explorerUrl || ""), updatedAt: new Date() };
      await db.collection("proposalJobs").updateOne({ proposalId }, { $set: submittedJob });
      return json(res, 201, { proposal: { ...proposal, _id: inserted.insertedId }, job: submittedJob });
    } catch (error) {
      const failed = { ...job, status: "failed", error: safeError(error), updatedAt: new Date() };
      await db.collection("proposalJobs").updateOne({ proposalId }, { $set: failed });
      return json(res, 201, { proposal: { ...proposal, _id: inserted.insertedId }, job: failed, warning: "Proposal saved, but GenLayer submission failed. Retry evaluation from the proposal page." });
    }
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
