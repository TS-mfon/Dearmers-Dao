import type { Db } from "mongodb";
import type { PrivyIdentity } from "./_privy.js";

export async function findDaoForIdentity(db: Db, daoId: string, identity: PrivyIdentity, wallet = "") {
  const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
  if (!dao) return null;
  const normalizedWallet = String(identity.wallet || "").toLowerCase();
  void wallet;
  if (String(dao.adminIdentity || "") === identity.sub) return dao;
  if (normalizedWallet && String(dao.admin || "").toLowerCase() === normalizedWallet) return dao;
  return null;
}
