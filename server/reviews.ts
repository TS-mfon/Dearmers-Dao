import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId, type Document } from "mongodb";
import { hashMessage, isAddress, type Address, type Hex } from "viem";
import type { Evaluation } from "../shared/proposals.js";
import { baseClient, baseSigner, chainProposal, confirmed, daoAbi, requireBaseSignerGas } from "./_chain.js";
import { database } from "./_db.js";
import { errorResponse, HttpError, json, method } from "./_http.js";
import { escapeHtml, sendEmail } from "./_email.js";

export async function reconcileProposalVotingNotifications(proposal: Document) {
  const db = await database();
  const proposalId = String(proposal._id);
  const eventKey = `proposal-live:${proposalId}`;
  await db.collection("auditLogs").updateOne({ eventKey }, { $setOnInsert: { eventKey, scopeId: proposal.daoId, type: "proposal_voting_opened", proposalId, createdAt: new Date() } }, { upsert: true });
  const [members, dao] = await Promise.all([
    db.collection("daoMembers").find({ daoId: proposal.daoId, status: "active", actor: { $type: "string" } }).project({ actor: 1 }).toArray(),
    db.collection("daoIndex").findOne({ daoId: proposal.daoId }, { projection: { adminIdentity: 1 } }),
  ]);
  const identities = [...new Set([...members.map((member) => String(member.actor || "")), String(dao?.adminIdentity || "")].filter(Boolean))];
  await Promise.all(identities.map((identity) => db.collection("notifications").updateOne(
    { eventKey, identity },
    { $setOnInsert: { eventKey, identity, kind: "proposal_live", title: "Member voting is open", body: proposal.title, targetUrl: `/dao/${proposal.daoId}/proposals/${proposalId}`, readAt: null, createdAt: new Date() } },
    { upsert: true },
  )));
  if (!identities.length) return;
  const profileIdentities = identities.map((identity) => identity.startsWith("privy:") ? identity : `privy:${identity}`);
  const profiles = await db.collection("profiles").find({ identity: { $in: profileIdentities }, email: { $type: "string" }, emailNotifications: { $ne: false } }).project({ email: 1 }).toArray();
  const recipients = [...new Set(profiles.map((profile) => String(profile.email || "").trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return;
  const subject = `Voting is open: ${proposal.title}`;
  const html = `<h1>${escapeHtml(String(proposal.title || "Proposal"))}</h1><p>GenLayer approved this proposal for member voting. Sign in to Dreamers DAO to review the verdict and vote before the deadline.</p>`;
  const claimed = await db.collection("emailJobs").updateOne({ eventKey }, { $setOnInsert: { eventKey, kind: "proposal_live", recipients, subject, html, status: "sending", attempts: 0, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
  if (!claimed.upsertedCount) return;
  try {
    const delivery = await sendEmail({ to: recipients, subject, html, eventKey });
    await db.collection("emailJobs").updateOne({ eventKey }, { $set: { status: "sent", providerId: delivery.id, sent: delivery.sent, attempts: 1, updatedAt: new Date() } });
  } catch (error) {
    await db.collection("emailJobs").updateOne({ eventKey }, { $set: { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "Email delivery failed.", attempts: 1, nextAttemptAt: new Date(Date.now() + 5 * 60_000), updatedAt: new Date() } });
  }
}

export async function relayReview(proposal: Document, job: Document, evaluation: Evaluation) {
  const db = await database();
  const proposalId = String(proposal._id);
  const query = { _id: new ObjectId(proposalId) };
  const address = String(proposal.daoAddress || job.daoAddress) as Address;
  const setJob = async (values: Document) => { await db.collection("proposalJobs").updateOne({ proposalId }, { $set: { ...values, updatedAt: new Date() } }); };
  if (evaluation.decision !== "approve") {
    const status = evaluation.outcome === "corrections_required" || evaluation.decision === "revision" ? "corrections_required" : evaluation.outcome === "further_review" || evaluation.decision === "escalate" ? "escalated" : "rejected_by_genlayer";
    await db.collection("proposals").updateOne(query, { $set: { status, evaluation, genlayerTxHash: job.genlayerTxHash, updatedAt: new Date() } });
    await setJob({ status: "complete", error: "" });
    return;
  }
  await db.collection("proposals").updateOne(query, { $set: { status: "approved_for_voting", evaluation, updatedAt: new Date() } });
  if (!isAddress(String(proposal.wallet || "")) || !isAddress(address)) throw new HttpError(409, "A verified proposer wallet and DAO address are required before voting can open.");
  const wallet = baseSigner("REVIEW_ORACLE_PRIVATE_KEY");
  await requireBaseSignerGas(wallet.account.address, "The Base review oracle");
  const key = hashMessage(`${proposal.daoId}:${proposalId}`);
  let supportsIdempotentKeys = true;
  let storedId = 0n;
  try { storedId = await baseClient().readContract({ address, abi: daoAbi, functionName: "proposalIdsByKey", args: [key] }) as bigint; } catch { supportsIdempotentKeys = false; }
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
      const proposalCount = supportsIdempotentKeys ? 0n : await baseClient().readContract({ address, abi: daoAbi, functionName: "proposalCount" }) as bigint;
      const hash = await wallet.writeContract({ address, abi: daoAbi, functionName: supportsIdempotentKeys ? "createProposalForKey" : "createProposalFor", args: supportsIdempotentKeys ? [key, proposal.wallet, proposal.recipient || proposal.wallet, BigInt(String(proposal.amountAtomic || "0")), proposal.kind === "non_spend" ? 3 : 0, proposal.title, proposal.description, proposal.category || "general", String(proposal.evidence?.[0] || ""), hashMessage(JSON.stringify(proposal.evidence || []))] : [proposal.wallet, proposal.recipient || proposal.wallet, BigInt(String(proposal.amountAtomic || "0")), proposal.kind === "non_spend" ? 2 : 0, proposal.title, proposal.description, proposal.category || "general", String(proposal.evidence?.[0] || ""), hashMessage(JSON.stringify(proposal.evidence || []))] });
      job.createTxHash = hash;
      job.legacyProposalId = supportsIdempotentKeys ? undefined : String(proposalCount);
      await setJob({ createTxHash: hash, legacyProposalId: job.legacyProposalId });
    }
    await confirmed(job.createTxHash as Hex);
    if (supportsIdempotentKeys) {
      storedId = await baseClient().readContract({ address, abi: daoAbi, functionName: "proposalIdsByKey", args: [key] }) as bigint;
      if (storedId === 0n) throw new HttpError(409, "Onchain proposal creation is not yet confirmed.");
    } else if (job.legacyProposalId === undefined) throw new HttpError(409, "Legacy proposal creation is not yet confirmed.");
  }
  const onchainId = supportsIdempotentKeys ? storedId - 1n : BigInt(String(job.legacyProposalId));
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
  await reconcileProposalVotingNotifications({ ...proposal, _id: query._id });
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
