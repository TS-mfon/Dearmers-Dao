export type EvidenceFinding = { url?: string; retrieved?: boolean; status?: number; title?: string; description?: string; excerpt?: string; limitations?: string };
export type Evaluation = { decision: string; outcome?: string; score?: number; fit_score?: number; risk?: number; reasoning?: string; critique?: string; evidence_report?: string; corrections?: string; weak_spots?: string; improvements?: string; uncertainty?: string; rules_version?: string; scope_id?: string; subject_id?: string; subject_type?: string };
export type ReviewJob = { status: string; genlayerTxHash?: string; genlayerStatus?: string; explorerUrl?: string; error?: string; message?: string; consensusReached?: boolean; updatedAt?: string; reviewTxHash?: string };
export type ExecutionJob = { status: string; error?: string; paymentHash?: string; taskId?: string; updatedAt?: string };
export type ReviewCapabilities = { canStart: boolean; canRetry: boolean; canRefresh: boolean; canRecover: boolean; canReplace: boolean; canReconcileExecution?: boolean };
export type Proposal = { _id: string; daoId: string; actor?: string; authorLabel?: string; wallet?: string; proposalId?: string; title: string; description: string; status: string; kind?: string; amount?: string; category?: string; recipient?: string; evidence?: string[]; createdAt?: string; votingEndsAt?: string; daoAddress?: string; onchainProposalId?: string; evaluation?: Evaluation | null; consensusReached?: boolean; yesWeight?: string; noWeight?: string; executionHash?: string; supersedes?: string };
export const reviewPending = (status: string) => ["awaiting_ai_review", "submitted", "evaluating", "approved_for_voting", "review_relay_pending"].includes(status);

/** Job states that will not change without a member action, so background polling must stop. */
export const reviewSettled = (job: ReviewJob | null) => ["consensus_disputed", "evaluation_unavailable", "transaction_failed", "submission_unknown", "complete"].includes(job?.status || "");

/** An undetermined consensus yields an advisory verdict that must never be presented as binding. */
export const reviewAdvisory = (status: string, job: ReviewJob | null) => status === "consensus_disputed" || job?.status === "consensus_disputed" || job?.consensusReached === false;

/** Plain-language status for members. `job.error` holds internal exception text and must never be rendered. */
export const reviewMessage = (job: ReviewJob | null) => job?.message || (job?.error ? "This review could not be completed. Retry, or contact the DAO stewards if it keeps failing." : "");

export function reviewCapabilities(status: string, job: ReviewJob | null, authorized: boolean): ReviewCapabilities {
  const pending = authorized && reviewPending(status);
  const uncertain = ["broadcasting", "submission_unknown"].includes(job?.status || "");
  const syncingPolicy = job?.status === "syncing_policy";
  const noHash = !job?.genlayerTxHash;
  const disputed = authorized && job?.status === "consensus_disputed";
  return {
    canStart: pending && noHash && !uncertain && !syncingPolicy && job?.status !== "submitting",
    canRetry: (pending || disputed) && Boolean(job?.genlayerTxHash) && ["relay_failed", "failed", "transaction_failed", "evaluation_unavailable", "consensus_disputed"].includes(job?.status || ""),
    canRefresh: pending && !reviewSettled(job) && (Boolean(job?.genlayerTxHash) || syncingPolicy),
    canRecover: pending && noHash && uncertain,
    canReplace: authorized && ["corrections_required", "rejected_by_genlayer", "escalated", "consensus_disputed"].includes(status),
  };
}

export function reviewLabel(status: string, job: ReviewJob | null) {
  if (job?.status === "syncing_policy") return "Synchronizing DAO policy";
  if (!job?.genlayerTxHash && job?.error?.includes("Base constitution")) return "Base governance setup pending";
  if (!job?.genlayerTxHash && job?.error?.includes("GenLayer")) return "GenLayer policy synchronization pending";
  if (!job?.genlayerTxHash && job?.error?.includes("active constitution")) return "Base governance requires DAO setup";
  if (job?.status === "submission_unknown" || job?.status === "broadcasting") return "Confirming submission";
  if (job?.status === "transaction_failed") return "Review transaction canceled";
  if (job?.status === "evaluation_unavailable") return "Finalized · evaluation execution failed";
  if (job?.status === "consensus_disputed") return "No consensus · advisory result only";
  if (job?.status === "relay_failed" || status === "approved_for_voting") return "Consensus reached · completing voting setup";
  if (job?.genlayerStatus?.includes("APPEAL") || job?.genlayerStatus === "UNDETERMINED") return "No consensus · advisory result only";
  if (job?.genlayerStatus === "ACCEPTED") return "Consensus reached · awaiting finality";
  if (reviewPending(status) && !job?.genlayerTxHash) return "Awaiting AI Review";
  if (reviewPending(status)) return "Under AI Review";
  return ({ active_voting: "Finalized · approved for voting", rejected_by_genlayer: "Finalized · rejected", corrections_required: "Finalized · corrections required", escalated: "Finalized · further evidence required", consensus_disputed: "No consensus · advisory result only" } as Record<string, string>)[status] || "Review finalized";
}
