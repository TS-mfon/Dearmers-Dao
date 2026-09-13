import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { isAddress, parseUnits } from "viem";
import { database } from "./_db.js";
import { HttpError, errorResponse, json, method } from "./_http.js";
import { bearerIdentity, requirePrivyIdentity, verifiedWallet } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";
import { reconcileReview } from "./_proposal-jobs.js";
import { reviewCapabilities, type ReviewJob } from "../shared/proposals.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const db = await database();
    const body = req.body || {};
    const daoId = String(req.query.daoId || body.daoId || "");
    const proposalId = String(req.query.proposalId || body.proposalId || "");
    const identity = req.method === "POST" ? await requirePrivyIdentity(req.headers.authorization) : await bearerIdentity(req.headers.authorization);
    if (proposalId) {
      if (!ObjectId.isValid(proposalId)) throw new HttpError(404, "Proposal not found.");
      const proposal = await db.collection("proposals").findOne({ _id: new ObjectId(proposalId), ...(daoId ? { daoId } : {}) });
      if (!proposal) throw new HttpError(404, "Proposal not found in this DAO.");
      const daoAdmin = identity ? await findDaoForIdentity(db, proposal.daoId, identity) : null;
      const authorized = Boolean(identity && (identity.sub === proposal.actor || daoAdmin));
      const job = await db.collection("proposalJobs").findOne({ proposalId }, { projection: { lease: 0, leaseUntil: 0 } });
      const capabilities = reviewCapabilities(String(proposal.status), job as ReviewJob | null, authorized);
      if (req.method === "POST") {
        if (!authorized) throw new HttpError(403, "Only the proposal creator or this DAO's admin can trigger review.");
        const action = String(body.action || "");
        const allowed = action === "start-review" ? capabilities.canStart : action === "retry-review" ? capabilities.canRetry : action === "refresh-review" ? capabilities.canRefresh : action === "recover-review" ? capabilities.canRecover : false;
        if (!allowed) throw new HttpError(409, "That action is not available in the proposal's current state.");
        await reconcileReview(proposalId, ["start-review", "retry-review"].includes(action), action === "recover-review" ? String(body.hash || "") : "");
        await db.collection("auditLogs").insertOne({ scopeId: proposal.daoId, type: action, actor: identity!.sub, proposalId, createdAt: new Date() });
        return json(res, 202, { ok: true, job: await db.collection("proposalJobs").findOne({ proposalId }, { projection: { lease: 0, leaseUntil: 0 } }) });
      }
      const membership = identity ? await db.collection("daoMembers").findOne({ daoId: proposal.daoId, actor: identity.sub, status: "active" }) : null;
      const vote = identity ? await db.collection("proposalVotes").findOne({ proposalId, actor: identity.sub }, { projection: { status: 1, txHash: 1, support: 1 } }) : null;
      return json(res, 200, { proposal, job, capabilities, canVote: Boolean(identity && (membership || daoAdmin) && proposal.status === "active_voting" && new Date(proposal.votingEndsAt).getTime() > Date.now() && !vote), vote });
    }
    if (!daoId) throw new HttpError(400, "DAO id is required.");
    if (req.method === "GET") return json(res, 200, { proposals: await db.collection("proposals").find({ daoId }).sort({ createdAt: -1 }).limit(100).toArray() });
    const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
    if (!dao) throw new HttpError(404, "DAO not found.");
    const member = await db.collection("daoMembers").findOne({ daoId, actor: identity!.sub, status: "active" });
    if (!member && !await findDaoForIdentity(db, daoId, identity!)) throw new HttpError(403, "Active DAO membership is required to submit a proposal.");
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    if (!title || title.length > 160 || !description || description.length > 10000) throw new HttpError(400, "Supply a title (up to 160 characters) and description (up to 10,000 characters).");
    const amount = String(body.amount || "0");
    if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new HttpError(400, "Enter a non-negative USDC amount with at most six decimal places.");
    const amountAtomic = parseUnits(amount, 6);
    const kind = amountAtomic === 0n ? "non_spend" : "spend";
    if (kind === "spend" && !isAddress(String(body.recipient || ""))) throw new HttpError(400, "A valid recipient wallet is required for spending proposals.");
    const wallet = await verifiedWallet(identity!, String(body.wallet || ""));
    const clientKey = String(body.clientKey || "");
    if (!clientKey || clientKey.length > 100) throw new HttpError(400, "A stable submission key is required.");
    const evidence: string[] = Array.isArray(body.evidence) ? body.evidence.map(String) : [];
    if (evidence.length > 20 || evidence.some((url) => { try { return new URL(url).protocol !== "https:"; } catch { return true; } })) throw new HttpError(400, "Supply at most 20 valid HTTPS evidence links.");
    let supersedes: string | undefined;
    if (body.supersedes) {
      if (!ObjectId.isValid(String(body.supersedes))) throw new HttpError(400, "Invalid original proposal.");
      const original = await db.collection("proposals").findOne({ _id: new ObjectId(String(body.supersedes)), daoId, actor: identity!.sub, status: { $in: ["corrections_required", "rejected_by_genlayer", "escalated"] } });
      if (!original) throw new HttpError(403, "You can only replace your own completed review in this DAO.");
      supersedes = String(original._id);
    }
    const saved = await db.collection("proposals").findOneAndUpdate({ daoId, actor: identity!.sub, clientKey }, { $setOnInsert: { daoId, actor: identity!.sub, clientKey, wallet, title, description, amount, amountAtomic: String(amountAtomic), kind, recipient: kind === "spend" ? body.recipient.toLowerCase() : wallet, category: String(body.category || "general").slice(0, 80), evidence, supersedes, missionSnapshot: dao.mission, constitutionSnapshot: dao.constitution, rulesVersion: dao.rulesVersion, status: "awaiting_ai_review", evaluation: null, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true, returnDocument: "after" });
    const id = String(saved!._id);
    await reconcileReview(id, true);
    const job = await db.collection("proposalJobs").findOne({ proposalId: id }, { projection: { lease: 0, leaseUntil: 0 } });
    return json(res, 201, { proposal: await db.collection("proposals").findOne({ _id: saved!._id }), job, warning: job?.error || undefined });
  } catch (error) { return errorResponse(res, error); }
}
