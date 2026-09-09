import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";
import { bearerIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const wallet = String(req.query.wallet || "").toLowerCase();
      const identity = String(req.query.identity || "");
      if (!wallet && !identity) return json(res, 400, { error: "Wallet or identity is required." });
      const profile = await db.collection("profiles").findOne(wallet ? { wallet } : { identity }, { projection: { _id: 0, email: 0 } });
      return json(res, 200, { profile: profile || (wallet ? { wallet } : { identity }) });
    }
    const { wallet, signature, email, github, username, displayName, bio, website, avatarUrl, bannerUrl, location, timezone, profileVisibility, emailNotifications, identity } = req.body || {};
    const privy = await bearerIdentity(req.headers.authorization).catch(() => null);
    const walletAuthorized = wallet && signature ? await verifyWallet("save-profile", wallet as Address, String(github || username || wallet), signature as Hex).catch(() => false) : false;
    if (!walletAuthorized && !privy) return json(res, 401, { error: "Valid wallet signature or Privy session required." });
    const normalizedWallet = wallet ? String(wallet).toLowerCase() : "";
    const sessionIdentity = privy ? `privy:${privy.sub}` : "";
    if (privy && identity && String(identity) !== sessionIdentity) return json(res, 403, { error: "You can only update your own profile." });
    const profileIdentity = sessionIdentity || String(identity || "");
    if (privy && normalizedWallet && !walletAuthorized && String(privy.wallet || "").toLowerCase() !== normalizedWallet) return json(res, 403, { error: "Verify the wallet before attaching it to this profile." });
    const update: Record<string, unknown> = { ...(normalizedWallet ? { wallet: normalizedWallet } : {}), ...(profileIdentity ? { identity: profileIdentity } : {}), ...(email ? { email: String(email).slice(0, 180) } : {}), github: String(github || "").replace(/^@/, "").slice(0, 80), username: String(username || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32), displayName: String(displayName || "").slice(0, 80), bio: String(bio || "").slice(0, 500), website: String(website || "").slice(0, 240), avatarUrl: String(avatarUrl || "").slice(0, 500), bannerUrl: String(bannerUrl || "").slice(0, 500), location: String(location || "").slice(0, 100), timezone: String(timezone || "").slice(0, 80), profileVisibility: profileVisibility === "private" ? "private" : "public", emailNotifications: emailNotifications !== false, updatedAt: new Date() };
    if (github) {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(String(github).replace(/^@/, ""))}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Dearmers-Dao" } });
      if (response.ok) { const profile = await response.json() as Record<string, unknown>; update.githubProfile = profile; update.reputationScore = Math.min(100, Number(profile.public_repos || 0) * 3 + Number(profile.followers || 0) + (profile.bio ? 10 : 0) + (profile.blog ? 10 : 0)); }
    }
    const filter = normalizedWallet ? { wallet: normalizedWallet } : { identity: profileIdentity };
    await db.collection("profiles").updateOne(filter, { $set: update }, { upsert: true });
    return json(res, 200, { ok: true, profile: await db.collection("profiles").findOne(filter, { projection: { _id: 0, email: 0 } }) });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
