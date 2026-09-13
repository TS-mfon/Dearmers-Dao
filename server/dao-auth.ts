import type { Db } from "mongodb";
import { verifiedWallet, type PrivyIdentity } from "./_privy.js";

export async function findDaoForIdentity(db: Db, daoId: string, identity: PrivyIdentity, wallet = "") {
  const dao = await db.collection("daoIndex").findOne({ daoId, banned: { $ne: true } });
  if (!dao) return null;
  if (String(dao.adminIdentity || "") === identity.sub) return dao;
  const requestedWallet = String(wallet || "").toLowerCase();
  const tokenWallet = String(identity.wallet || "").toLowerCase();
  const linkedWallet = requestedWallet && requestedWallet !== tokenWallet
    ? await verifiedWallet(identity, requestedWallet).catch(() => "")
    : tokenWallet || await verifiedWallet(identity).catch(() => "");
  if (linkedWallet && String(dao.admin || "").toLowerCase() === linkedWallet) return dao;
  return null;
}
