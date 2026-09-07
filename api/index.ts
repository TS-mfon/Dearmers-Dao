import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "../server/admin.js";
import announcements from "../server/announcements.js";
import assets from "../server/assets.js";
import chat from "../server/chat.js";
import daoCreation from "../server/dao-creation.js";
import daos from "../server/daos.js";
import delegations from "../server/delegations.js";
import genlayer from "../server/genlayer.js";
import grants from "../server/grants.js";
import history from "../server/history.js";
import media from "../server/media.js";
import members from "../server/members.js";
import membership from "../server/membership.js";
import notifications from "../server/notifications.js";
import profile from "../server/profile.js";
import proposals from "../server/proposals.js";
import reviews from "../server/reviews.js";
import search from "../server/search.js";
import social from "../server/social.js";
import votes from "../server/votes.js";

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  admin, announcements, assets, chat, "dao-creation": daoCreation, daos, delegations,
  genlayer, grants, history, media, members, membership, notifications, profile,
  proposals, reviews, search, social, votes,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = String(req.query.route || "").replace(/^\/+|\/+$/g, "").split("/")[0];
  const selected = handlers[route];
  if (!selected) return res.status(404).json({ error: "API route not found." });
  return selected(req, res);
}
