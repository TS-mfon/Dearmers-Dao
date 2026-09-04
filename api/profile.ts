import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const wallet = String(req.query.wallet || "").toLowerCase();
      if (!wallet) return json(res, 400, { error: "Wallet is required." });
      const profile = await db.collection("profiles").findOne({ wallet }, { projection: { _id: 0, email: 0 } });
      return json(res, 200, { profile: profile || { wallet } });
    }
    const { wallet, signature, email, github, username, displayName, bio, website, avatarUrl } = req.body || {};
    if (!wallet || !signature || !await verifyWallet("save-profile", wallet as Address, String(github || username || wallet), signature as Hex)) return json(res, 401, { error: "Valid wallet signature required." });
    const normalizedWallet = String(wallet).toLowerCase();
    const update: Record<string, unknown> = { wallet: normalizedWallet, ...(email ? { email: String(email).slice(0, 180) } : {}), ...(github ? { github: String(github).replace(/^@/, "").slice(0, 80) } : {}), ...(username ? { username: String(username).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) } : {}), ...(displayName ? { displayName: String(displayName).slice(0, 80) } : {}), ...(bio ? { bio: String(bio).slice(0, 500) } : {}), ...(website ? { website: String(website).slice(0, 240) } : {}), ...(avatarUrl ? { avatarUrl: String(avatarUrl).slice(0, 500) } : {}), updatedAt: new Date() };
    if (github) {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(String(github).replace(/^@/, ""))}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Dearmers-Dao" } });
      if (response.ok) { const profile = await response.json() as Record<string, unknown>; update.githubProfile = profile; update.reputationScore = Math.min(100, Number(profile.public_repos || 0) * 3 + Number(profile.followers || 0) + (profile.bio ? 10 : 0) + (profile.blog ? 10 : 0)); }
    }
    await db.collection("profiles").updateOne({ wallet: normalizedWallet }, { $set: update }, { upsert: true });
    return json(res, 200, { ok: true, profile: await db.collection("profiles").findOne({ wallet: normalizedWallet }, { projection: { _id: 0, email: 0 } }) });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
