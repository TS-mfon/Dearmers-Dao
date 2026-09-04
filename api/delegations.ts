import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { encrypt } from "./_crypto.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { daoId, daoAddress, treasury, executor, token, permissions, wallet, signature } = req.body || {};
    if (![daoId, daoAddress, treasury, executor, token, wallet, signature].every(Boolean) || !permissions) return json(res, 400, { error: "Missing delegation fields." });
    const resource = `${daoId}:${treasury}:${executor}`;
    if (!await verifyWallet("store-delegation", wallet as Address, resource, signature as Hex)) return json(res, 401, { error: "Invalid wallet signature." });
    if ((wallet as string).toLowerCase() !== (treasury as string).toLowerCase()) return json(res, 403, { error: "The treasury wallet must authorize delegation storage." });
    const db = await database();
    await db.collection("delegations").updateOne({ daoId }, { $set: { daoId, daoAddress, treasury, executor, token, payload: encrypt(permissions), updatedAt: new Date() } }, { upsert: true });
    json(res, 200, { ok: true });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
