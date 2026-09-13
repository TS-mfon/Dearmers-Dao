import { randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, isAddress, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { database } from "./_db.js";
import { adminWallets, digest, issueAdminSession, requireAdminSession, requireSameOrigin, revokeAdminSession, throttle, verifyPassword } from "./_admin-session.js";
import { HttpError, errorResponse, json, method } from "./_http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      try {
        const session = await requireAdminSession(req);
        return json(res, 200, { session: { actor: session.actor, wallet: session.wallet, authMethod: session.authMethod, csrf: session.csrf, expiresAt: session.expiresAt } });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) return json(res, 200, { session: null, passwordEnabled: Boolean(process.env.ADMIN_PASSWORD_HASH) });
        throw error;
      }
    }
    requireSameOrigin(req);
    const body = req.body || {};
    if (body.action === "logout") {
      await revokeAdminSession(req, res);
      return json(res, 200, { ok: true });
    }
    await throttle(req, "admin-login", 10);
    const db = await database();
    if (body.action === "password") {
      if (!process.env.ADMIN_PASSWORD_HASH) throw new HttpError(503, "Password login is not configured on this deployment.");
      if (!verifyPassword(String(body.password || ""), process.env.ADMIN_PASSWORD_HASH)) throw new HttpError(401, "Invalid admin credentials.");
      return json(res, 200, { session: await issueAdminSession(res, "password") });
    }
    const wallet = String(body.wallet || "").toLowerCase();
    if (!isAddress(wallet) || !adminWallets().has(wallet)) throw new HttpError(403, "This wallet is not an allowlisted protocol administrator.");
    if (body.action === "challenge") {
      const nonce = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 300_000);
      const message = `Dreamers DAO protocol administration\nDomain: ${req.headers.origin}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${expiresAt.toISOString()}`;
      await db.collection("adminChallenges").insertOne({ key: digest(nonce), wallet, message, expiresAt });
      return json(res, 200, { nonce, message });
    }
    if (body.action !== "wallet") throw new HttpError(400, "Unsupported login action.");
    const challenge = await db.collection("adminChallenges").findOneAndDelete({ key: digest(String(body.nonce || "")), wallet, expiresAt: { $gt: new Date() } });
    if (!challenge) throw new HttpError(401, "The wallet challenge expired or was already used.");
    const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_RPC_URL || "https://sepolia.base.org") });
    const valid = await client.verifyMessage({ address: wallet as Address, message: challenge.message, signature: String(body.signature || "") as Hex }).catch(() => false);
    if (!valid) throw new HttpError(401, "Wallet signature verification failed.");
    return json(res, 200, { session: await issueAdminSession(res, "wallet", wallet) });
  } catch (error) { return errorResponse(res, error); }
}
