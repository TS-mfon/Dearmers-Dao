import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { parseUnits, type Address } from "viem";
import { database } from "./_db.js";
import { method, json, errorResponse, HttpError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";
import { readPolicy, syncDaoPolicy } from "./_policy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization); const db = await database(); const body = req.body || {};
    const daoId = String(req.query.daoId || body.daoId || "");
    const dao = await findDaoForIdentity(db, daoId, identity);
    if (!dao) throw new HttpError(403, "This control room is only available to this DAO's administrator.");
    const view = String(req.query.view || "identity");
    if (req.method === "GET") {
      const result: Record<string, unknown> = { dao };
      if (view === "proposals") result.proposals = await db.collection("proposals").find({ daoId }).sort({ updatedAt: -1 }).limit(100).toArray();
      if (view === "members") {
        result.members = await db.collection("daoMembers").aggregate([{ $match: { daoId } }, { $lookup: { from: "profiles", let: { actor: "$actor" }, pipeline: [{ $match: { $expr: { $eq: ["$identity", { $concat: ["privy:", "$$actor"] }] } } }, { $project: { displayName: 1, username: 1 } }], as: "profile" } }, { $limit: 200 }]).toArray();
        result.applications = await db.collection("membershipApplications").find({ daoId, status: "pending" }).limit(200).toArray();
      }
      if (view === "settings") { result.policy = await readPolicy(dao.dao as Address); result.delegation = await db.collection("delegations").findOne({ daoId }, { projection: { status: 1, token: 1, executor: 1, expiry: 1 } }); }
      if (view === "history") result.events = await db.collection("auditLogs").find({ scopeId: daoId }).sort({ createdAt: -1 }).limit(200).toArray();
      return json(res, 200, result);
    }
    const action = String(body.action || req.query.action || "");
    if (action === "update-identity") {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const field of ["description", "category"] as const) if (typeof body[field] === "string") updates[field] = body[field].trim().slice(0, field === "category" ? 80 : 2000);
      if (Array.isArray(body.tags)) updates.tags = body.tags.map(String).map((value: string) => value.trim()).filter(Boolean).slice(0, 12);
      if (typeof body.mission === "string" && body.mission.trim() !== dao.mission) updates.pendingMission = body.mission.trim().slice(0, 5000);
      if (typeof body.constitution === "string" && body.constitution.trim() !== dao.constitution) updates.pendingConstitution = body.constitution.trim().slice(0, 15000);
      await db.collection("daoIndex").updateOne({ daoId }, { $set: updates });
    } else if (action === "prepare-policy") {
      const current = await readPolicy(dao.dao as Address);
      const units = (value: unknown) => { const text = String(value); if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new HttpError(400, "Limits must be non-negative USDC amounts with at most six decimal places."); return parseUnits(text, 6); };
      const policy = { ...current.constitution, votingPeriod: 259200, weeklySpendLimit: units(body.weeklyLimit), maxProposalAmount: units(body.maxProposalAmount), policyText: dao.pendingConstitution || dao.constitution };
      if (!policy.policyText) throw new HttpError(400, "Save a constitution in Identity first.");
      return json(res, 200, { policy, threshold: units(body.manualFundingThreshold), address: dao.dao, admin: current.admin });
    } else if (action === "sync-policy") {
      await syncDaoPolicy(daoId);
    } else if (action === "update-media") {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const [uri, field, purpose] of [[body.logoUri, "logoMediaId", "dao-logo"], [body.bannerUri, "bannerMediaId", "dao-banner"]] as const) {
        if (!uri) continue;
        const mediaId = String(uri).match(/[?&]id=([a-f0-9]{24})$/i)?.[1];
        if (!mediaId) throw new HttpError(400, "Upload the image through the DAO media service.");
        const file = await db.collection("media.files").findOne({ _id: new ObjectId(mediaId), "metadata.scope": "dao", "metadata.resourceId": daoId, "metadata.ownerIdentity": identity.sub, "metadata.purpose": purpose });
        if (!file) throw new HttpError(403, "This asset is not owned by this DAO.");
        updates[field] = mediaId;
      }
      if (Object.keys(updates).length === 1) throw new HttpError(400, "Select a DAO image first.");
      await db.collection("daoIndex").updateOne({ daoId }, { $set: updates });
    } else if (action === "sync-governance") {
      const { syncProposalState } = await import("./_proposal-state.js");
      if (!ObjectId.isValid(String(body.proposalId))) throw new HttpError(400, "Invalid proposal.");
      const proposal = await db.collection("proposals").findOne({ _id: new ObjectId(String(body.proposalId)), daoId });
      if (!proposal) throw new HttpError(404, "Proposal not found.");
      await syncProposalState(proposal);
    } else throw new HttpError(400, "Unsupported DAO admin action.");
    await db.collection("auditLogs").insertOne({ scopeId: daoId, type: action, actor: identity.sub, createdAt: new Date() });
    return json(res, 200, { ok: true });
  } catch (error) { return errorResponse(res, error); }
}
