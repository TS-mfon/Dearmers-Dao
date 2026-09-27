import { chains, createAccount, createClient } from "genlayer-js";
import { TransactionHashVariant } from "genlayer-js/types";
import type { Evaluation } from "../shared/proposals.js";
import { HttpError } from "./_http.js";
import { privateKeyFromEnv } from "./_signers.js";

export function genlayerClient(signer = false) {
  const endpoint = process.env.GENLAYER_RPC_URL;
  if (!endpoint) throw new HttpError(503, "GenLayer RPC is not configured.");
  const network = process.env.GENLAYER_NETWORK || "studio-dev";
  const chain = network === "studio-dev" ? chains.studioDevnet : network === "testnet-bradbury" ? chains.testnetBradbury : network === "testnet-asimov" ? chains.testnetAsimov : chains.studionet;
  return createClient({ endpoint, chain, ...(signer ? { account: createAccount(privateKeyFromEnv("GENLAYER_PLATFORM_SIGNER_PRIVATE_KEY")) } : {}) });
}

export function evaluatorAddress() {
  const address = process.env.GENLAYER_V2_EVALUATOR_ADDRESS;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) throw new HttpError(503, "The GenLayer v2 evaluator is not configured.");
  return address as `0x${string}`;
}

function errorText(error: unknown) {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    const source = current as Record<string, unknown>;
    for (const key of ["message", "shortMessage", "details", "reason", "code"]) if (source[key] !== undefined) parts.push(String(source[key]));
    current = source.cause;
  }
  if (!parts.length && error !== undefined) parts.push(String(error));
  return parts.join(" | ").toLowerCase();
}

const transientSignals = ["server busy", "execution slots", "retry later", "rate limit", "too many requests", "429", "502", "503", "504", "timeout", "timed out", "etimedout", "econnreset", "econnrefused", "socket hang up", "fetch failed", "version of json-rpc protocol is not supported"];

export function isTransientRpcError(error: unknown) {
  const text = errorText(error);
  return transientSignals.some((signal) => text.includes(signal));
}

/** Errors that prove the node never queued the transaction, so no submission exists to recover. */
const rejectedSignals = ["server busy", "execution slots", "retry later", "rate limit", "too many requests", "429", "503"];

export function isRejectedBeforeBroadcast(error: unknown) {
  const text = errorText(error);
  if (/0x[a-f0-9]{64}/.test(text)) return false;
  return rejectedSignals.some((signal) => text.includes(signal));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries idempotent GenLayer reads through transient RPC pressure. Never wrap writeContract with this. */
export async function withGenlayerRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts || !isTransientRpcError(error)) throw error;
      await wait(attempt * 500 + Math.floor(Math.random() * 250));
    }
  }
}

/**
 * Recovers the leader validator's returned evaluation from a decoded studio transaction.
 * `evaluate_proposal` and `evaluate_grant` both return the evaluation dict, and studio chains
 * decode `leader_receipt[i].result` into `{ raw, status, payload }` — so the verdict is already
 * in the receipt and needs no contract read.
 */
export function receiptEvaluation(transaction: Record<string, unknown>): unknown {
  const consensus = transaction.consensus_data && typeof transaction.consensus_data === "object" ? transaction.consensus_data as Record<string, unknown> : {};
  const receipts = Array.isArray(consensus.leader_receipt) ? consensus.leader_receipt : [];
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== "object") continue;
    const result = (receipt as Record<string, unknown>).result;
    if (!result || typeof result !== "object") continue;
    const decoded = result as Record<string, unknown>;
    if (String(decoded.status) !== "return" || decoded.payload === undefined || decoded.payload === null) continue;
    return decoded.payload;
  }
  return null;
}

export function transactionState(transaction: Record<string, unknown>) {
  const status = String(transaction.statusName || transaction.status || "PENDING").replaceAll("_", "").toUpperCase();
  const execution = String(transaction.txExecutionResultName ?? transaction.txExecutionResult ?? transaction.execution_result ?? "").toUpperCase();
  const finalized = status === "FINALIZED";
  const disputed = status.includes("UNDETERMINED") || status.includes("APPEAL") || status.includes("DISPUTE");
  const successful = ["FINISHED_WITH_RETURN", "SUCCESS", "1"].includes(execution);
  const canceled = ["CANCELED", "CANCELLED"].includes(status);
  const executionFailed = finalized && execution !== "" && !successful;
  return { status, execution, finalized, successful, failed: canceled || executionFailed, canceled, executionFailed, disputed };
}

export function normalizeEvaluation(raw: unknown, daoId: string, proposalId: string): Evaluation {
  const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  if (!value || String(value.scope_id ?? value.dao_id) !== daoId || String(value.subject_id ?? value.proposal_id) !== proposalId || !["proposal", "DAO proposal"].includes(String(value.subject_type))) throw new HttpError(422, "GenLayer evaluation identity mismatch.");
  if (!["approve", "reject", "revision", "escalate"].includes(String(value.decision))) throw new HttpError(422, "Unsupported GenLayer decision.");
  if (value.outcome && !["approved", "rejected", "corrections_required", "further_review"].includes(String(value.outcome))) throw new HttpError(422, "Unsupported GenLayer outcome.");
  return { ...value, decision: String(value.decision), subject_type: "proposal" } as Evaluation;
}

export async function finalizedEvaluation(daoId: string, proposalId: string, address: `0x${string}`) {
  const raw = await withGenlayerRetry(() => genlayerClient().readContract({ address, functionName: "get_evaluation", args: [daoId, proposalId], jsonSafeReturn: true, transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
  return normalizeEvaluation(raw, daoId, proposalId);
}

export function normalizeGrantEvaluation(raw: unknown, grantId: string, applicationId: string): Evaluation {
  const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  if (!value || String(value.scope_id) !== grantId || String(value.subject_id) !== applicationId || String(value.subject_type) !== "grant") throw new HttpError(422, "GenLayer grant evaluation identity mismatch.");
  if (!["fund", "do_not_fund", "revise", "escalate"].includes(String(value.decision))) throw new HttpError(422, "Unsupported GenLayer grant decision.");
  if (!['funded', 'rejected', 'corrections_required', 'further_review'].includes(String(value.outcome))) throw new HttpError(422, "Unsupported GenLayer grant outcome.");
  return { ...value, decision: String(value.decision), subject_type: "grant" } as Evaluation;
}

export async function finalizedGrantEvaluation(grantId: string, applicationId: string, address: `0x${string}`) {
  const raw = await withGenlayerRetry(() => genlayerClient().readContract({ address, functionName: "get_grant_evaluation", args: [grantId, applicationId], jsonSafeReturn: true, transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
  return normalizeGrantEvaluation(raw, grantId, applicationId);
}

/** Parses an evaluation without throwing: advisory verdicts and receipt payloads must degrade to null, not error. */
export function tryNormalizeEvaluation(raw: unknown, scopeId: string, subjectId: string, kind: "proposal" | "grant"): Evaluation | null {
  if (raw === null || raw === undefined) return null;
  try { return kind === "proposal" ? normalizeEvaluation(raw, scopeId, subjectId) : normalizeGrantEvaluation(raw, scopeId, subjectId); }
  catch { return null; }
}
