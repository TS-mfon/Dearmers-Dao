import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { wallet, signature, email, github } = req.body || {};
    if (!wallet || !signature || !email || !github) return json(res, 400, { error: "Wallet, signature, email, and GitHub login are required." });
    if (!await verifyWallet("save-profile", wallet as Address, github, signature as Hex)) return json(res, 401, { error: "Invalid wallet signature." });
    const headers: Record<string,string> = { accept: "application/vnd.github+json", "user-agent": "Dearmers-Dao" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(github)}`, { headers });
    if (!response.ok) return json(res, 422, { error: `GitHub profile lookup failed with HTTP ${response.status}.` });
    const profile = await response.json() as Record<string, unknown>;
    const score = Math.min(100, Number(profile.public_repos || 0) * 3 + Number(profile.followers || 0) + (profile.bio ? 10 : 0) + (profile.blog ? 10 : 0));
    const db = await database();
    await db.collection("profiles").updateOne({ wallet: String(wallet).toLowerCase() }, { $set: { wallet: String(wallet).toLowerCase(), email, github, githubProfile: profile, reputationScore: score, reviewedAt: new Date() } }, { upsert: true });
    json(res, 200, { ok: true, reputationScore: score, profile: { login: profile.login, avatar_url: profile.avatar_url, public_repos: profile.public_repos, followers: profile.followers } });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
