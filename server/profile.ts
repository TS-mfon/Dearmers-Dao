import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, HttpError, method, json, safeError } from "./_http.js";
import { requirePrivyIdentity, verifiedEmbeddedWallet } from "./_privy.js";

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
    const { email, github, username, displayName, bio, website, avatarUrl, bannerUrl, location, timezone, profileVisibility, emailNotifications, identity } = req.body || {};
    const privy = await requirePrivyIdentity(req.headers.authorization);
    const profileIdentity = `privy:${privy.sub}`;
    if (identity && String(identity) !== profileIdentity) return json(res, 403, { error: "You can only update your own profile." });
    const normalizedWallet = await verifiedEmbeddedWallet(privy);
    const update: Record<string, unknown> = { wallet: normalizedWallet, identity: profileIdentity, ...(privy.email || email ? { email: String(privy.email || email).slice(0, 180) } : {}), github: String(github || "").replace(/^@/, "").slice(0, 80), username: String(username || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32), displayName: String(displayName || "").slice(0, 80), bio: String(bio || "").slice(0, 500), website: String(website || "").slice(0, 240), avatarUrl: String(avatarUrl || "").slice(0, 500), bannerUrl: String(bannerUrl || "").slice(0, 500), location: String(location || "").slice(0, 100), timezone: String(timezone || "").slice(0, 80), profileVisibility: profileVisibility === "private" ? "private" : "public", emailNotifications: emailNotifications !== false, updatedAt: new Date() };
    if (github) {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(String(github).replace(/^@/, ""))}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Dearmers-Dao" } });
      if (response.ok) { const profile = await response.json() as Record<string, unknown>; update.githubProfile = profile; update.reputationScore = Math.min(100, Number(profile.public_repos || 0) * 3 + Number(profile.followers || 0) + (profile.bio ? 10 : 0) + (profile.blog ? 10 : 0)); }
    }
    const existingByIdentity = await db.collection("profiles").findOne({ identity: profileIdentity }, { projection: { _id: 1 } });
    const existingByWallet = await db.collection("profiles").findOne({ wallet: normalizedWallet }, { projection: { _id: 1, identity: 1 } });
    if (existingByWallet?.identity && String(existingByWallet.identity) !== profileIdentity) throw new HttpError(409, "This wallet is already linked to another profile.");
    const filter = existingByIdentity ? { _id: existingByIdentity._id } : existingByWallet ? { _id: existingByWallet._id } : { identity: profileIdentity };
    await db.collection("profiles").updateOne(filter, { $set: update }, { upsert: true });
    return json(res, 200, { ok: true, profile: await db.collection("profiles").findOne(filter, { projection: { _id: 0, email: 0 } }) });
  } catch (error) {
    if (req.method === "POST" && (!(error instanceof HttpError) || error.status >= 500)) console.error("Profile update failed:", safeError(error));
    return errorResponse(res, error);
  }
}
