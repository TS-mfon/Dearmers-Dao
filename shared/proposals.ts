export type Evaluation = { decision: string; score?: number; reasoning?: string; critique?: string; evidence_report?: string; corrections?: string; uncertainty?: string; rules_version?: string; scope_id?: string; subject_id?: string; subject_type?: string };
export type ReviewJob = { status: string; genlayerTxHash?: string; genlayerStatus?: string; explorerUrl?: string; error?: string; updatedAt?: string; reviewTxHash?: string };
export type ReviewCapabilities = { canStart: boolean; canRetry: boolean; canRefresh: boolean; canRecover: boolean; canReplace: boolean };
export type Proposal = { _id: string; daoId: string; actor?: string; wallet?: string; proposalId?: string; title: string; description: string; status: string; kind?: string; amount?: string; category?: string; recipient?: string; evidence?: string[]; createdAt?: string; votingEndsAt?: string; daoAddress?: string; onchainProposalId?: string; evaluation?: Evaluation | null; yesWeight?: string; noWeight?: string; executionHash?: string; supersedes?: string };
export const reviewPending = (status: string) => ["awaiting_ai_review", "submitted", "evaluating", "approved_for_voting", "review_relay_pending"].includes(status);

export function reviewCapabilities(status: string, job: ReviewJob | null, authorized: boolean): ReviewCapabilities {
  const pending = authorized && reviewPending(status);
  const uncertain = ["broadcasting", "submission_unknown"].includes(job?.status || "");
  const noHash = !job?.genlayerTxHash;
  return {
    canStart: pending && noHash && !uncertain && job?.status !== "submitting",
    canRetry: pending && Boolean(job?.genlayerTxHash) && ["relay_failed", "failed", "transaction_failed"].includes(job?.status || ""),
    canRefresh: pending && Boolean(job?.genlayerTxHash),
    canRecover: pending && noHash && uncertain,
    canReplace: authorized && ["corrections_required", "rejected_by_genlayer", "escalated"].includes(status),
  };
}

export function reviewLabel(status: string, job: ReviewJob | null) {
  if (job?.status === "submission_unknown" || job?.status === "broadcasting") return "Confirming submission";
  if (job?.status === "transaction_failed") return "Review transaction failed";
  if (job?.status === "relay_failed" || status === "approved_for_voting") return "Consensus reached · completing voting setup";
  if (job?.genlayerStatus?.includes("APPEAL") || job?.genlayerStatus === "UNDETERMINED") return "Consensus disputed";
  if (job?.genlayerStatus === "ACCEPTED") return "Consensus reached · awaiting finality";
  if (status === "awaiting_ai_review" || (reviewPending(status) && !job?.genlayerTxHash)) return "Awaiting AI Review";
  if (reviewPending(status)) return "Under AI Review";
  return ({ active_voting: "Finalized · approved for voting", rejected_by_genlayer: "Finalized · rejected", corrections_required: "Finalized · corrections required", escalated: "Finalized · further evidence required" } as Record<string, string>)[status] || "Review finalized";
}
