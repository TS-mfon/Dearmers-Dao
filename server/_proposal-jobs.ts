import { randomUUID } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { database } from "./_db.js";
import { evaluatorAddress, finalizedEvaluation, genlayerClient, transactionState } from "./_genlayer.js";
import { HttpError, safeError } from "./_http.js";
import { relayReview } from "./reviews.js";
import { reviewPending } from "../shared/proposals.js";

export async function reconcileReview(proposalId: string, start = false, recoveryHash = "") {
  if (!ObjectId.isValid(proposalId)) throw new HttpError(400, "A valid proposal id is required.");
  const db = await database();
  const proposal = await db.collection("proposals").findOne({ _id: new ObjectId(proposalId) });
  if (!proposal) throw new HttpError(404, "Proposal not found.");
  if (!reviewPending(String(proposal.status))) return;
  const dao = await db.collection("daoIndex").findOne({ daoId: proposal.daoId, banned: { $ne: true } });
  if (!dao) throw new HttpError(404, "DAO not found.");
  await db.collection("proposalJobs").updateOne({ proposalId }, { $setOnInsert: { proposalId, daoId: proposal.daoId, daoAddress: dao.dao, status: "queued", createdAt: new Date() } }, { upsert: true });
  const lease = randomUUID();
  const job = await db.collection("proposalJobs").findOneAndUpdate({ proposalId, $or: [{ leaseUntil: { $lt: new Date() } }, { leaseUntil: { $exists: false } }] }, { $set: { lease, leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }, $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!job) return;
  const update = async (values: Document) => { Object.assign(job, values); await db.collection("proposalJobs").updateOne({ proposalId, lease }, { $set: { ...values, updatedAt: new Date() } }); };
  try {
    const address = String(job.evaluatorAddress || evaluatorAddress()) as `0x${string}`;
    if (recoveryHash) {
      if (job.genlayerTxHash || !["broadcasting", "submission_unknown"].includes(String(job.status))) throw new HttpError(409, "This job does not need a recovered transaction.");
      if (!/^0x[a-fA-F0-9]{64}$/.test(recoveryHash)) throw new HttpError(400, "Enter a valid GenLayer transaction hash.");
      const transaction = await genlayerClient().getTransaction({ hash: recoveryHash as never });
      if (String(transaction.to_address || transaction.recipient || "").toLowerCase() !== address.toLowerCase()) throw new HttpError(422, "The recovered transaction targets a different contract.");
      if (!transactionState(transaction as unknown as Record<string, unknown>).finalized) throw new HttpError(409, "Wait for the recovered transaction to finalize before attaching it.");
      await finalizedEvaluation(proposal.daoId, proposalId, address);
      await update({ genlayerTxHash: recoveryHash, status: "submitted", error: "" });
    }
    if (!job.genlayerTxHash) {
      if (["broadcasting", "submission_unknown"].includes(String(job.status))) {
        await update({ status: "submission_unknown", error: "The submission response was interrupted. Recover the finalized transaction hash; do not submit a second review." });
        return;
      }
      if (!start) return;
      if (dao.policySyncStatus !== "ready") throw new HttpError(409, "DAO governance setup or policy synchronization is incomplete. The DAO admin must finish setup first.");
      await update({ status: "submitting", evaluatorAddress: address, error: "" });
      const client = genlayerClient(true);
      const args = [proposal.daoId, proposalId, JSON.stringify({ title: proposal.title, description: proposal.description, amount: proposal.amount, recipient: proposal.recipient, category: proposal.category, evidence: proposal.evidence || [], mission: proposal.missionSnapshot || dao.mission, constitution: proposal.constitutionSnapshot || dao.constitution })];
      const fees = await client.estimateTransactionFeesForWrite({ address, functionName: "evaluate_proposal", args });
      await update({ status: "broadcasting" });
      const hash = String(await client.writeContract({ address, functionName: "evaluate_proposal", args, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } }));
      await update({ status: "submitted", genlayerTxHash: hash, genlayerStatus: "PENDING", explorerUrl: `${(process.env.GENLAYER_EXPLORER_URL || "https://explorer-studio-dev.genlayer.com").replace(/\/$/, "")}/tx/${hash}`, error: "" });
      await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "evaluating", updatedAt: new Date() } });
      return;
    }
    if (job.status === "transaction_failed" && start) {
      const state = transactionState(await genlayerClient().getTransaction({ hash: String(job.genlayerTxHash) as never }) as unknown as Record<string, unknown>);
      if (!state.failed) throw new HttpError(409, "The original transaction has not definitively failed.");
      await db.collection("proposalJobs").updateOne({ proposalId, lease }, { $push: { previousTransactions: job.genlayerTxHash }, $unset: { genlayerTxHash: "", explorerUrl: "" }, $set: { status: "queued", error: "" } });
      await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "awaiting_ai_review" } });
      return;
    }
    const transaction = await genlayerClient().getTransaction({ hash: String(job.genlayerTxHash) as never });
    const state = transactionState(transaction as unknown as Record<string, unknown>);
    await update({ genlayerStatus: state.status });
    if (state.failed) { await update({ status: "transaction_failed", error: "GenLayer reports a failed or canceled transaction. Retry safely to queue another attempt." }); return; }
    if (!state.finalized) { await update({ status: "evaluating", error: "" }); return; }
    if (!state.successful) throw new HttpError(409, "Finality was reported without a successful execution result. Waiting for a verifiable receipt.");
    const evaluation = await finalizedEvaluation(proposal.daoId, proposalId, address);
    if (String(evaluation.rules_version) !== String(proposal.rulesVersion || dao.rulesVersion)) throw new HttpError(409, "The review used a different constitution version. Submit a linked replacement against the current policy.");
    await update({ status: "relaying", error: "" });
    await relayReview(proposal, job, evaluation);
  } catch (error) {
    const status = job.status === "broadcasting" ? "submission_unknown" : job.genlayerTxHash ? (job.status === "relaying" ? "relay_failed" : String(job.status)) : "queued";
    await update({ status, error: safeError(error) });
    if (!job.genlayerTxHash) await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "awaiting_ai_review", updatedAt: new Date() } });
  } finally {
    await db.collection("proposalJobs").updateOne({ proposalId, lease }, { $unset: { lease: "", leaseUntil: "" } });
  }
}
