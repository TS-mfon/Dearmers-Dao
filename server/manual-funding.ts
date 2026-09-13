import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { decodeEventLog, parseAbi, type Address, type Hex } from "viem";
import { database } from "./_db.js";
import { requirePrivyIdentity } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";
import { baseClient, chainProposal, daoAbi } from "./_chain.js";
import { HttpError, errorResponse, json, method } from "./_http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["POST"])) return;
  try {
    const identity = await requirePrivyIdentity(req.headers.authorization); const db = await database();
    const { daoId, proposalId, hash } = req.body || {};
    const dao = await findDaoForIdentity(db, String(daoId), identity);
    if (!dao) throw new HttpError(403, "DAO admin authorization required.");
    if (!ObjectId.isValid(String(proposalId)) || !/^0x[a-fA-F0-9]{64}$/.test(String(hash))) throw new HttpError(400, "A proposal and Base transfer hash are required.");
    const proposal = await db.collection("proposals").findOne({ _id: new ObjectId(proposalId), daoId });
    if (!proposal || proposal.onchainProposalId === undefined) throw new HttpError(404, "Onchain proposal not found.");
    const state = await chainProposal(dao.dao as Address, BigInt(proposal.onchainProposalId));
    if (state.status !== 9 || state.kind !== 0) throw new HttpError(409, "This proposal is not awaiting manual funding.");
    const treasury = String(await baseClient().readContract({ address: dao.dao as Address, abi: daoAbi, functionName: "treasury" })).toLowerCase();
    const receipt = await baseClient().getTransactionReceipt({ hash: hash as Hex });
    if (receipt.status !== "success") throw new HttpError(422, "The transfer transaction did not succeed.");
    const token = (process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase();
    const verified = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== token) return false;
      try { const decoded = decodeEventLog({ abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]), data: log.data, topics: log.topics }); return decoded.args.from.toLowerCase() === treasury && decoded.args.to.toLowerCase() === state.recipient.toLowerCase() && decoded.args.value === state.amount; } catch { return false; }
    });
    if (!verified) throw new HttpError(422, "No matching USDC transfer from this DAO treasury to the approved recipient and amount was found.");
    const used = await db.collection("manualFundingReceipts").findOne({ hash: String(hash).toLowerCase() });
    if (used && used.proposalId !== proposalId) throw new HttpError(409, "That receipt is already assigned to another proposal.");
    await db.collection("manualFundingReceipts").updateOne({ hash: String(hash).toLowerCase() }, { $setOnInsert: { hash: String(hash).toLowerCase(), proposalId, daoId, actor: identity.sub, createdAt: new Date() } }, { upsert: true });
    return json(res, 200, { verified: true, hash });
  } catch (error) { return errorResponse(res, error); }
}
