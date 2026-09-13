import type { Address } from "viem";
import { baseClient, daoAbi } from "./_chain.js";
import { database } from "./_db.js";
import { evaluatorAddress, genlayerClient, transactionState } from "./_genlayer.js";
import { HttpError, safeError } from "./_http.js";

export async function readPolicy(address: Address) {
  const client = baseClient();
  const version = await client.readContract({ address, abi: daoAbi, functionName: "activeConstitutionVersion" }) as bigint;
  const [constitution, threshold, admin] = await Promise.all([
    client.readContract({ address, abi: daoAbi, functionName: "getConstitution", args: [version] }),
    client.readContract({ address, abi: daoAbi, functionName: "manualFundingThreshold" }),
    client.readContract({ address, abi: daoAbi, functionName: "admin" }),
  ]);
  return { version: String(version), constitution: constitution as Record<string, unknown>, threshold: String(threshold), admin: String(admin) };
}

export async function syncDaoPolicy(daoId: string) {
  const db = await database();
  const dao = await db.collection("daoIndex").findOne({ daoId });
  if (!dao) throw new HttpError(404, "DAO not found.");
  const lease = await db.collection("daoIndex").findOneAndUpdate({ daoId, $or: [{ policyLeaseUntil: { $exists: false } }, { policyLeaseUntil: { $lt: new Date() } }] }, { $set: { policyLeaseUntil: new Date(Date.now() + 120_000) } }, { returnDocument: "after" });
  if (!lease) return;
  try {
    const state = await readPolicy(dao.dao as Address);
    if (state.version === "0") throw new HttpError(409, "The DAO needs an active onchain constitution first.");
    let hash = dao.policyTxVersion === state.version ? dao.policyTxHash : undefined;
    const policyText = String(state.constitution.policyText || "");
    if (dao.rulesVersion === state.version && dao.policySyncStatus === "ready" && dao.constitution === policyText && !dao.pendingMission) return;
    if (!hash) {
      if (dao.policySyncStatus === "submission_unknown" && dao.policyTxVersion === state.version) throw new HttpError(409, "Policy submission was interrupted. Reconcile the GenLayer transaction before submitting again.");
      const client = genlayerClient(true); const address = evaluatorAddress();
      const args = [daoId, state.version, policyText, JSON.stringify({ mission: dao.pendingMission || dao.mission, weeklySpendLimit: String(state.constitution.weeklySpendLimit), allInputsUntrusted: true })];
      const fees = await client.estimateTransactionFeesForWrite({ address, functionName: "set_constitution", args });
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { policySyncStatus: "submission_unknown", policyTxVersion: state.version } });
      hash = String(await client.writeContract({ address, functionName: "set_constitution", args, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } }));
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { policyTxHash: hash, policySyncStatus: "pending", policyTxVersion: state.version, policyError: "" } });
      return;
    }
    const transaction = await genlayerClient().getTransaction({ hash: String(hash) as never });
    const progress = transactionState(transaction as unknown as Record<string, unknown>);
    if (progress.failed) {
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { policySyncStatus: "failed", policyError: "The policy transaction failed. Retry synchronization." }, $unset: { policyTxHash: "" } });
      return;
    }
    if (!progress.finalized || !progress.successful) return;
    await db.collection("daoIndex").updateOne({ daoId }, { $set: { rulesVersion: state.version, constitution: policyText, mission: dao.pendingMission || dao.mission || "", policySyncStatus: "ready", policyError: "", treasuryPolicy: { ...dao.treasuryPolicy, weeklyUsdcLimit: String(Number(state.constitution.weeklySpendLimit) / 1e6), manualFundingThreshold: String(Number(state.threshold) / 1e6) }, updatedAt: new Date() }, $unset: { pendingMission: "", pendingConstitution: "" } });
  } catch (error) {
    await db.collection("daoIndex").updateOne({ daoId }, { $set: { policyError: safeError(error) } });
    throw error;
  } finally { await db.collection("daoIndex").updateOne({ daoId }, { $unset: { policyLeaseUntil: "" } }); }
}
