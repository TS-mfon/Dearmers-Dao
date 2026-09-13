import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";
import { ObjectId } from "mongodb";
import { baseClient, registryAbi } from "./_chain.js";
async function resolveDaoMedia(db: Awaited<ReturnType<typeof database>>, dao: Record<string, unknown>) {
  const daoId = String(dao.daoId || "");
  const mediaIds = { logo: String(dao.logoMediaId || ""), banner: String(dao.bannerMediaId || "") };
  const ids = Object.values(mediaIds).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const files = ids.length ? await db.collection("media.files").find({ _id: { $in: ids }, "metadata.scope": "dao", "metadata.resourceId": daoId }).toArray() : [];
  const byId = new Map(files.map((file) => [String(file._id), file]));
  const uri = (id: string) => { const file = byId.get(id); return file?._id instanceof ObjectId ? `/api/media?id=${file._id.toHexString()}` : ""; };
  return { ...dao, logoUri: uri(mediaIds.logo), bannerUri: uri(mediaIds.banner) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const daoId = String(req.query.daoId || "").trim();
      if (daoId) {
        const found = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } }, { projection: { _id: 0 } });
        const dao = found ? await resolveDaoMedia(db, found) : null;
        if (!dao) return json(res, 404, { error: "DAO not found." });
        return json(res, 200, { dao });
      }
      const query = String(req.query.q || "").trim();
      const filter = query ? { $or: [{ name: new RegExp(query, "i") }, { description: new RegExp(query, "i") }, { category: new RegExp(query, "i") }], banned: { $ne: true } } : { banned: { $ne: true } };
      const records = await db.collection("daoIndex").find(filter).sort({ mode: -1, updatedAt: -1 }).limit(100).project({ _id: 0 }).toArray();
      return json(res, 200, { daos: await Promise.all(records.map((record) => resolveDaoMedia(db, record))) });
    }
    const { wallet, signature, daoId, dao, admin, name, mode, metadata, description, category } = req.body || {};
    if (!wallet || !signature || !daoId || !dao || !name || !await verifyWallet("index-dao", wallet as Address, String(daoId), signature as Hex)) return json(res, 401, { error: "Valid admin authorization required." });
    if (String(wallet).toLowerCase() !== String(admin).toLowerCase()) return json(res, 403, { error: "Only the bound DAO admin can index this covenant." });
    const record = await baseClient().readContract({ address: process.env.DEARMERS_REGISTRY_ADDRESS as Address, abi: registryAbi, functionName: "getDAO", args: [daoId] }) as { admin: Address; dao: Address; name: string; metadataUri: string };
    if (record.admin.toLowerCase() !== String(wallet).toLowerCase() || record.dao.toLowerCase() !== String(dao).toLowerCase() || record.name !== name || record.metadataUri !== metadata) return json(res, 403, { error: "DAO indexing must match the authoritative registry record." });
    await db.collection("daoIndex").updateOne({ daoId: String(daoId) }, { $set: { daoId: String(daoId), dao: String(dao), admin: String(admin).toLowerCase(), name: String(name), mode: Number(mode) || 0, metadata, bannerUri: "", logoUri: "", description: description || "", category: category || "", active: true, updatedAt: new Date() } }, { upsert: true });
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
