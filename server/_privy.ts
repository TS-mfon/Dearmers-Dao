import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { HttpError } from "./_http.js";

const jwksUrl = process.env.PRIVY_JWKS_ENDPOINT;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export type PrivyIdentity = JWTPayload & { sub: string; email?: string; wallet?: string };

export async function verifyPrivyToken(token: string): Promise<PrivyIdentity> {
  if (!jwksUrl) throw new Error("PRIVY_JWKS_ENDPOINT is not configured.");
  jwks ||= createRemoteJWKSet(new URL(jwksUrl));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: "privy.io",
    audience: process.env.PRIVY_APP_ID,
  });
  if (!payload.sub) throw new Error("Privy token has no user subject.");
  return payload as PrivyIdentity;
}

export async function bearerIdentity(value: unknown): Promise<PrivyIdentity | null> {
  const header = String(value || "");
  if (!header.startsWith("Bearer ")) return null;
  return verifyPrivyToken(header.slice(7));
}

export async function requirePrivyIdentity(value: unknown): Promise<PrivyIdentity> {
  const identity = await bearerIdentity(value);
  if (!identity) throw new HttpError(401, "Sign in to continue.");
  return identity;
}

export async function verifiedWallet(identity: PrivyIdentity, requested = ""): Promise<string> {
  const appId = process.env.PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) throw new HttpError(503, "Wallet identity verification is not configured.");
  const response = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(identity.sub)}`, { headers: { authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`, "privy-app-id": appId }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new HttpError(503, "Could not verify linked wallet ownership. Try again.");
  const user = await response.json() as { linked_accounts?: Array<{ type: string; chain_type?: string; address?: string }> };
  const wallets = (user.linked_accounts || []).filter((account) => account.type === "wallet" && account.chain_type === "ethereum" && account.address).map((account) => String(account.address).toLowerCase());
  const wallet = requested ? requested.toLowerCase() : wallets[0];
  if (!wallet || !wallets.includes(wallet)) throw new HttpError(403, "Link this wallet to your signed-in account before continuing.");
  return wallet;
}
