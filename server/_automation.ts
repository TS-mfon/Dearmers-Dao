import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { decodeEventLog, encodeFunctionData, hashMessage, parseAbi, type Address, type Hex } from "viem";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { redelegatePermissionContextAction } from "@metamask/smart-accounts-kit/actions";
import { baseClient, baseSigner, chainProposal, confirmed, daoAbi } from "./_chain.js";
import { database } from "./_db.js";
import { decrypt, encrypt } from "./_crypto.js";
import { safeError } from "./_http.js";
import { reconcileReview } from "./_proposal-jobs.js";
import { syncProposalState } from "./_proposal-state.js";
import { reconcileCreation } from "./_dao-creation.js";
import { syncDaoPolicy } from "./_policy.js";

const transferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
type RelayerResult = { requiredPaymentAmount?: string; context?: unknown; taskId?: string; status?: string; error?: string; message?: string; receipt?: { transactionHash?: Hex }; hash?: Hex; txHash?: Hex; targetAddress?: Address; feeCollector?: Address };
async function relayer(method: string, params: unknown): Promise<RelayerResult> {
  const response = await fetch(process.env.ONESHOT_RELAYER_URL || "https://relayer.1shotapi.dev/relayers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as { result: RelayerResult | string; error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(body.error?.message || `Relayer returned HTTP ${response.status}.`);
  return typeof body.result === "string" ? { taskId: body.result } : body.result;
}

export async function executeProposal(proposal: Document) {
  const db = await database(); const address = proposal.daoAddress as Address; const proposalId = BigInt(String(proposal.onchainProposalId));
  const state = await chainProposal(address, proposalId);
  if (![4, 10].includes(state.status) || state.kind !== 0) return;
  const mode = await baseClient().readContract({ address, abi: daoAbi, functionName: "mode" });
  if (Number(mode) !== 0) return;
  const executionKey = hashMessage(`84532:${address.toLowerCase()}:${proposalId}`);
  await db.collection("executionJobs").updateOne({ executionKey }, { $setOnInsert: { executionKey, daoId: proposal.daoId, proposalId: String(proposal._id), daoAddress: address, status: "queued", createdAt: new Date() } }, { upsert: true });
  const lease = randomUUID();
  const job = await db.collection("executionJobs").findOneAndUpdate({ executionKey, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { lease, leaseUntil: new Date(Date.now() + 180_000) } }, { returnDocument: "after" });
  if (!job) return;
  const update = async (values: Document) => { Object.assign(job, values); await db.collection("executionJobs").updateOne({ executionKey, lease }, { $set: { ...values, updatedAt: new Date() } }); };
  try {
    if (["broadcasting", "submission_unknown"].includes(job.status) && !job.taskId && !job.paymentHash) throw new Error("Payment submission response was interrupted. Reconcile the relayer task or transfer receipt before retrying; another payment will not be sent.");
    const wallet = baseSigner("BASE_AUTOMATION_PRIVATE_KEY");
    const stored = await db.collection("delegations").findOne({ daoId: proposal.daoId, daoAddress: address.toLowerCase(), status: "active" });
    if (!stored?.payload || stored.executor !== wallet.account.address.toLowerCase()) throw new Error("This DAO needs an active delegation for the configured automation executor.");
    const expectedToken = (process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase();
    if (String(stored.token).toLowerCase() !== expectedToken) throw new Error("The treasury delegation is not for the configured USDC token.");
    if (!job.taskId && !job.paymentHash) {
      let payload: unknown;
      let fee: bigint;
      if (job.paymentRequest) { payload = decrypt(job.paymentRequest); fee = BigInt(job.fee); }
      else {
        const permissions = decrypt(stored.payload); const parent = Array.isArray(permissions) ? permissions[0] : permissions;
        const permissionContext = parent?.context || parent?.permissionContext;
        if (!permissionContext) throw new Error("The treasury delegation has no permission context.");
        const fees = await relayer("relayer_getFeeData", { chainId: "84532", token: stored.token });
        if (!fees.targetAddress || !fees.feeCollector) throw new Error("The relayer did not return a fee collector and target.");
        const redelegated = await redelegatePermissionContextAction(wallet as never, { permissionContext, to: fees.targetAddress, environment: getSmartAccountsEnvironment(84532), chainId: 84532, allowInsecureUnrestrictedDelegation: true } as never) as unknown as { delegation: Record<string, unknown>; permissionContext: string };
        const child = { ...redelegated.delegation, context: redelegated.permissionContext };
        parent.context = redelegated.permissionContext;
        const work = { target: stored.token, value: "0x0", data: encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [state.recipient, state.amount] }) };
        const feeExecution = (amount: bigint) => ({ target: stored.token, value: "0x0", data: encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [fees.feeCollector!, amount] }) });
        const request = (amount: bigint) => ({ chainId: "84532", transactions: [{ permissionContext: [child, parent], executions: [feeExecution(amount), work] }], authorizationList: [] });
        const estimate = await relayer("relayer_estimate7710Transaction", request(1_000_000n));
        fee = BigInt(String(estimate.requiredPaymentAmount));
        const exact = await relayer("relayer_estimate7710Transaction", request(fee));
        if (BigInt(String(exact.requiredPaymentAmount)) > fee) throw new Error("Relayer fee increased during estimation. Retry before reserving budget.");
        payload = { ...request(fee), context: exact.context };
        await update({ paymentRequest: encrypt(payload), fee: String(fee), status: "estimated" });
      }
      const current = await chainProposal(address, proposalId);
      if (current.status === 4) {
        if (!job.reservationHash) { const hash = await wallet.writeContract({ address, abi: daoAbi, functionName: "reserveProposalExecution", args: [proposalId, executionKey, fee] }); await update({ reservationHash: hash }); }
        await confirmed(job.reservationHash as Hex);
      }
      const reserved = await chainProposal(address, proposalId);
      if (reserved.status === 9) { await update({ status: "manual_funding", error: "Approved request exceeds the automatic funding threshold or remaining weekly budget." }); await syncProposalState(proposal); return; }
      if (reserved.status !== 10) throw new Error("Payment requires a confirmed onchain budget reservation.");
      const paused = await baseClient().readContract({ address, abi: daoAbi, functionName: "emergencyPaused" });
      if (paused) throw new Error("DAO treasury is paused. The reserved payment has not been sent.");
      await update({ status: "broadcasting" });
      const result = await relayer("relayer_send7710Transaction", payload);
      if (!result.taskId) throw new Error("Relayer returned no task identifier; reconcile before retrying.");
      await update({ taskId: result.taskId, status: "submitted", error: "" });
    }
    if (!job.paymentHash) {
      const result = await relayer("relayer_getStatus", { id: job.taskId, logs: false });
      if (String(result.status) !== "200") {
        if (["400", "500"].includes(String(result.status))) throw new Error(`Relayer requires investigation: ${result.error || result.message || result.status}`);
        return;
      }
      const hash = result.receipt?.transactionHash || result.hash || result.txHash;
      if (!hash) throw new Error("Relayer reports completion without a payment receipt.");
      await update({ paymentHash: hash, status: "confirming" });
    }
    const paymentReceipt = await confirmed(job.paymentHash as Hex);
    const transferred = paymentReceipt.logs.some((log) => {
      if (log.address.toLowerCase() !== expectedToken) return false;
      try { const event = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics }); return event.args.from.toLowerCase() === stored.treasury.toLowerCase() && event.args.to.toLowerCase() === state.recipient.toLowerCase() && event.args.value === state.amount; } catch { return false; }
    });
    if (!transferred) throw new Error("The payment receipt does not contain the authorized treasury transfer.");
    const current = await chainProposal(address, proposalId);
    if (current.status !== 5) {
      if (!job.recordHash) { const hash = await wallet.writeContract({ address, abi: daoAbi, functionName: "recordProposalExecution", args: [proposalId, job.paymentHash] }); await update({ recordHash: hash }); }
      await confirmed(job.recordHash as Hex);
    }
    await update({ status: "complete", error: "" });
    await syncProposalState(proposal);
  } catch (error) {
    await update({ status: job.status === "broadcasting" ? "submission_unknown" : job.status, error: safeError(error) });
  } finally { await db.collection("executionJobs").updateOne({ executionKey, lease }, { $unset: { lease: "", leaseUntil: "" } }); }
}

