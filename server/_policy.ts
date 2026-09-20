import { isAddress, parseUnits, type Address } from "viem";
import { baseClient, baseSigner, confirmed, daoAbi } from "./_chain.js";
import { database } from "./_db.js";
import { evaluatorAddress, genlayerClient, transactionState } from "./_genlayer.js";
import { HttpError, safeError } from "./_http.js";

export async function readPolicy(address: Address) {
  const client = baseClient();
  const version = await client.readContract({ address, abi: daoAbi, functionName: "activeConstitutionVersion" } as never) as bigint;
  const [constitution, admin] = await Promise.all([
    version > 0n ? client.readContract({ address, abi: daoAbi, functionName: "getConstitution", args: [version] } as never) : Promise.resolve({}),
    client.readContract({ address, abi: daoAbi, functionName: "admin" } as never),
  ]);
  let threshold = (2n ** 256n) - 1n;
  try { threshold = await client.readContract({ address, abi: daoAbi, functionName: "manualFundingThreshold" } as never) as bigint; } catch (error) { void error; }
  return { version: String(version), constitution: constitution as Record<string, unknown>, threshold: String(threshold), admin: String(admin), governanceConfigured: version > 0n };
}

async function repairLegacyGovernance(dao: Record<string, unknown>, address: Address, currentVersion: bigint): Promise<"ready" | "pending"> {
  const admin = String(await baseClient().readContract({ address, abi: daoAbi, functionName: "admin" } as never)).toLowerCase();
  const signer = baseSigner(process.env.BASE_PLATFORM_SIGNER_PRIVATE_KEY ? "BASE_PLATFORM_SIGNER_PRIVATE_KEY" : "BASE_AUTOMATION_PRIVATE_KEY");
  if (admin !== signer.account.address.toLowerCase()) throw new HttpError(409, "This DAO has no active constitution and its onchain administrator is not the configured platform signer. The DAO owner must initialize governance from the DAO wallet.");
  const client = baseClient();
  const latestBlock = await client.getBlock();
  let scheduled: Record<string, unknown> | null = null;
  try {
    const result = await client.readContract({ address, abi: daoAbi, functionName: "getConstitution", args: [currentVersion + 1n] } as never);
    scheduled = result as Record<string, unknown>;
  } catch (error) { void error; }

  if (scheduled) {
    const scheduledVersion = BigInt(String(scheduled.version ?? 0));
    const activatesAt = BigInt(String(scheduled.activatesAt ?? 0));
    if (scheduledVersion === currentVersion + 1n && activatesAt > 0n) {
      if (latestBlock.timestamp < activatesAt) return "pending";
      try {
        await confirmed(await signer.writeContract({ address, abi: daoAbi, functionName: "activateConstitution", args: [scheduledVersion] } as never));
      } catch (error) {
        const activeVersion = await client.readContract({ address, abi: daoAbi, functionName: "activeConstitutionVersion" } as never) as bigint;
        if (activeVersion !== scheduledVersion) throw error;
      }
      return "ready";
    }
  }

  const gate = (dao.gate && typeof dao.gate === "object" ? dao.gate : {}) as Record<string, unknown>;
  const gateToken = isAddress(String(gate.asset || "")) ? String(gate.asset) : "0x0000000000000000000000000000000000000000";
  const weeklyLimit = parseUnits(String((dao.treasuryPolicy as Record<string, unknown> | undefined)?.weeklyUsdcLimit || "1000"), 6);
  const policy = { version: 0n, activatesAt: latestBlock.timestamp + 120n, votingPeriod: 259200, maxProposalAmount: 250000000n, weeklySpendLimit: weeklyLimit, quorumBps: 2000, approvalBps: 5000, participationWeightCap: 10, tokenWeightCap: 10, gateToken, gateBalance: gateToken === "0x0000000000000000000000000000000000000000" ? 0n : 1n, tokenWeightUnit: 0n, categories: String(dao.category || "general"), policyText: String(dao.pendingConstitution || dao.constitution || ""), active: false };
  if (!policy.policyText) throw new HttpError(409, "This DAO has no constitution text to initialize governance.");
  const scheduleTxHash = await signer.writeContract({ address, abi: daoAbi, functionName: "scheduleConstitution", args: [policy] } as never);
  await confirmed(scheduleTxHash);
  return "pending";
}

