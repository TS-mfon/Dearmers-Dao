import { randomUUID } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { database } from "./_db.js";
import { evaluatorAddress, finalizedEvaluation, genlayerClient, isRejectedBeforeBroadcast, receiptEvaluation, transactionState, tryNormalizeEvaluation, withGenlayerRetry } from "./_genlayer.js";
import { HttpError, safeError, userMessage } from "./_http.js";
import { relayReview } from "./reviews.js";
import { reviewPending, reviewSettled } from "../shared/proposals.js";
import { syncDaoPolicy } from "./_policy.js";

const readTransaction = (hash: string) => withGenlayerRetry(() => genlayerClient().getTransaction({ hash: hash as never })) as Promise<Record<string, unknown>>;

/** The contract that actually executed this review, so an evaluator redeploy never redirects the read. */
function transactionEvaluator(transaction: Record<string, unknown>, fallback: `0x${string}`) {
  const target = String(transaction.to_address || transaction.recipient || "");
  return (/^0x[a-fA-F0-9]{40}$/.test(target) ? target : fallback) as `0x${string}`;
}

export async function reconcileReview(proposalId: string, start = false, recoveryHash = "") {
  if (!ObjectId.isValid(proposalId)) throw new HttpError(400, "A valid proposal id is required.");
  const db = await database();
  const proposal = await db.collection("proposals").findOne({ _id: new ObjectId(proposalId) });
  if (!proposal) throw new HttpError(404, "Proposal not found.");
  const resumable = reviewPending(String(proposal.status)) || (start && String(proposal.status) === "consensus_disputed");
  if (!resumable) return;
  const dao = await db.collection("daoIndex").findOne({ daoId: proposal.daoId, banned: { $ne: true } });
  if (!dao) throw new HttpError(404, "DAO not found.");
  await db.collection("proposalJobs").updateOne({ proposalId }, { $setOnInsert: { proposalId, daoId: proposal.daoId, daoAddress: dao.dao, status: "queued", createdAt: new Date() } }, { upsert: true });
  const existing = await db.collection("proposalJobs").findOne({ proposalId }, { projection: { status: 1 } });
  // A settled job will not change without a member action, so background passes must not spend an RPC slot on it.
  if (!start && !recoveryHash && reviewSettled({ status: String(existing?.status || "") })) return;
  const lease = randomUUID();
  const job = await db.collection("proposalJobs").findOneAndUpdate({ proposalId, $or: [{ leaseUntil: { $lt: new Date() } }, { leaseUntil: { $exists: false } }] }, { $set: { lease, leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }, $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!job) return;
  const update = async (values: Document) => { Object.assign(job, values); await db.collection("proposalJobs").updateOne({ proposalId, lease }, { $set: { ...values, updatedAt: new Date() } }); };
  try {
    const configuredAddress = evaluatorAddress();
    const address = String(job.genlayerTxHash ? job.evaluatorAddress || configuredAddress : configuredAddress) as `0x${string}`;
    if (recoveryHash) {
      if (job.genlayerTxHash || !["broadcasting", "submission_unknown"].includes(String(job.status))) throw new HttpError(409, "This job does not need a recovered transaction.");
      if (!/^0x[a-fA-F0-9]{64}$/.test(recoveryHash)) throw new HttpError(400, "Enter a valid GenLayer transaction hash.");
      const transaction = await readTransaction(recoveryHash);
      if (String(transaction.to_address || transaction.recipient || "").toLowerCase() !== address.toLowerCase()) throw new HttpError(422, "The recovered transaction targets a different contract.");
      const recoveredState = transactionState(transaction);
      if (recoveredState.disputed) throw new HttpError(409, "The recovered GenLayer transaction is disputed or undetermined and has no relayable verdict.");
      if (!recoveredState.finalized || !recoveredState.successful) throw new HttpError(409, "Wait for the recovered transaction to finalize successfully before attaching it.");
      if (!receiptEvaluation(transaction)) await finalizedEvaluation(proposal.daoId, proposalId, address);
      await update({ genlayerTxHash: recoveryHash, evaluatorAddress: address, status: "submitted", error: "", message: "" });
    }
    if (!job.genlayerTxHash) {
      if (["broadcasting", "submission_unknown"].includes(String(job.status))) {
        await update({ status: "submission_unknown", error: "The submission response was interrupted. Recover the finalized transaction hash; do not submit a second review.", message: "We could not confirm whether this review reached GenLayer. A DAO steward must attach the finalized transaction hash before another review is submitted." });
        return;
      }
      const reviewRequested = start || job.status === "syncing_policy";
      if (!reviewRequested) return;
      const policyReady = dao.policySyncStatus === "ready" && String(dao.policyEvaluatorAddress || "").toLowerCase() === configuredAddress.toLowerCase();
      if (!policyReady) {
        await update({ status: "syncing_policy", evaluatorAddress: configuredAddress, error: "Synchronizing this DAO's constitution with the current GenLayer evaluator.", message: "This DAO's constitution is being synchronized with GenLayer. The review starts automatically once that completes." });
        await syncDaoPolicy(proposal.daoId);
        const synchronizedDao = await db.collection("daoIndex").findOne({ daoId: proposal.daoId, banned: { $ne: true } });
        const synchronized = synchronizedDao?.policySyncStatus === "ready" && String(synchronizedDao?.policyEvaluatorAddress || "").toLowerCase() === configuredAddress.toLowerCase();
        if (!synchronized) {
          await update({ status: "syncing_policy", error: String(synchronizedDao?.policyError || "The platform is synchronizing this DAO's constitution with GenLayer. Review submission will resume automatically."), message: "This DAO's constitution is being synchronized with GenLayer. The review starts automatically once that completes." });
          return;
        }
        Object.assign(dao, synchronizedDao);
      }
      await update({ status: "submitting", evaluatorAddress: address, error: "", message: "" });
      const client = genlayerClient(true);
      const args = [proposal.daoId, proposalId, JSON.stringify({ title: proposal.title, description: proposal.description, amount: proposal.amount, recipient: proposal.recipient, category: proposal.category, evidence: proposal.evidence || [], mission: proposal.missionSnapshot || dao.mission, constitution: proposal.constitutionSnapshot || dao.constitution })];
      const fees = await withGenlayerRetry(() => client.estimateTransactionFeesForWrite({ address, functionName: "evaluate_proposal", args }));
      await update({ status: "broadcasting" });
      const hash = String(await client.writeContract({ address, functionName: "evaluate_proposal", args, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } } as never));
      await update({ status: "submitted", genlayerTxHash: hash, genlayerStatus: "PENDING", explorerUrl: `${(process.env.GENLAYER_EXPLORER_URL || "https://explorer-studio-dev.genlayer.com").replace(/\/$/, "")}/tx/${hash}`, error: "", message: "" });
      await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "evaluating", updatedAt: new Date() } });
      return;
    }
    if (["transaction_failed", "evaluation_unavailable", "consensus_disputed"].includes(String(job.status)) && start) {
      const state = transactionState(await readTransaction(String(job.genlayerTxHash)));
      if (!state.failed && !state.disputed) throw new HttpError(409, "The original transaction has not definitively failed.");
      await db.collection("proposalJobs").updateOne({ proposalId, lease }, { $push: { previousTransactions: job.genlayerTxHash }, $unset: { genlayerTxHash: "", explorerUrl: "", consensusReached: "" }, $set: { status: "queued", error: "", message: "" } });
      await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "awaiting_ai_review" }, $unset: { consensusReached: "" } });
      return;
    }
    const transaction = await readTransaction(String(job.genlayerTxHash));
    const state = transactionState(transaction);
    const readAddress = transactionEvaluator(transaction, address);
    await update({ genlayerStatus: state.status, evaluatorAddress: readAddress });
    if (state.disputed) {
      // Undetermined consensus: the leader's assessment is recoverable from the receipt and is worth
      // showing, but it is advisory only and must never reach Base or open member voting.
      const advisory = tryNormalizeEvaluation(receiptEvaluation(transaction), proposal.daoId, proposalId, "proposal");
      await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "consensus_disputed", evaluation: advisory, consensusReached: false, updatedAt: new Date() } });
      await update({ status: "consensus_disputed", consensusReached: false, error: "GenLayer consensus is undetermined or disputed. No Base review transaction will be submitted until a valid finalized verdict exists.", message: advisory ? "This DAO's validators did not reach consensus on this review. The leader validator's assessment below is shown for transparency — it is advisory only and does not open member voting." : "This DAO's validators did not reach consensus on this review, and no advisory assessment could be recovered. Retry the review to run a fresh evaluation." });
      return;
    }
    if (state.executionFailed) { await update({ status: "evaluation_unavailable", error: "GenLayer finalized the transaction, but contract execution did not produce a valid evaluation. Retry only after checking the contract and input parameters.", message: "GenLayer finalized this review without producing a valid evaluation. Retry the review to run a fresh evaluation." }); return; }
    if (state.canceled) { await update({ status: "transaction_failed", error: "GenLayer reports a canceled transaction. Retry safely to queue another attempt.", message: "GenLayer canceled this review transaction. Retry to queue another attempt." }); return; }
    if (!state.finalized) { await update({ status: "evaluating", error: "", message: "" }); return; }
    if (!state.successful) throw new HttpError(409, "Finality was reported without a successful execution result. Waiting for a verifiable receipt.");
    const leader = receiptEvaluation(transaction);
    // The receipt already carries what evaluate_proposal returned, so the happy path needs no contract
    // read — which is what previously surfaced a raw KeyError whenever the stored verdict was missing.
    let evaluation = tryNormalizeEvaluation(leader, proposal.daoId, proposalId, "proposal");
    if (!evaluation) {
      try { evaluation = await finalizedEvaluation(proposal.daoId, proposalId, readAddress); }
      catch (error) {
        const text = safeError(error).toLowerCase();
        if (!text.includes("keyerror") && !text.includes("execution failed")) throw error;
        await update({ status: "evaluation_unavailable", error: safeError(error), message: userMessage(error) });
        return;
      }
    }
    if (String(evaluation.rules_version) !== String(proposal.rulesVersion || dao.rulesVersion)) throw new HttpError(409, "The review used a different constitution version. Submit a linked replacement against the current policy.");
    await update({ status: "relaying", error: "", message: "" });
    await relayReview(proposal, job, evaluation);
  } catch (error) {
    // A capacity rejection proves the node never queued the transaction, so there is nothing to recover
    // and the job can safely requeue. Anything less definitive stays submission_unknown.
    const rejected = job.status === "broadcasting" && isRejectedBeforeBroadcast(error);
    const status = rejected ? "queued"
      : job.status === "broadcasting" ? "submission_unknown"
      : job.genlayerTxHash ? (job.status === "relaying" ? "relay_failed" : String(job.status))
      : "queued";
    await update({ status, error: safeError(error), message: userMessage(error) });
    if (!job.genlayerTxHash) await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status: "awaiting_ai_review", updatedAt: new Date() } });
  } finally {
    await db.collection("proposalJobs").updateOne({ proposalId, lease }, { $unset: { lease: "", leaseUntil: "" } });
  }
}
