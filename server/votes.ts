import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { createWalletClient, http, isAddress, verifyTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";
import { requirePrivyIdentity } from "./_privy.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const db = await database();
    if (req.method === "GET") {
      const proposalId = String(req.query.proposalId || "");
      if (!proposalId) return json(res, 400, { error: "Proposal id is required." });
      return json(res, 200, { votes: await db.collection("proposalVotes").find({ proposalId }).project({ _id: 0, support: 1, createdAt: 1, actor: 1 }).toArray() });
    }
    const identity = await requirePrivyIdentity(req.headers.authorization);
    const body = req.body || {};
    const proposalId = String(body.proposalId || "");
    if (!proposalId || typeof body.support !== "boolean" || !body.signature || !body.deadline || !body.nonce) return json(res, 400, { error: "Proposal, support, nonce, deadline, and vote signature are required." });
    const proposal = (ObjectId.isValid(proposalId) ? await db.collection("proposals").findOne({ _id: new ObjectId(proposalId) }) : null) || await db.collection("proposals").findOne({ proposalId });
    if (!proposal) return json(res, 404, { error: "Proposal was not found." });
    if (proposal.status !== "active_voting") return json(res, 409, { error: "This proposal is not accepting votes." });
    const existing = await db.collection("proposalVotes").findOne({ proposalId, actor: identity.sub });
    if (existing) return json(res, 409, { error: "You have already voted on this proposal." });
    const profile = await db.collection("profiles").findOne({ identity: `privy:${identity.sub}` });
    const voter = String(profile?.wallet || identity.wallet || body.wallet || "").toLowerCase() as Address;
    const daoAddress = String(proposal.daoAddress || proposal.dao || "").toLowerCase() as Address;
    const onchainProposalId = proposal.onchainProposalId;
    if (!isAddress(voter) || !isAddress(daoAddress) || onchainProposalId === undefined) return json(res, 409, { error: "This proposal is not connected to its onchain voting record yet." });
    const deadline = BigInt(String(body.deadline));
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) return json(res, 409, { error: "This vote signature has expired." });
    const valid = await verifyTypedData({ address: voter, domain: { name: "Dearmers DAO", version: "1", chainId: baseSepolia.id, verifyingContract: daoAddress }, types: { VoteIntent: [{ name: "daoId", type: "string" }, { name: "proposalId", type: "uint256" }, { name: "support", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "VoteIntent", message: { daoId: String(proposal.daoId), proposalId: BigInt(String(onchainProposalId)), support: body.support, nonce: BigInt(String(body.nonce)), deadline }, signature: String(body.signature) as Hex });
    if (!valid) return json(res, 401, { error: "Invalid vote signature." });
    const intentKey = `${proposalId}:${identity.sub}:${String(body.nonce)}`;
    const intent = await db.collection("proposalIntents").findOne({ proposalKey: intentKey });
    if (intent) return json(res, 409, { error: "This vote intent has already been submitted." });
    const relayerKey = process.env.BASE_VOTE_RELAYER_PRIVATE_KEY || process.env.BASE_AUTOMATION_PRIVATE_KEY;
    if (!relayerKey) return json(res, 503, { error: "Vote relayer is not configured." });
    const wallet = createWalletClient({ account: privateKeyToAccount(relayerKey as Hex), chain: baseSepolia, transport: http(process.env.BASE_RPC_URL || "https://sepolia.base.org") });
    const voteAbi = [{ type: "function", name: "castProposalVoteFor", inputs: [{ name: "proposalId", type: "uint256" }, { name: "voter", type: "address" }, { name: "support", type: "bool" }], outputs: [], stateMutability: "nonpayable" }] as const;
    const txHash = await wallet.writeContract({ account: wallet.account, chain: baseSepolia, address: daoAddress, abi: voteAbi, functionName: "castProposalVoteFor", args: [BigInt(String(onchainProposalId)), voter, body.support] });
    await db.collection("proposalIntents").insertOne({ proposalKey: intentKey, proposalId, actor: identity.sub, nonce: String(body.nonce), signature: String(body.signature), txHash, createdAt: new Date() });
    await db.collection("proposalVotes").insertOne({ proposalId, daoId: proposal.daoId, actor: identity.sub, wallet: voter, support: body.support, signature: String(body.signature), txHash, createdAt: new Date() });
    await db.collection("auditLogs").insertOne({ scopeId: proposal.daoId, type: "vote_intent_signed", actor: identity.sub, proposalId, createdAt: new Date() });
    return json(res, 201, { ok: true, status: "accepted", message: "Vote intent recorded for relayer submission." });
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
