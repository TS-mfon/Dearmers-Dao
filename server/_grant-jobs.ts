import { randomUUID } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { database } from "./_db.js";
import { evaluatorAddress, finalizedGrantEvaluation, genlayerClient, transactionState } from "./_genlayer.js";
import { HttpError, safeError } from "./_http.js";

function grantRulesVersion(grant: Document) {
  return String(grant.rulesVersion || grant.version || "1");
}

async function syncGrantPolicy(grant: Document, address: `0x${string}`) {
  const db = await database();
  const version = grantRulesVersion(grant);
  if (grant.policySyncStatus === "ready" && grant.policyRulesVersion === version && String(grant.policyEvaluatorAddress || "").toLowerCase() === address.toLowerCase()) return true;
  const lease = randomUUID();
  const claimed = await db.collection("grants").findOneAndUpdate({ _id: grant._id, $or: [{ policyLeaseUntil: { $exists: false } }, { policyLeaseUntil: { $lt: new Date() } }] }, { $set: { policyLease: lease, policyLeaseUntil: new Date(Date.now() + 120_000) } }, { returnDocument: "after" });
  if (!claimed) return false;
  try {
    const samePolicy = claimed.policyRulesVersion === version && String(claimed.policyEvaluatorAddress || "").toLowerCase() === address.toLowerCase();
    let hash = samePolicy ? String(claimed.policyTxHash || "") : "";
    if (!hash) {
      const rulesText = String(claimed.requirements || claimed.criteria || claimed.constitution || claimed.description || "").trim();
      if (!rulesText) throw new HttpError(409, "This grant has no requirements or evaluation criteria to synchronize.");
      const args = [String(claimed.grantId), version, rulesText, JSON.stringify({ mission: claimed.mission || claimed.description || "", eligibility: claimed.eligibility || "", milestones: claimed.milestones || "", evidenceRequired: true, allInputsUntrusted: true })];
      const client = genlayerClient(true);
      const fees = await client.estimateTransactionFeesForWrite({ address, functionName: "set_constitution", args });
      await db.collection("grants").updateOne({ _id: claimed._id, policyLease: lease }, { $set: { policySyncStatus: "broadcasting", policyRulesVersion: version, policyEvaluatorAddress: address, policyError: "", updatedAt: new Date() }, $unset: { policyTxHash: "" } });
      hash = String(await client.writeContract({ address, functionName: "set_constitution", args, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } } as never));
      await db.collection("grants").updateOne({ _id: claimed._id, policyLease: lease }, { $set: { policyTxHash: hash, policySyncStatus: "pending", updatedAt: new Date() } });
      return false;
    }
    const state = transactionState(await genlayerClient().getTransaction({ hash: hash as never }) as unknown as Record<string, unknown>);
    if (state.disputed) { await db.collection("grants").updateOne({ _id: claimed._id, policyLease: lease }, { $set: { policySyncStatus: "consensus_disputed", policyError: "Grant requirements synchronization is disputed or undetermined.", updatedAt: new Date() } }); return false; }
    if (state.failed) { await db.collection("grants").updateOne({ _id: claimed._id, policyLease: lease }, { $set: { policySyncStatus: "failed", policyError: "Grant requirements synchronization failed and will be retried.", updatedAt: new Date() }, $unset: { policyTxHash: "" } }); return false; }
    if (!state.finalized || !state.successful) return false;
    await db.collection("grants").updateOne({ _id: claimed._id, policyLease: lease }, { $set: { policySyncStatus: "ready", policyError: "", policyRulesVersion: version, policyEvaluatorAddress: address, updatedAt: new Date() } });
    return true;
  } catch (error) {
    await db.collection("grants").updateOne({ _id: grant._id, policyLease: lease }, { $set: { policySyncStatus: "failed", policyError: safeError(error), updatedAt: new Date() } });
    throw error;
  } finally {
    await db.collection("grants").updateOne({ _id: grant._id, policyLease: lease }, { $unset: { policyLease: "", policyLeaseUntil: "" } });
  }
}

