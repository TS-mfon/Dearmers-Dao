import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewAdvisory, reviewCapabilities, reviewLabel, reviewMessage, reviewPending, reviewSettled, type ReviewJob } from "../shared/proposals.js";

const job = (overrides: Partial<ReviewJob> = {}): ReviewJob => ({ status: "submitting", ...overrides });

describe("reviewPending", () => {
  it("covers every status that is still awaiting a verdict", () => {
    for (const status of ["awaiting_ai_review", "submitted", "evaluating", "approved_for_voting", "review_relay_pending"])
      assert.equal(reviewPending(status), true, status);
  });

  it("is false once the proposal has a verdict", () => {
    for (const status of ["active_voting", "rejected_by_genlayer", "corrections_required", "escalated", "consensus_disputed", "passed", "defeated", "executed"])
      assert.equal(reviewPending(status), false, status);
  });
});

describe("reviewSettled", () => {
  // Regression guard: the 8-second status poll used to regenerate settled failures,
  // which consumed the GenLayer execution slots behind "all 8 execution slots occupied".
  it("stops polling for states that need a member action", () => {
    for (const status of ["consensus_disputed", "evaluation_unavailable", "transaction_failed", "submission_unknown", "complete"])
      assert.equal(reviewSettled(job({ status })), true, status);
  });

  it("keeps polling while the job can still move on its own", () => {
    for (const status of ["submitting", "broadcasting", "queued", "syncing_policy", "relay_failed", "failed"])
      assert.equal(reviewSettled(job({ status })), false, status);
  });

  it("keeps polling when there is no job yet", () => {
    assert.equal(reviewSettled(null), false);
  });
});

describe("reviewAdvisory", () => {
  it("flags an undetermined consensus from the proposal status", () => {
    assert.equal(reviewAdvisory("consensus_disputed", null), true);
  });

  it("flags an undetermined consensus from the job status", () => {
    assert.equal(reviewAdvisory("evaluating", job({ status: "consensus_disputed" })), true);
  });

  it("flags an explicit consensusReached: false even when the status looks ordinary", () => {
    assert.equal(reviewAdvisory("evaluating", job({ status: "complete", consensusReached: false })), true);
  });

  it("does not flag a reached consensus", () => {
    assert.equal(reviewAdvisory("active_voting", job({ status: "complete", consensusReached: true })), false);
  });

  it("does not flag an ordinary in-flight review", () => {
    assert.equal(reviewAdvisory("evaluating", job({ status: "submitting" })), false);
  });
});

describe("reviewMessage", () => {
  it("prefers the plain-language message", () => {
    assert.equal(reviewMessage(job({ message: "GenLayer validators are at capacity right now." })), "GenLayer validators are at capacity right now.");
  });

  // Regression guard: job.error holds internal exception text and must never reach a member.
  it("substitutes a generic sentence when only internal error text exists", () => {
    const message = reviewMessage(job({ error: "KeyError: 'proposal:42'\n  File \"/genvm/runner.py\", line 118" }));
    assert.equal(message, "This review could not be completed. Retry, or contact the DAO stewards if it keeps failing.");
    assert.ok(!message.includes("KeyError"));
    assert.ok(!message.includes("runner.py"));
  });

  it("is empty when there is nothing to say", () => {
    assert.equal(reviewMessage(job()), "");
    assert.equal(reviewMessage(null), "");
  });
});

