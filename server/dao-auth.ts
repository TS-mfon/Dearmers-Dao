import type { Db } from "mongodb";
import type { PrivyIdentity } from "./_privy.js";

export async function findDaoForIdentity(db: Db, daoId: string, identity: PrivyIdentity, wallet = "") {
  const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
  if (!dao) return null;
  const normalizedWallet = String(wallet || identity.wallet || "").toLowerCase();
  if (String(dao.adminIdentity || "") === identity.sub) return dao;
  if (normalizedWallet && String(dao.admin || "").toLowerCase() === normalizedWallet) return dao;
  const creation = await db.collection("daoCreationJobs").findOne({ daoId, actor: identity.sub }, { projection: { _id: 1 } });
  return creation ? dao : null;
}

