import type { VercelRequest, VercelResponse } from "@vercel/node";
import { database } from "./_db.js";
import { errorResponse, HttpError, method, json, safeError } from "./_http.js";
import { bearerIdentity, requirePrivyIdentity, verifiedEmbeddedWallet } from "./_privy.js";
import { publicProfile } from "./_profiles.js";
import { handleProblem, normalizeHandle, sanitizeUsername, PROFILE_LIMITS } from "../shared/profile.js";

const capped = (value: unknown, field: keyof typeof PROFILE_LIMITS) => String(value ?? "").slice(0, PROFILE_LIMITS[field]);


export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const wallet = String(req.query.wallet || "").toLowerCase();
      const identity = String(req.query.identity || "");
      const handle = normalizeHandle(req.query.handle);
      if (!wallet && !identity && !handle) return json(res, 400, { error: "A handle, wallet, or identity is required." });
      // A retired handle still resolves, so a bookmarked or shared profile link never 404s.
      const filter = handle ? { $or: [{ handle }, { "usernameHistory.from": handle }] } : wallet ? { wallet } : { identity };
      const found = await db.collection("profiles").findOne(filter);
      const viewer = await bearerIdentity(req.headers.authorization).catch(() => null);
      const isSelf = Boolean(viewer && found && String(found.identity || "") === `privy:${viewer.sub}`);
      if (!found) return json(res, 200, { profile: handle ? {} : wallet ? { wallet } : { identity }, isSelf: false, found: false });
      return json(res, 200, { profile: publicProfile(found, isSelf), isSelf, found: true });
    }
    const { email, github, username, displayName, bio, website, avatarUrl, bannerUrl, location, timezone, profileVisibility, emailNotifications, identity } = req.body || {};
    const privy = await requirePrivyIdentity(req.headers.authorization);
    const profileIdentity = `privy:${privy.sub}`;
    if (identity && String(identity) !== profileIdentity) return json(res, 403, { error: "You can only update your own profile." });
    // Validate the handle before the Privy wallet round trip, so a bad username fails cheaply.
    const requestedUsername = sanitizeUsername(username);
    if (requestedUsername) {
      const problem = handleProblem(requestedUsername);
      if (problem) throw new HttpError(400, problem);
    }
    const normalizedWallet = await verifiedEmbeddedWallet(privy);
    const existingByIdentity = await db.collection("profiles").findOne({ identity: profileIdentity }, { projection: { _id: 1, handle: 1, username: 1, usernameHistory: 1 } });
    const existingByWallet = await db.collection("profiles").findOne({ wallet: normalizedWallet }, { projection: { _id: 1, identity: 1 } });
    if (existingByWallet?.identity && String(existingByWallet.identity) !== profileIdentity) throw new HttpError(409, "This wallet is already linked to another profile.");

    // The handle is the public route key, so it has to be unique and it has to stay resolvable.
    const previousHandle = String(existingByIdentity?.handle || "");
    let handle = previousHandle;
    if (requestedUsername) {
      handle = normalizeHandle(requestedUsername);
      if (handle !== previousHandle && await db.collection("profiles").findOne({ handle }, { projection: { _id: 1 } })) throw new HttpError(409, "That username is already taken. Choose another.");
    }
    if (!handle) throw new HttpError(400, "Choose a username so people can find your profile.");

    const update: Record<string, unknown> = {
      wallet: normalizedWallet,
      identity: profileIdentity,
      handle,
      ...(privy.email || email ? { email: capped(privy.email || email, "email") } : {}),
      github: capped(String(github || "").replace(/^@/, ""), "github"),
      username: requestedUsername || String(existingByIdentity?.username || handle),
      displayName: capped(displayName, "displayName"),
      bio: capped(bio, "bio"),
      website: capped(website, "website"),
      avatarUrl: capped(avatarUrl, "avatarUrl"),
      bannerUrl: capped(bannerUrl, "bannerUrl"),
      location: capped(location, "location"),
      timezone: capped(timezone, "timezone"),
      profileVisibility: profileVisibility === "private" ? "private" : "public",
      emailNotifications: emailNotifications !== false,
      updatedAt: new Date(),
    };
    if (github) {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(String(github).replace(/^@/, ""))}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Dearmers-Dao" }, signal: AbortSignal.timeout(6_000) }).catch(() => null);
      if (response?.ok) { const profile = await response.json() as Record<string, unknown>; update.githubProfile = profile; update.reputationScore = Math.min(100, Number(profile.public_repos || 0) * 3 + Number(profile.followers || 0) + (profile.bio ? 10 : 0) + (profile.blog ? 10 : 0)); }
    }
    const filter = existingByIdentity ? { _id: existingByIdentity._id } : existingByWallet ? { _id: existingByWallet._id } : { identity: profileIdentity };
    // Keeping the old handle resolvable is what lets /u/<old> redirect instead of breaking.
    // Computed rather than $push-ed so the trail stays bounded and stays typed.
    if (previousHandle && previousHandle !== handle) {
      const trail = Array.isArray(existingByIdentity?.usernameHistory) ? existingByIdentity.usernameHistory : [];
      update.usernameHistory = [...trail.slice(-19), { from: previousHandle, to: handle, at: new Date(), reason: "member_rename" }];
    }
    try {
      await db.collection("profiles").updateOne(filter, { $set: update }, { upsert: true });
    } catch (error) {
      // The unique handle index is the authority; a concurrent claim lands here, not on the read above.
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, "That username was just taken. Choose another.");
      throw error;
    }
    const saved = await db.collection("profiles").findOne(filter);
    return json(res, 200, { ok: true, profile: saved ? publicProfile(saved, true) : null });
  } catch (error) {
    if (req.method === "POST" && (!(error instanceof HttpError) || error.status >= 500)) console.error("Profile update failed:", safeError(error));
    return errorResponse(res, error);
  }
}
