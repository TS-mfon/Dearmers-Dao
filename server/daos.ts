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
      const query = String(req.query.q || "").trim();
      const filter = query ? { $or: [{ name: new RegExp(query, "i") }, { description: new RegExp(query, "i") }, { category: new RegExp(query, "i") }], banned: { $ne: true } } : { banned: { $ne: true } };
      return json(res, 200, { daos: await db.collection("daoIndex").find(filter).sort({ mode: -1, updatedAt: -1 }).limit(100).toArray() });
    }
    const { wallet, signature, daoId, dao, admin, name, mode, metadata, bannerUri, logoUri, description, category } = req.body || {};
    if (!wallet || !signature || !daoId || !dao || !name || !await verifyWallet("index-dao", wallet as Address, String(daoId), signature as Hex)) return json(res, 401, { error: "Valid admin authorization required." });
    if (String(wallet).toLowerCase() !== String(admin).toLowerCase()) return json(res, 403, { error: "Only the bound DAO admin can index this covenant." });
    await db.collection("daoIndex").updateOne({ daoId: String(daoId) }, { $set: { daoId: String(daoId), dao: String(dao), admin: String(admin).toLowerCase(), name: String(name), mode: Number(mode) || 0, metadata, bannerUri: bannerUri || "", logoUri: logoUri || "", description: description || "", category: category || "", active: true, updatedAt: new Date() } }, { upsert: true });
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