export async function reconcileApplication(limit = 25) {
  const db = await database(); const errors: string[] = []; let processed = 0;
  const attempt = async (task: () => Promise<unknown>) => { try { await task(); processed++; } catch (error) { errors.push(safeError(error)); } };
  for (const job of await db.collection("daoCreationJobs").find({ status: { $ne: "ready" } }).limit(limit).toArray()) await attempt(() => reconcileCreation(job.clientKey));
  for (const dao of await db.collection("daoIndex").find({ policySyncStatus: { $ne: "ready" } }).limit(limit).toArray()) await attempt(() => syncDaoPolicy(dao.daoId));
  for (const proposal of await db.collection("proposals").find({ status: { $in: ["awaiting_ai_review", "evaluating", "approved_for_voting"] } }).limit(limit).toArray()) await attempt(() => reconcileReview(String(proposal._id)));
  for (const vote of await db.collection("proposalVotes").find({ status: "pending", txHash: { $exists: true } }).limit(limit).toArray()) await attempt(async () => { const receipt = await baseClient().getTransactionReceipt({ hash: vote.txHash as Hex }); await db.collection("proposalVotes").updateOne({ _id: vote._id }, { $set: { status: receipt.status === "success" ? "confirmed" : "failed" } }); });
  const wallet = process.env.BASE_AUTOMATION_PRIVATE_KEY ? baseSigner("BASE_AUTOMATION_PRIVATE_KEY") : null;
  for (const proposal of await db.collection("proposals").find({ onchainProposalId: { $exists: true }, status: { $in: ["active_voting", "passed", "execution_pending", "manual_funding", "tied"] } }).limit(limit).toArray()) await attempt(async () => {
    const state = await chainProposal(proposal.daoAddress as Address, BigInt(proposal.onchainProposalId));
    if (state.status === 2 && Number(state.votingEndsAt) <= Date.now() / 1000 && wallet) { const hash = await wallet.writeContract({ address: proposal.daoAddress as Address, abi: daoAbi, functionName: "finalizeProposalVote", args: [BigInt(proposal.onchainProposalId)] }); await confirmed(hash); }
    await syncProposalState(proposal);
    if (wallet) await executeProposal(proposal);
  });
  return { processed, errors };
}
