import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { verifyWallet } from "./_auth.js";

const admins = () => new Set((process.env.ADMIN_WALLETS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const body = req.body || {};
    const wallet = String(req.query.wallet || body.wallet || "").toLowerCase() as Address;
    const action = String(req.query.action || body.action || "");
    const signature = (req.query.signature || body.signature || "") as Hex;
    if (!admins().has(wallet) || !signature || !await verifyWallet(`admin:${action}`, wallet, action, signature)) return json(res, 403, { error: "Protocol admin authorization required." });
    const db = await database();
    if (req.method === "GET") return json(res, 200, { users: await db.collection("profiles").find({}).sort({ reviewedAt: -1 }).limit(100).toArray(), daos: await db.collection("daoIndex").find({}).sort({ updatedAt: -1 }).limit(100).toArray() });
    if (action === "ban-user" || action === "ban-dao") {
      const collection = action === "ban-user" ? "profiles" : "daoIndex";
      const key = action === "ban-user" ? "wallet" : "daoId";
      await db.collection(collection).updateOne({ [key]: String(body.target).toLowerCase() }, { $set: { banned: Boolean(body.banned), bannedAt: new Date(), bannedBy: wallet } });
    } else if (action === "protocol-announcement") {
      await db.collection("announcements").insertOne({ scope: "protocol", title: String(body.title).slice(0, 140), body: String(body.body).slice(0, 5000), createdAt: new Date(), createdBy: wallet });
    } else return json(res, 400, { error: "Unsupported admin action." });
    await db.collection("adminAuditLog").insertOne({ action, target: body.target || null, actor: wallet, createdAt: new Date() });
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
