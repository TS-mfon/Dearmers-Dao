import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const db = await database();
    const body = req.body || {};
    const daoId = String(req.query.daoId || body.daoId || "");
    if (!daoId) return json(res, 400, { error: "DAO id is required." });
    const dao = await findDaoForIdentity(db, daoId, identity, String(body.wallet || req.query.wallet || ""));
    if (!dao) return json(res, 403, { error: "DAO admin authorization required." });
    if (req.method === "GET") return json(res, 200, { dao, proposals: await db.collection("proposals").find({ daoId, status: { $in: ["tied", "manual_funding", "tied_pending_admin", "approved_pending_manual_transfer"] } }).sort({ updatedAt: -1 }).limit(100).toArray(), members: await db.collection("daoMembers").find({ daoId }).sort({ joinedAt: -1 }).limit(200).toArray(), announcements: await db.collection("announcements").find({ daoId }).sort({ createdAt: -1 }).limit(100).toArray() });
    const action = String(req.query.action || body.action || "");
    if (action === "resolve-tie") {
      if (!body.proposalId || typeof body.support !== "boolean") return json(res, 400, { error: "Proposal and decision are required." });
      const query = ObjectId.isValid(String(body.proposalId)) ? { _id: new ObjectId(String(body.proposalId)), daoId } : { proposalId: String(body.proposalId), daoId };
      const result = await db.collection("proposals").updateOne({ ...query, status: { $in: ["tied", "tied_pending_admin"] } }, { $set: { status: body.support ? "passed" : "defeated", tieResolvedBy: identity.sub, updatedAt: new Date() } });
      if (!result.matchedCount) return json(res, 409, { error: "This proposal is no longer awaiting tie resolution." });
    } else if (action === "manual-funding") {
      if (!body.proposalId || !String(body.reference || "").trim()) return json(res, 400, { error: "Proposal and transfer reference are required." });
      const query = ObjectId.isValid(String(body.proposalId)) ? { _id: new ObjectId(String(body.proposalId)), daoId } : { proposalId: String(body.proposalId), daoId };
      const result = await db.collection("proposals").updateOne({ ...query, status: { $in: ["manual_funding", "approved_pending_manual_transfer"] } }, { $set: { status: "manually_funded", fundingReference: String(body.reference).slice(0, 300), fundedBy: identity.sub, updatedAt: new Date() } });
      if (!result.matchedCount) return json(res, 409, { error: "This proposal is not awaiting manual funding." });
    } else if (action === "settings") {
      const weeklyCap = Number(body.weeklyCap);
      if (!Number.isFinite(weeklyCap) || weeklyCap < 0) return json(res, 400, { error: "Weekly cap must be a non-negative number." });
      await db.collection("daoIndex").updateOne({ daoId }, { $set: { weeklyCap, updatedAt: new Date() } });
    } else if (action === "update-media") {
      const logoUri = String(body.logoUri || "").trim();
      const bannerUri = String(body.bannerUri || "").trim();
      if (!logoUri && !bannerUri) return json(res, 400, { error: "Upload a DAO logo or banner first." });
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const [uri, field, purpose] of [[logoUri, "logoMediaId", "dao-logo"], [bannerUri, "bannerMediaId", "dao-banner"]] as const) {
        const mediaId = uri.match(/[?&]id=([a-f0-9]{24})$/i)?.[1];
        if (!uri) continue;
        if (!mediaId || !ObjectId.isValid(mediaId)) return json(res, 400, { error: "DAO media must come from the media upload service." });
        const file = await db.collection("media.files").findOne({ _id: new ObjectId(mediaId), "metadata.scope": "dao", "metadata.resourceId": daoId, "metadata.ownerIdentity": identity.sub, "metadata.purpose": purpose });
        if (!file) return json(res, 403, { error: "This asset is not owned by this DAO." });
        updates[field] = mediaId;
      }
      await db.collection("daoIndex").updateOne({ daoId }, { $set: updates, $unset: { ...(logoUri ? { logoUri: "" } : {}), ...(bannerUri ? { bannerUri: "" } : {}) } });
    } else return json(res, 400, { error: "Unsupported DAO admin action." });
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: action, actor: identity.sub, target: body.proposalId || null, createdAt: new Date() });
    return json(res, 200, { ok: true, action });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
