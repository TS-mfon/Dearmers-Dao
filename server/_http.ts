import type { VercelRequest, VercelResponse } from "@vercel/node";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function errorResponse(res: VercelResponse, error: unknown) {
  return json(res, error instanceof HttpError ? error.status : 500, { error: safeError(error) });
}

export function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).setHeader("content-type", "application/json").send(JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

export function method(req: VercelRequest, res: VercelResponse, allowed: string[]) {
  if (!req.method || !allowed.includes(req.method)) {
    json(res, 405, { error: `Use ${allowed.join(" or ")}.` });
    return false;
  }
  return true;
}

/** Makes user input inert inside a Mongo `$regex`. Unescaped input is both a 500 and a ReDoS. */
export function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** The bounded, trimmed form of a public search box value. */
export const searchTerm = (value: unknown, maxLength = 80) => String(value ?? "").trim().slice(0, maxLength);

/**
 * The only way a handler should turn a query string into a Mongo matcher. Returns null for an
 * empty term so callers branch instead of matching everything. Never build `new RegExp` from
 * request input directly — `?q=(` used to return 500 from /api/daos and /api/social.
 */
export function searchPattern(value: unknown, maxLength = 80) {
  const term = searchTerm(value, maxLength);
  return term ? new RegExp(escapeRegex(term), "i") : null;
}

export function safeError(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = source.cause && typeof source.cause === "object" ? source.cause as Record<string, unknown> : {};
  const data = cause.data && typeof cause.data === "object" ? cause.data as Record<string, unknown> : {};
  const receipt = data.receipt && typeof data.receipt === "object" ? data.receipt as Record<string, unknown> : {};
  const genvm = receipt.genvm_result && typeof receipt.genvm_result === "object" ? receipt.genvm_result as Record<string, unknown> : {};
  const stderr = typeof genvm.stderr === "string" ? genvm.stderr.trim().split("\n").filter(Boolean).at(-1) : "";
  const baseMessage = error instanceof Error ? error.message : "Unexpected server error";
  const message = stderr && !baseMessage.includes(stderr) ? `${baseMessage} Details: ${stderr}` : baseMessage;
  return message.replace(/0x[a-fA-F0-9]{64}/g, "[redacted]").slice(0, 300);
}

/**
 * Plain-language counterpart to safeError, for anything a member can see.
 * safeError keeps the raw diagnostic for the admin panel; this never leaks
 * viem wrappers, GenVM stderr, or Python exception names into the product UI.
 */
export function userMessage(error: unknown) {
  if (error instanceof HttpError) return error.message;
  const raw = safeError(error).toLowerCase();
  if (["server busy", "execution slots", "retry later", "rate limit", "too many requests", "429"].some((signal) => raw.includes(signal)))
    return "GenLayer validators are at capacity right now. This review will retry automatically.";
  if (["timeout", "timed out", "etimedout", "econnreset", "socket hang up", "fetch failed", "502", "503", "504"].some((signal) => raw.includes(signal)))
    return "GenLayer was temporarily unreachable. This review will retry automatically.";
  if (raw.includes("keyerror") || raw.includes("execution failed"))
    return "GenLayer finalized this review but its stored verdict could not be read. Retry the review to run a fresh evaluation.";
  if (raw.includes("not configured") || raw.includes("domain is not verified"))
    return "A platform service is not fully configured yet. The team has been notified.";
  return "This review could not be completed. Retry, or contact the DAO stewards if it keeps failing.";
}

/**
 * The DAO-creation counterpart to userMessage. Creation failures come from Base and the platform
 * relayer, not GenLayer, so userMessage's wording would misattribute them. _dao-creation.ts stored
 * only `error`, which the status page rendered as its lede — raw viem text in the product UI.
 */
export function creationMessage(error: unknown) {
  if (error instanceof HttpError) return error.message;
  const raw = safeError(error).toLowerCase();
  if (["insufficient funds", "insufficient balance", "exceeds the balance", "gas required"].some((signal) => raw.includes(signal)))
    return "The platform relayer could not fund this transaction. The team has been notified.";
  if (["timeout", "timed out", "etimedout", "econnreset", "socket hang up", "fetch failed", "nonce", "replacement", "502", "503", "504"].some((signal) => raw.includes(signal)))
    return "Base was temporarily unreachable while creating this DAO. Retry — your progress is saved.";
  if (raw.includes("not configured"))
    return "A platform service is not fully configured yet. The team has been notified.";
  return "DAO creation could not be completed. Retry, or contact the team if it keeps failing.";
}