describe("reviewCapabilities", () => {
  it("offers a start for a pending proposal that has no job yet", () => {
    const capabilities = reviewCapabilities("awaiting_ai_review", null, true);
    assert.equal(capabilities.canStart, true);
    assert.equal(capabilities.canRecover, false);
    assert.equal(capabilities.canRetry, false);
  });

  it("withholds every capability from an unauthorized viewer", () => {
    const capabilities = reviewCapabilities("corrections_required", job({ status: "consensus_disputed", genlayerTxHash: "0xabc" }), false);
    assert.deepEqual(capabilities, { canStart: false, canRetry: false, canRefresh: false, canRecover: false, canReplace: false });
  });

  it("does not offer a second start while a submission is in flight", () => {
    for (const status of ["submitting", "broadcasting", "submission_unknown", "syncing_policy"])
      assert.equal(reviewCapabilities("submitted", job({ status }), true).canStart, false, status);
  });

  // broadcasting and submission_unknown mean the transaction may or may not have been sent.
  it("offers recovery, not a start, for an uncertain submission", () => {
    for (const status of ["broadcasting", "submission_unknown"]) {
      const capabilities = reviewCapabilities("submitted", job({ status }), true);
      assert.equal(capabilities.canRecover, true, status);
      assert.equal(capabilities.canStart, false, status);
    }
  });

  it("offers a retry for a failed job that did reach GenLayer", () => {
    for (const status of ["relay_failed", "failed", "transaction_failed", "evaluation_unavailable"])
      assert.equal(reviewCapabilities("evaluating", job({ status, genlayerTxHash: "0xabc" }), true).canRetry, true, status);
  });

  it("offers a retry on a disputed consensus even though the proposal is no longer pending", () => {
    assert.equal(reviewCapabilities("consensus_disputed", job({ status: "consensus_disputed", genlayerTxHash: "0xabc" }), true).canRetry, true);
  });

  it("does not offer a retry when no transaction was ever sent", () => {
    assert.equal(reviewCapabilities("evaluating", job({ status: "failed" }), true).canRetry, false);
  });

  it("allows a refresh while the job is live, and stops once it is settled", () => {
    assert.equal(reviewCapabilities("evaluating", job({ status: "submitting", genlayerTxHash: "0xabc" }), true).canRefresh, true);
    assert.equal(reviewCapabilities("evaluating", job({ status: "syncing_policy" }), true).canRefresh, true);
    for (const status of ["consensus_disputed", "evaluation_unavailable", "transaction_failed", "submission_unknown", "complete"])
      assert.equal(reviewCapabilities("evaluating", job({ status, genlayerTxHash: "0xabc" }), true).canRefresh, false, status);
  });

  it("lets the author replace a proposal that came back with a verdict it can act on", () => {
    for (const status of ["corrections_required", "rejected_by_genlayer", "escalated", "consensus_disputed"])
      assert.equal(reviewCapabilities(status, null, true).canReplace, true, status);
    assert.equal(reviewCapabilities("active_voting", null, true).canReplace, false);
  });
});

describe("reviewLabel", () => {
  it("reports policy synchronization ahead of everything else", () => {
    assert.equal(reviewLabel("submitted", job({ status: "syncing_policy", genlayerTxHash: "0xabc" })), "Synchronizing DAO policy");
  });

  it("explains a blocked submission from its internal error without quoting it", () => {
    assert.equal(reviewLabel("submitted", job({ status: "failed", error: "Base constitution is not active" })), "Base governance setup pending");
    assert.equal(reviewLabel("submitted", job({ status: "failed", error: "GenLayer policy write reverted" })), "GenLayer policy synchronization pending");
    assert.equal(reviewLabel("submitted", job({ status: "failed", error: "DAO has no active constitution" })), "Base governance requires DAO setup");
  });

  it("describes an uncertain submission as confirming", () => {
    assert.equal(reviewLabel("submitted", job({ status: "submission_unknown" })), "Confirming submission");
    assert.equal(reviewLabel("submitted", job({ status: "broadcasting" })), "Confirming submission");
  });

  it("labels an undetermined consensus as advisory from either source", () => {
    assert.equal(reviewLabel("evaluating", job({ status: "consensus_disputed" })), "No consensus · advisory result only");
    assert.equal(reviewLabel("evaluating", job({ status: "complete", genlayerStatus: "UNDETERMINED" })), "No consensus · advisory result only");
    assert.equal(reviewLabel("evaluating", job({ status: "complete", genlayerStatus: "LEADER_APPEAL_PENDING" })), "No consensus · advisory result only");
    assert.equal(reviewLabel("consensus_disputed", null), "No consensus · advisory result only");
  });

  it("distinguishes a canceled transaction from a failed evaluation", () => {
    assert.equal(reviewLabel("evaluating", job({ status: "transaction_failed" })), "Review transaction canceled");
    assert.equal(reviewLabel("evaluating", job({ status: "evaluation_unavailable" })), "Finalized · evaluation execution failed");
  });

  it("reports the gap between consensus and open voting", () => {
    assert.equal(reviewLabel("evaluating", job({ status: "relay_failed", genlayerTxHash: "0xabc" })), "Consensus reached · completing voting setup");
    assert.equal(reviewLabel("approved_for_voting", job({ status: "complete" })), "Consensus reached · completing voting setup");
    assert.equal(reviewLabel("evaluating", job({ status: "complete", genlayerStatus: "ACCEPTED" })), "Consensus reached · awaiting finality");
  });

  it("separates a queued review from one under way", () => {
    assert.equal(reviewLabel("submitted", null), "Awaiting AI Review");
    assert.equal(reviewLabel("evaluating", job({ status: "submitting", genlayerTxHash: "0xabc" })), "Under AI Review");
  });

  it("labels each finalized verdict", () => {
    assert.equal(reviewLabel("active_voting", job({ status: "complete" })), "Finalized · approved for voting");
    assert.equal(reviewLabel("rejected_by_genlayer", null), "Finalized · rejected");
    assert.equal(reviewLabel("corrections_required", null), "Finalized · corrections required");
    assert.equal(reviewLabel("escalated", null), "Finalized · further evidence required");
    assert.equal(reviewLabel("passed", null), "Review finalized");
  });
});