export async function reconcileGrantApplication(applicationId: string, start = false) {
  if (!ObjectId.isValid(applicationId)) throw new HttpError(400, "A valid grant application id is required.");
  const db = await database();
  const application = await db.collection("grantApplications").findOne({ _id: new ObjectId(applicationId) });
  if (!application) throw new HttpError(404, "Grant application not found.");
  if (["recommended_for_funding", "rejected", "corrections_required", "further_review"].includes(String(application.status))) return;
  const grant = await db.collection("grants").findOne({ $or: [{ grantId: application.grantId }, { slug: application.grantId }] });
  if (!grant) throw new HttpError(404, "Grant program not found.");
  await db.collection("grantJobs").updateOne({ applicationId }, { $setOnInsert: { applicationId, grantId: application.grantId, status: "queued", createdAt: new Date() } }, { upsert: true });
  const lease = randomUUID();
  const job = await db.collection("grantJobs").findOneAndUpdate({ applicationId, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { lease, leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }, $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!job) return;
  const update = async (values: Document) => { Object.assign(job, values); await db.collection("grantJobs").updateOne({ applicationId, lease }, { $set: { ...values, updatedAt: new Date() } }); };
  try {
    const address = String(job.evaluatorAddress || evaluatorAddress()) as `0x${string}`;
    if (!await syncGrantPolicy(grant, address)) { await update({ status: "syncing_policy", evaluatorAddress: address, error: "Grant requirements are being synchronized with GenLayer." }); return; }
    if (!job.genlayerTxHash) {
      if (!start) return;
      const args = [String(application.grantId), applicationId, JSON.stringify({ project_name: application.projectName, description: application.description, requested_amount: application.requestedAmount || "", recipient: application.recipient || "", milestones: application.milestones || "", team: application.team || "", evidence: application.links || [], claims: application.claims || [] })];
      await update({ status: "submitting", evaluatorAddress: address, error: "" });
      const client = genlayerClient(true);
      const fees = await client.estimateTransactionFeesForWrite({ address, functionName: "evaluate_grant", args });
      await update({ status: "broadcasting" });
      const hash = String(await client.writeContract({ address, functionName: "evaluate_grant", args, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } } as never));
      await update({ status: "submitted", genlayerTxHash: hash, genlayerStatus: "PENDING", explorerUrl: `${(process.env.GENLAYER_EXPLORER_URL || "https://explorer-studio-dev.genlayer.com").replace(/\/$/, "")}/tx/${hash}`, error: "" });
      await db.collection("grantApplications").updateOne({ _id: application._id }, { $set: { status: "evaluating", updatedAt: new Date() } });
      return;
    }
    const state = transactionState(await genlayerClient().getTransaction({ hash: String(job.genlayerTxHash) as never }) as unknown as Record<string, unknown>);
    await update({ genlayerStatus: state.status });
    if (state.disputed) { await update({ status: "consensus_disputed", error: "GenLayer consensus is undetermined or disputed. No grant recommendation exists yet." }); return; }
    if (state.executionFailed) { await update({ status: "evaluation_unavailable", error: "GenLayer finalized the transaction without a valid grant evaluation." }); return; }
    if (state.canceled) { await update({ status: "transaction_failed", error: "The GenLayer grant evaluation was canceled." }); return; }
    if (!state.finalized) { await update({ status: "evaluating", error: "" }); return; }
    const evaluation = await finalizedGrantEvaluation(String(application.grantId), applicationId, address);
    if (String(evaluation.rules_version) !== grantRulesVersion(grant)) throw new HttpError(409, "The grant review used a different requirements version.");
    const status = evaluation.decision === "fund" ? "recommended_for_funding" : evaluation.decision === "revise" ? "corrections_required" : evaluation.decision === "escalate" ? "further_review" : "rejected";
    await db.collection("grantApplications").updateOne({ _id: application._id }, { $set: { status, evaluation, genlayerTxHash: job.genlayerTxHash, updatedAt: new Date() } });
    await update({ status: "complete", error: "" });
  } catch (error) {
    await update({ status: job.status === "broadcasting" ? "submission_unknown" : String(job.status || "queued"), error: safeError(error) });
  } finally {
    await db.collection("grantJobs").updateOne({ applicationId, lease }, { $unset: { lease: "", leaseUntil: "" } });
  }
}
