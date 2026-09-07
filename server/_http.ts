import type { VercelRequest, VercelResponse } from "@vercel/node";

export function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).setHeader("content-type", "application/json").send(JSON.stringify(body));
}

export function method(req: VercelRequest, res: VercelResponse, allowed: string[]) {
  if (!req.method || !allowed.includes(req.method)) {
    json(res, 405, { error: `Use ${allowed.join(" or ")}.` });
    return false;
  }
  return true;
}

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return message.replace(/0x[a-fA-F0-9]{64}/g, "[redacted]").slice(0, 300);
}
