import { ObjectId } from "mongodb";
import { parseUnits, type Address, type Hex } from "viem";
import { database } from "./_db.js";
import { baseClient, baseSigner, confirmed, registryAbi } from "./_chain.js";
import { syncDaoPolicy } from "./_policy.js";
import { HttpError, safeError } from "./_http.js";

export async function reconcileCreation(clientKey: string) {
  const db = await database();
  const job = await db.collection("daoCreationJobs").findOneAndUpdate({ clientKey, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { leaseUntil: new Date(Date.now() + 120_000) } }, { returnDocument: "after" });
  if (!job?.payload) return;
  try {
    const payload = job.payload;
    const registry = String(process.env.DEARMERS_REGISTRY_ADDRESS) as Address;
    const signer = baseSigner(process.env.BASE_PLATFORM_SIGNER_PRIVATE_KEY ? "BASE_PLATFORM_SIGNER_PRIVATE_KEY" : "BASE_AUTOMATION_PRIVATE_KEY");
    let record = await baseClient().readContract({ address: registry, abi: registryAbi, functionName: "getDAO", args: [job.daoId] }) as { dao: Address; admin: Address; treasury: Address };
    if (!record.dao || /^0x0+$/.test(record.dao)) {
      if (!job.txHash) {
        const executor = baseSigner("BASE_AUTOMATION_PRIVATE_KEY").account.address;
        const oracle = baseSigner("REVIEW_ORACLE_PRIVATE_KEY").account.address;
        const voteRelayer = baseSigner(process.env.BASE_VOTE_RELAYER_PRIVATE_KEY ? "BASE_VOTE_RELAYER_PRIVATE_KEY" : "BASE_AUTOMATION_PRIVATE_KEY").account.address;
        const weeklyLimit = parseUnits(String(payload.weeklyLimit || "0"), 6);
        const gate = payload.gate || {};
        const policy = { version: 0n, activatesAt: 0n, votingPeriod: 259200, maxProposalAmount: 1_000_000_000_000n, weeklySpendLimit: weeklyLimit, quorumBps: 2000, approvalBps: 5000, participationWeightCap: 10, tokenWeightCap: 10, gateToken: gate.asset || "0x0000000000000000000000000000000000000000", gateBalance: 1n, tokenWeightUnit: 0n, categories: String(payload.category || "general"), policyText: payload.constitution, active: false };
        const access = ["private", "whitelist"].includes(payload.access) ? 1 : ["token", "nft"].includes(payload.access) ? 2 : 0;
        job.txHash = await signer.writeContract({ address: registry, abi: registryAbi, functionName: "createConfiguredDAOFor", args: [job.admin, job.daoId, job.treasury, Number(payload.mode) === 1 ? 1 : 0, oracle, executor, payload.name, payload.metadataUri, policy, access, voteRelayer, weeklyLimit] });
        await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { txHash: job.txHash, status: "submitted", updatedAt: new Date() } });
      }
      await confirmed(job.txHash as Hex);
      record = await baseClient().readContract({ address: registry, abi: registryAbi, functionName: "getDAO", args: [job.daoId] }) as typeof record;
    }
    if (!record.dao || /^0x0+$/.test(record.dao) || record.admin.toLowerCase() !== job.admin.toLowerCase() || record.treasury.toLowerCase() !== job.treasury.toLowerCase()) throw new HttpError(409, "Registry identity does not match the creation request.");
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(String(payload.metadataUri)); } catch { metadata = {}; }
    const mediaIds: Record<string, string> = {};
    for (const [field, purpose, uri] of [["logoMediaId", "dao-logo", payload.logoUri || metadata.logoUri], ["bannerMediaId", "dao-banner", payload.bannerUri || metadata.bannerUri]] as const) {
      const mediaId = String(uri || "").match(/[?&]id=([a-f0-9]{24})$/i)?.[1];
      if (!mediaId) continue;
      const result = await db.collection("media.files").updateOne({ _id: new ObjectId(mediaId), "metadata.ownerIdentity": job.actor, "metadata.scope": "dao", "metadata.resourceId": { $in: [clientKey, job.daoId] }, "metadata.purpose": purpose }, { $set: { "metadata.resourceId": job.daoId } });
      if (result.matchedCount) mediaIds[field] = mediaId;
    }
    await db.collection("daoIndex").updateOne({ daoId: job.daoId }, { $setOnInsert: { daoId: job.daoId, dao: record.dao.toLowerCase(), admin: record.admin.toLowerCase(), adminIdentity: job.actor, treasury: record.treasury.toLowerCase(), name: payload.name, mode: Number(payload.mode) || 0, metadata: payload.metadataUri, description: payload.description, mission: payload.mission, constitution: payload.constitution, category: payload.category, access: payload.access || "public", gate: payload.gate, tags: metadata.tags || [], rules: metadata.rules || "", ...mediaIds, active: true, policySyncStatus: "pending", createdAt: new Date() } }, { upsert: true });
    await db.collection("daoMembers").updateOne({ daoId: job.daoId, actor: job.actor }, { $setOnInsert: { daoId: job.daoId, actor: job.actor, wallet: job.admin.toLowerCase(), role: "admin", status: "active", joinedAt: new Date() } }, { upsert: true });
    await db.collection("delegations").updateOne({ creationKey: clientKey, actor: job.actor }, { $set: { daoId: job.daoId, daoAddress: record.dao.toLowerCase(), status: "active" } });
    await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { daoAddress: record.dao.toLowerCase(), status: "syncing_policy", error: "", updatedAt: new Date() } });
    await syncDaoPolicy(job.daoId);
    const dao = await db.collection("daoIndex").findOne({ daoId: job.daoId });
    if (dao?.policySyncStatus === "ready") await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { status: "ready", indexed: true, error: "", updatedAt: new Date() } });
  } catch (error) {
    await db.collection("daoCreationJobs").updateOne({ clientKey }, { $set: { status: "needs_attention", error: safeError(error), updatedAt: new Date() } });
  } finally { await db.collection("daoCreationJobs").updateOne({ clientKey }, { $unset: { leaseUntil: "" } }); }
}
