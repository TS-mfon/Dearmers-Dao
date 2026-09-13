import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId, type Document } from "mongodb";
import { hashMessage, isAddress, type Address, type Hex } from "viem";
import type { Evaluation } from "../shared/proposals.js";
import { baseClient, baseSigner, chainProposal, confirmed, daoAbi } from "./_chain.js";
import { database } from "./_db.js";
import { errorResponse, HttpError, json, method } from "./_http.js";

export async function relayReview(proposal: Document, job: Document, evaluation: Evaluation) {
  const db = await database();
  const proposalId = String(proposal._id);
  const query = { _id: new ObjectId(proposalId) };
  const address = String(proposal.daoAddress || job.daoAddress) as Address;
  const setJob = async (values: Document) => { await db.collection("proposalJobs").updateOne({ proposalId }, { $set: { ...values, updatedAt: new Date() } }); };
  if (evaluation.decision !== "approve") {
    const status = evaluation.decision === "reject" ? "rejected_by_genlayer" : evaluation.decision === "revision" ? "corrections_required" : "escalated";
    await db.collection("proposals").updateOne(query, { $set: { status, evaluation, genlayerTxHash: job.genlayerTxHash, updatedAt: new Date() } });
    await setJob({ status: "complete", error: "" });
    return;
  }
  await db.collection("proposals").updateOne(query, { $set: { status: "approved_for_voting", evaluation, updatedAt: new Date() } });
  if (!isAddress(String(proposal.wallet || "")) || !isAddress(address)) throw new HttpError(409, "A verified proposer wallet and DAO address are required before voting can open.");
  const wallet = baseSigner("REVIEW_ORACLE_PRIVATE_KEY");
  const key = hashMessage(`${proposal.daoId}:${proposalId}`);
  let storedId = await baseClient().readContract({ address, abi: daoAbi, functionName: "proposalIdsByKey", args: [key] }) as bigint;
  if (storedId === 0n) {
    if (!job.createTxHash) {
      const registered = await baseClient().readContract({ address, abi: daoAbi, functionName: "registeredMembers", args: [proposal.wallet] });
      if (!registered) {
        const member = await db.collection("daoMembers").findOne({ daoId: proposal.daoId, actor: proposal.actor, status: "active" });
        const dao = await db.collection("daoIndex").findOne({ daoId: proposal.daoId, adminIdentity: proposal.actor });
        if (!member && !dao) throw new HttpError(403, "The proposer is no longer an active DAO member.");
        const memberHash = job.memberTxHash || await wallet.writeContract({ address, abi: daoAbi, functionName: "registerMemberFor", args: [proposal.wallet] });
        await setJob({ memberTxHash: memberHash });
        await confirmed(memberHash as Hex);
      }
      const hash = await wallet.writeContract({ address, abi: daoAbi, functionName: "createProposalForKey", args: [key, proposal.wallet, proposal.recipient || proposal.wallet, BigInt(String(proposal.amountAtomic || "0")), proposal.kind === "non_spend" ? 3 : 0, proposal.title, proposal.description, proposal.category || "general", String(proposal.evidence?.[0] || ""), hashMessage(JSON.stringify(proposal.evidence || []))] });
      job.createTxHash = hash;
      await setJob({ createTxHash: hash });
    }
    await confirmed(job.createTxHash as Hex);
    storedId = await baseClient().readContract({ address, abi: daoAbi, functionName: "proposalIdsByKey", args: [key] }) as bigint;
    if (storedId === 0n) throw new HttpError(409, "Onchain proposal creation is not yet confirmed.");
  }
  const onchainId = storedId - 1n;
  await db.collection("proposals").updateOne(query, { $set: { onchainProposalId: String(onchainId), daoAddress: address } });
  let state = await chainProposal(address, onchainId);
  if (state.status === 0 || state.status === 1) {
    if (!job.reviewTxHash) {
      const weight = await baseClient().readContract({ address, abi: daoAbi, functionName: "totalConfiguredWeight" });
      job.reviewTxHash = await wallet.writeContract({ address, abi: daoAbi, functionName: "recordProposalReview", args: [onchainId, 2, hashMessage(JSON.stringify(evaluation)), weight] });
      await setJob({ reviewTxHash: job.reviewTxHash });
    }
    await confirmed(job.reviewTxHash as Hex);
    state = await chainProposal(address, onchainId);
  }
  if (state.status !== 2) throw new HttpError(409, "The DAO contract has not opened voting for this review.");
  await db.collection("proposals").updateOne(query, { $set: { status: "active_voting", evaluation, genlayerTxHash: job.genlayerTxHash, reviewTxHash: job.reviewTxHash, votingEndsAt: new Date(Number(state.votingEndsAt) * 1000), updatedAt: new Date() } });
  await setJob({ status: "complete", error: "" });
  const eventKey = `proposal-live:${proposalId}`;
  const event = await db.collection("auditLogs").updateOne({ eventKey }, { $setOnInsert: { eventKey, scopeId: proposal.daoId, type: "proposal_voting_opened", proposalId, createdAt: new Date() } }, { upsert: true });
  if (event.upsertedCount) {
    const members = await db.collection("daoMembers").find({ daoId: proposal.daoId, status: "active" }).toArray();
    if (members.length) await db.collection("notifications").insertMany(members.map((member) => ({ identity: member.actor, kind: "proposal_live", title: "Member voting is open", body: proposal.title, targetUrl: `/dao/${proposal.daoId}/proposals/${proposalId}`, readAt: null, createdAt: new Date() })));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    if (!process.env.INTERNAL_API_SECRET || req.headers["x-internal-api-key"] !== process.env.INTERNAL_API_SECRET) throw new HttpError(401, "Internal access required.");
    const { reconcileReview } = await import("./_proposal-jobs.js");
    await reconcileReview(String(req.body?.proposalId || ""));
    return json(res, 200, { ok: true });
  } catch (error) { return errorResponse(res, error); }
}
