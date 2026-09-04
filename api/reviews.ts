import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chains, createClient } from "genlayer-js";
import { createPublicClient, createWalletClient, hashMessage, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import daoAbi from "../src/abi/DearmersDAO.json" with { type: "json" };
import { method, json, safeError } from "./_http.js";

const statuses: Record<string, number> = { approve: 2, revision: 1, reject: 3, escalate: 6 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
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
    const verdictHash = hashMessage(JSON.stringify(evaluation));
    const eligibleWeight = await (publicClient as any).readContract({ address: daoAddress as Address, abi: daoAbi, functionName: "totalConfiguredWeight" }) as bigint;
    const hash = await (wallet as any).writeContract({ address: daoAddress as Address, abi: daoAbi, functionName: "recordProposalReview", args: [BigInt(proposalId), baseStatus, verdictHash, eligibleWeight] });
    const baseReceipt = await publicClient.waitForTransactionReceipt({ hash });
    if (baseReceipt.status !== "success") throw new Error("Base review relay reverted");
    json(res, 200, { ok: true, decision: evaluation.decision, score: evaluation.score, baseTransactionHash: hash });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
