import { chains, createAccount, createClient } from "genlayer-js";
import { TransactionHashVariant } from "genlayer-js/types";
import type { Evaluation } from "../shared/proposals.js";
import { HttpError } from "./_http.js";

export function genlayerClient(signer = false) {
  const endpoint = process.env.GENLAYER_RPC_URL;
  const key = process.env.GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY;
  if (!endpoint || (signer && !key)) throw new HttpError(503, "GenLayer RPC or platform signer is not configured.");
  const network = process.env.GENLAYER_NETWORK || "studio-dev";
  const chain = network === "studio-dev" ? chains.studioDevnet : network === "testnet-bradbury" ? chains.testnetBradbury : network === "testnet-asimov" ? chains.testnetAsimov : chains.studionet;
  return createClient({ endpoint, chain, ...(signer ? { account: createAccount(key as `0x${string}`) } : {}) });
}

export function evaluatorAddress() {
  const address = process.env.GENLAYER_V2_EVALUATOR_ADDRESS;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) throw new HttpError(503, "The GenLayer v2 evaluator is not configured.");
  return address as `0x${string}`;
}

export function transactionState(transaction: Record<string, unknown>) {
  const status = String(transaction.statusName || transaction.status || "PENDING").replaceAll("_", "").toUpperCase();
  const execution = String(transaction.txExecutionResultName ?? transaction.txExecutionResult ?? transaction.execution_result ?? "").toUpperCase();
  const finalized = status === "FINALIZED";
  const successful = ["FINISHED_WITH_RETURN", "SUCCESS", "1"].includes(execution);
  const failed = ["CANCELED", "CANCELLED"].includes(status) || (finalized && execution !== "" && !successful);
  return { status, finalized, successful, failed };
}

export function normalizeEvaluation(raw: unknown, daoId: string, proposalId: string): Evaluation {
  const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  if (!value || String(value.scope_id ?? value.dao_id) !== daoId || String(value.subject_id ?? value.proposal_id) !== proposalId || !["proposal", "DAO proposal"].includes(String(value.subject_type))) throw new HttpError(422, "GenLayer evaluation identity mismatch.");
  if (!["approve", "reject", "revision", "escalate"].includes(String(value.decision))) throw new HttpError(422, "Unsupported GenLayer decision.");
  return { ...value, decision: String(value.decision), subject_type: "proposal" } as Evaluation;
}

export async function finalizedEvaluation(daoId: string, proposalId: string, address: `0x${string}`) {
  const raw = await genlayerClient().readContract({ address, functionName: "get_evaluation", args: [daoId, proposalId], jsonSafeReturn: true, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
  return normalizeEvaluation(raw, daoId, proposalId);
}
