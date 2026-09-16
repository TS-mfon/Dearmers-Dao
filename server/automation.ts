import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { reconcileApplication } from "./_automation.js";
import { errorResponse, HttpError, json, method } from "./_http.js";

function authorized(req: VercelRequest) {
  const expected = process.env.INTERNAL_API_SECRET || "";
  const supplied = String(req.headers["x-internal-api-key"] || "");
  if (!expected || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    if (!authorized(req)) throw new HttpError(401, "Internal access required.");
    const result = await reconcileApplication(100);
    return json(res, result.errors.length ? 207 : 200, { ...result, timestamp: new Date().toISOString() });
  } catch (error) { return errorResponse(res, error); }
}
