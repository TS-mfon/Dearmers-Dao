/* eslint-disable @typescript-eslint/no-explicit-any */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chains, createClient } from "genlayer-js";
import { createPublicClient, createWalletClient, decodeEventLog, hashMessage, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { method, json, safeError } from "./_http.js";
import { database } from "./_db.js";

const statuses: Record<string, number> = { approve: 2, revision: 1, reject: 3, escalate: 6 };
const relayAbi = [
  { type: "function", name: "createProposalFor", inputs: [{ name: "proposer", type: "address" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "kind", type: "uint8" }, { name: "title", type: "string" }, { name: "description", type: "string" }, { name: "category", type: "string" }, { name: "evidenceUri", type: "string" }, { name: "evidenceHash", type: "bytes32" }], outputs: [{ name: "proposalId", type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "recordProposalReview", inputs: [{ name: "proposalId", type: "uint256" }, { name: "status", type: "uint8" }, { name: "verdictHash", type: "bytes32" }, { name: "eligibleWeightSnapshot", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "totalConfiguredWeight", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "registeredMembers", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "registerMemberFor", inputs: [{ name: "account", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "event", name: "ProposalCreated", inputs: [{ name: "proposalId", type: "uint256", indexed: true }, { name: "kind", type: "uint8", indexed: false }, { name: "proposer", type: "address", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    if (req.headers["x-internal-api-key"] !== process.env.INTERNAL_API_SECRET) return json(res, 401, { error: "Internal review relay access required." });
    const { daoId, daoAddress, proposalId, genlayerTxHash, evaluatorAddress } = req.body || {};
    if (![daoId, daoAddress, proposalId, genlayerTxHash, evaluatorAddress].every(Boolean)) return json(res, 400, { error: "Missing review relay fields." });
    const privateKey = process.env.REVIEW_ORACLE_PRIVATE_KEY as Hex | undefined;
    const baseRpc = process.env.BASE_RPC_URL;
    const genlayerRpc = process.env.GENLAYER_RPC_URL;
    if (!privateKey || !baseRpc || !genlayerRpc) throw new Error("Review relay environment is incomplete");
    const network = process.env.GENLAYER_NETWORK || "studionet";
    const chain = network === "testnet-bradbury" ? chains.testnetBradbury : network === "testnet-asimov" ? chains.testnetAsimov : chains.studionet;
    const genlayer = createClient({ chain, endpoint: genlayerRpc });
    const receipt = await genlayer.getTransaction({ hash: genlayerTxHash as never });
    const status = String((receipt as Record<string, unknown>).statusName || (receipt as Record<string, unknown>).status || "").toUpperCase();
    if (status !== "FINALIZED") return json(res, 409, { error: `GenLayer transaction is ${status || "not finalized"}.` });
    const raw = await genlayer.readContract({ address: evaluatorAddress as Address, functionName: "get_evaluation", args: [daoId, String(proposalId)], jsonSafeReturn: true });
    const evaluation = typeof raw === "string" ? JSON.parse(raw) : raw as Record<string, unknown>;
    if (evaluation.dao_id !== daoId || String(evaluation.proposal_id) !== String(proposalId)) return json(res, 422, { error: "Evaluation identity mismatch." });
    const baseStatus = statuses[String(evaluation.decision)];
    if (baseStatus === undefined) return json(res, 422, { error: "Unsupported GenLayer decision." });
    const account = privateKeyToAccount(privateKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(baseRpc) });
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(baseRpc) });
    const db = await database();
    const offchain = await db.collection("proposals").findOne({ _id: proposalId as never });
    if (!offchain) return json(res, 404, { error: "Offchain proposal was not found." });
    const proposer = String(offchain.wallet || "").toLowerCase() as Address;
    const recipient = String(offchain.recipient || proposer).toLowerCase() as Address;
    if (!proposer || !recipient) return json(res, 422, { error: "Proposal proposer and recipient wallets are required." });
    let onchainProposalId = offchain.onchainProposalId ? BigInt(String(offchain.onchainProposalId)) : null;
    if (onchainProposalId === null) {
      const registered = await (publicClient as any).readContract({ address: daoAddress as Address, abi: relayAbi, functionName: "registeredMembers", args: [proposer] }) as boolean;
      if (!registered) {
        const memberHash = await (wallet as any).writeContract({ address: daoAddress as Address, abi: relayAbi, functionName: "registerMemberFor", args: [proposer] });
        const memberReceipt = await publicClient.waitForTransactionReceipt({ hash: memberHash });
        if (memberReceipt.status !== "success") throw new Error("DAO membership relay failed.");
      }
      const createHash = await (wallet as any).writeContract({ address: daoAddress as Address, abi: relayAbi, functionName: "createProposalFor", args: [proposer, recipient, BigInt(String(offchain.amount || "0")), 0, String(offchain.title), String(offchain.description), String(offchain.category || "general"), String((offchain.evidence || [])[0] || ""), hashMessage(JSON.stringify(offchain.evidence || []))] });
      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      const created = createReceipt.logs.map((log) => { try { return decodeEventLog({ abi: relayAbi, data: log.data, topics: (log as unknown as { topics: [] | [Hex, ...Hex[]] }).topics }) as { eventName: string; args: Record<string, unknown> }; } catch { return null; } }).find((log) => log?.eventName === "ProposalCreated");
      if (!created?.args?.proposalId) throw new Error("Onchain proposal creation did not return an id.");
      onchainProposalId = BigInt(String(created.args.proposalId));
    }
    const verdictHash = hashMessage(JSON.stringify(evaluation));
    const eligibleWeight = await (publicClient as any).readContract({ address: daoAddress as Address, abi: relayAbi, functionName: "totalConfiguredWeight" }) as bigint;
    const hash = await (wallet as any).writeContract({ address: daoAddress as Address, abi: relayAbi, functionName: "recordProposalReview", args: [onchainProposalId, baseStatus, verdictHash, eligibleWeight] });
    const baseReceipt = await publicClient.waitForTransactionReceipt({ hash });
    if (baseReceipt.status !== "success") throw new Error("Base review relay reverted");
    const nextStatus = String(evaluation.decision) === "approve" ? "active_voting" : String(evaluation.decision) === "revision" ? "corrections_required" : String(evaluation.decision) === "reject" ? "rejected_by_genlayer" : "escalated";
    await db.collection("proposals").updateOne({ _id: proposalId as never }, { $set: { status: nextStatus, daoAddress: String(daoAddress).toLowerCase(), onchainProposalId: String(onchainProposalId), evaluation, genlayerTxHash, reviewTxHash: hash, votingEndsAt: nextStatus === "active_voting" ? new Date(Date.now() + 72 * 60 * 60 * 1000) : null, updatedAt: new Date() } });
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: `genlayer_${nextStatus}`, proposalId: String(proposalId), createdAt: new Date() });
    json(res, 200, { ok: true, decision: evaluation.decision, score: evaluation.score, baseTransactionHash: hash });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