export async function syncDaoPolicy(daoId: string) {
  const db = await database();
  const dao = await db.collection("daoIndex").findOne({ daoId });
  if (!dao) throw new HttpError(404, "DAO not found.");
  const lease = await db.collection("daoIndex").findOneAndUpdate({ daoId, $or: [{ policyLeaseUntil: { $exists: false } }, { policyLeaseUntil: { $lt: new Date() } }] }, { $set: { policyLeaseUntil: new Date(Date.now() + 120_000) } }, { returnDocument: "after" });
  if (!lease) return;
  try {
    const address = evaluatorAddress();
    const sameEvaluator = String(dao.policyEvaluatorAddress || "").toLowerCase() === address.toLowerCase();
    let state = await readPolicy(dao.dao as Address);
    if (state.version === "0") {
      const governanceState = await repairLegacyGovernance(dao, dao.dao as Address, BigInt(state.version));
      if (governanceState === "pending") {
        await db.collection("daoIndex").updateOne({ daoId }, { $set: { policySyncStatus: "pending", policyError: "Base constitution is scheduled. Waiting for its activation time before synchronizing GenLayer." } });
        return;
      }
      state = await readPolicy(dao.dao as Address);
    }
    let hash = sameEvaluator && dao.policyTxVersion === state.version ? dao.policyTxHash : undefined;
    const policyText = String(state.constitution.policyText || "");
    if (sameEvaluator && dao.rulesVersion === state.version && dao.policySyncStatus === "ready" && dao.constitution === policyText && !dao.pendingMission) return;
    if (!hash) {
      if (sameEvaluator && dao.policySyncStatus === "submission_unknown" && dao.policyTxVersion === state.version) throw new HttpError(409, "Policy submission was interrupted. Reconcile the GenLayer transaction before submitting again.");
      const client = genlayerClient(true);
      const args = [daoId, state.version, policyText, JSON.stringify({ mission: dao.pendingMission || dao.mission, weeklySpendLimit: String(state.constitution.weeklySpendLimit), allInputsUntrusted: true })];
      const fees = await client.estimateTransactionFeesForWrite({ address, functionName: "set_constitution", args });
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { policySyncStatus: "submission_unknown", policyTxVersion: state.version, policyEvaluatorAddress: address, policyError: "" }, $unset: { policyTxHash: "" } });
      hash = String(await client.writeContract({ address, functionName: "set_constitution", args, fees: { distribution: fees.distribution, messageAllocations: fees.messageAllocations, feeValue: fees.feeValue } }));
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { policyTxHash: hash, policySyncStatus: "pending", policyTxVersion: state.version, policyEvaluatorAddress: address, policyError: "" } });
      return;
    }
    const transaction = await genlayerClient().getTransaction({ hash: String(hash) as never });
    const progress = transactionState(transaction as unknown as Record<string, unknown>);
    if (progress.failed) {
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { policySyncStatus: "failed", policyEvaluatorAddress: address, policyError: "The policy transaction failed. Retry synchronization." }, $unset: { policyTxHash: "" } });
      return;
    }
    if (!progress.finalized || !progress.successful) return;
    await db.collection("daoIndex").updateOne({ daoId }, { $set: { rulesVersion: state.version, constitution: policyText, mission: dao.pendingMission || dao.mission || "", policySyncStatus: "ready", policyEvaluatorAddress: address, policyError: "", treasuryPolicy: { ...dao.treasuryPolicy, weeklyUsdcLimit: String(Number(state.constitution.weeklySpendLimit) / 1e6), manualFundingThreshold: String(Number(state.threshold) / 1e6) }, updatedAt: new Date() }, $unset: { pendingMission: "", pendingConstitution: "" } });
  } catch (error) {
    await db.collection("daoIndex").updateOne({ daoId }, { $set: { policyError: safeError(error) } });
    throw error;
  } finally { await db.collection("daoIndex").updateOne({ daoId }, { $unset: { policyLeaseUntil: "" } }); }
}
