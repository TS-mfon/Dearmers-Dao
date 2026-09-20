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
