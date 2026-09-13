import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { HttpError } from "./_http.js";

const cookieName = "dreamers_admin";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const adminWallets = () => new Set((process.env.ADMIN_WALLETS || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean));

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hash || "") || password.length > 256) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, "hex"));
}

export function requireSameOrigin(req: VercelRequest) {
  const origin = String(req.headers.origin || "");
  const host = String(req.headers.host || "");
  const expected = process.env.APP_ORIGIN || `${host.startsWith("localhost:") ? "http" : "https"}://${host}`;
  if (!origin || origin !== expected) throw new HttpError(403, "This request must originate from the application.");
}

export async function throttle(req: VercelRequest, purpose: string, limit = 10) {
  const db = await database();
  const ip = String(req.headers["x-vercel-forwarded-for"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0];
  const window = Math.floor(Date.now() / 900_000);
  const key = digest(`${purpose}:${ip}:${window}`);
  const record = await db.collection("authRateLimits").findOneAndUpdate({ key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 1_800_000) } }, { upsert: true, returnDocument: "after" });
  if (Number(record?.count) > limit) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
}

export async function issueAdminSession(res: VercelResponse, authMethod: "wallet" | "password", wallet = "") {
  const db = await database();
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const actor = wallet || "protocol:password";
  await db.collection("adminSessions").insertOne({ tokenHash: digest(token), csrf, actor, wallet, authMethod, expiresAt, createdAt: new Date() });
  res.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=28800${process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : ""}`);
  await db.collection("auditLogs").insertOne({ scopeId: "protocol", type: "admin_login", actor, authMethod, createdAt: new Date() });
  return { actor, wallet, authMethod, csrf, expiresAt };
}

export async function requireAdminSession(req: VercelRequest) {
  const token = String(req.headers.cookie || "").split(";").map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "Sign in to protocol administration.");
  const db = await database();
  const session = await db.collection("adminSessions").findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date() } });
  if (!session || (session.authMethod === "wallet" && !adminWallets().has(session.wallet))) throw new HttpError(401, "Your admin session expired. Sign in again.");
  if (req.method !== "GET") {
    requireSameOrigin(req);
    if (req.headers["x-admin-csrf"] !== session.csrf) throw new HttpError(403, "Invalid admin request token.");
  }
  return session;
}

export async function revokeAdminSession(req: VercelRequest, res: VercelResponse) {
  const session = await requireAdminSession(req);
  await (await database()).collection("adminSessions").deleteOne({ _id: session._id });
  res.setHeader("Set-Cookie", `${cookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : ""}`);
}
