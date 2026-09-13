import type { Document } from "mongodb";
import type { Address } from "viem";
import { chainProposal } from "./_chain.js";
import { database } from "./_db.js";

export async function syncProposalState(proposal: Document) {
  if (proposal.onchainProposalId === undefined || !proposal.daoAddress) return;
  const state = await chainProposal(proposal.daoAddress as Address, BigInt(String(proposal.onchainProposalId)));
  const statuses = ["awaiting_ai_review", "corrections_required", "active_voting", "defeated", "passed", "executed", "escalated", "paused", "tied", "manual_funding", "execution_pending", "adopted"];
  const status = statuses[state.status];
  if (!status) return;
  const db = await database();
  await db.collection("proposals").updateOne({ _id: proposal._id }, { $set: { status, yesWeight: String(state.yesWeight), noWeight: String(state.noWeight), votingEndsAt: state.votingEndsAt ? new Date(Number(state.votingEndsAt) * 1000) : null, ...(state.executionHash && !/^0x0+$/.test(state.executionHash) ? { executionHash: state.executionHash } : {}), updatedAt: new Date() } });
  if (proposal.status !== status) await db.collection("auditLogs").updateOne({ eventKey: `proposal:${proposal._id}:${status}` }, { $setOnInsert: { eventKey: `proposal:${proposal._id}:${status}`, scopeId: proposal.daoId, type: `proposal_${status}`, proposalId: String(proposal._id), createdAt: new Date() } }, { upsert: true });
}
