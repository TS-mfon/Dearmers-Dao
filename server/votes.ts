import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { verifyTypedData, type Address, type Hex } from "viem";
import { database } from "./_db.js";
import { HttpError, errorResponse, json, method, safeError } from "./_http.js";
import { requirePrivyIdentity, verifiedWallet } from "./_privy.js";
import { findDaoForIdentity } from "./dao-auth.js";
import { baseClient, baseSigner, chainProposal, confirmed, daoAbi } from "./_chain.js";
import { syncProposalState } from "./_proposal-state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database(); const body = req.body || {}; const proposalId = String(body.proposalId || req.query.proposalId || "");
    if (!ObjectId.isValid(proposalId)) throw new HttpError(400, "A valid proposal id is required.");
    if (req.method === "GET") return json(res, 200, { votes: await db.collection("proposalVotes").find({ proposalId, status: "confirmed" }).project({ _id: 0, support: 1, createdAt: 1, wallet: 1 }).toArray() });
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const proposal = await db.collection("proposals").findOne({ _id: new ObjectId(proposalId) });
    if (!proposal || proposal.status !== "active_voting" || proposal.onchainProposalId === undefined) throw new HttpError(409, "This proposal is not accepting votes.");
    const membership = await db.collection("daoMembers").findOne({ daoId: proposal.daoId, actor: identity.sub, status: "active" });
    if (!membership && !await findDaoForIdentity(db, proposal.daoId, identity)) throw new HttpError(403, "Active DAO membership is required to vote.");
    const voter = await verifiedWallet(identity, String(body.wallet || "")) as Address;
    const address = proposal.daoAddress as Address; const onchainId = BigInt(proposal.onchainProposalId);
    const state = await chainProposal(address, onchainId);
    if (state.status !== 2 || Number(state.votingEndsAt) <= Date.now() / 1000) throw new HttpError(409, "Member voting has closed.");
    if (typeof body.support !== "boolean" || !/^\d+$/.test(String(body.deadline)) || !/^\d+$/.test(String(body.nonce))) throw new HttpError(400, "A signed vote, nonce, and deadline are required.");
    const deadline = BigInt(body.deadline); const nonce = BigInt(body.nonce);
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new HttpError(409, "The vote signature expired.");
    const valid = await verifyTypedData({ address: voter, domain: { name: "Dearmers DAO", version: "1", chainId: 84532, verifyingContract: address }, types: { VoteIntent: [{ name: "daoId", type: "string" }, { name: "proposalId", type: "uint256" }, { name: "support", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "VoteIntent", message: { daoId: proposal.daoId, proposalId: onchainId, support: body.support, nonce, deadline }, signature: String(body.signature) as Hex });
    if (!valid) throw new HttpError(401, "Invalid vote signature.");
    if (await db.collection("proposalVotes").findOne({ proposalId, wallet: voter })) throw new HttpError(409, "This wallet already has a submitted vote. Check its transaction status.");
    const signer = baseSigner(process.env.BASE_VOTE_RELAYER_PRIVATE_KEY ? "BASE_VOTE_RELAYER_PRIVATE_KEY" : "BASE_AUTOMATION_PRIVATE_KEY");
    const registered = await baseClient().readContract({ address, abi: daoAbi, functionName: "registeredMembers", args: [voter] });
    if (!registered) { const memberHash = await signer.writeContract({ address, abi: daoAbi, functionName: "syncMemberFor", args: [voter, true] }); await confirmed(memberHash); }
    const inserted = await db.collection("proposalVotes").insertOne({ proposalId, daoId: proposal.daoId, actor: identity.sub, wallet: voter, support: body.support, status: "submitting", createdAt: new Date() });
    let hash: Hex | undefined;
    try {
      hash = await signer.writeContract({ address, abi: daoAbi, functionName: "castProposalVoteFor", args: [onchainId, voter, body.support] });
      await db.collection("proposalVotes").updateOne({ _id: inserted.insertedId }, { $set: { txHash: hash, status: "pending" } });
      await confirmed(hash);
      await db.collection("proposalVotes").updateOne({ _id: inserted.insertedId }, { $set: { status: "confirmed" } });
      await syncProposalState(proposal);
      return json(res, 201, { status: "confirmed", txHash: hash, message: "Your vote is confirmed onchain." });
    } catch (error) {
      await db.collection("proposalVotes").updateOne({ _id: inserted.insertedId }, { $set: { status: hash ? "pending" : "submission_unknown", error: safeError(error) } });
      return json(res, 202, { status: hash ? "pending" : "submission_unknown", txHash: hash, message: hash ? "Vote submitted; confirmation is pending." : "Vote submission response was interrupted. Do not sign another vote while it is being reconciled." });
    }
  } catch (error) { return errorResponse(res, error); }
}
