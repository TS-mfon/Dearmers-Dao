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
