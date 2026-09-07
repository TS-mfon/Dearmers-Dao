import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

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
  if (!identity) throw new Error("A valid Privy session is required.");
  return identity;
}
