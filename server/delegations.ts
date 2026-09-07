import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAddress, type Address, type Hex } from "viem";
import { database } from "./_db.js";
import { encrypt } from "./_crypto.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const { creationKey, daoId, daoAddress, treasury, executor, token, permissions, wallet, signature } = req.body || {};
    if (![creationKey, treasury, executor, token, wallet, signature].every(Boolean) || !permissions) return json(res, 400, { error: "Missing delegation fields." });
    if (!isAddress(String(treasury)) || !isAddress(String(executor)) || !isAddress(String(token)) || String(wallet).toLowerCase() !== String(treasury).toLowerCase()) return json(res, 400, { error: "Delegation addresses are invalid." });
    const resource = `${creationKey}:${String(treasury).toLowerCase()}:${String(executor).toLowerCase()}`;
    if (!await verifyWallet("store-delegation", wallet as Address, resource, signature as Hex)) return json(res, 401, { error: "Invalid wallet signature." });
    const db = await database();
    await db.collection("delegations").updateOne({ creationKey }, { $set: { creationKey, ...(daoId ? { daoId } : {}), ...(daoAddress ? { daoAddress } : {}), actor: identity.sub, treasury: String(treasury).toLowerCase(), executor: String(executor).toLowerCase(), token: String(token).toLowerCase(), payload: encrypt(permissions), updatedAt: new Date() } }, { upsert: true });
    json(res, 200, { ok: true });
  } catch (error) { json(res, 500, { error: safeError(error) }); }
}
