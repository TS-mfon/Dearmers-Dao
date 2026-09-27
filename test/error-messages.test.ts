import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError, safeError, userMessage } from "../server/_http.js";

/** A viem-style error whose GenVM stderr is buried in error.cause.data.receipt.genvm_result. */
const genvmError = (message: string, stderr: string) =>
  Object.assign(new Error(message), { cause: { data: { receipt: { genvm_result: { stderr } } } } });

describe("safeError", () => {
  it("keeps the diagnostic message for the admin panel", () => {
    assert.equal(safeError(new Error("Transaction reverted")), "Transaction reverted");
  });

  it("surfaces the last line of GenVM stderr", () => {
    const error = genvmError("Evaluation failed", "  loading runner\nTraceback (most recent call last):\nKeyError: 'proposal:42'\n");
    assert.equal(safeError(error), "Evaluation failed Details: KeyError: 'proposal:42'");
  });

  it("does not repeat stderr that the message already contains", () => {
    assert.equal(safeError(genvmError("Failed: KeyError: 'x'", "KeyError: 'x'")), "Failed: KeyError: 'x'");
  });

  it("redacts anything shaped like a transaction hash or private key", () => {
    const hash = `0x${"a".repeat(64)}`;
    assert.equal(safeError(new Error(`Reverted in ${hash}`)), "Reverted in [redacted]");
    assert.ok(!safeError(new Error(`${hash} and ${hash}`)).includes("aaaa"));
  });

  it("caps the message so a traceback cannot flood a response", () => {
    assert.equal(safeError(new Error("x".repeat(600))).length, 300);
  });

  it("falls back for a thrown non-error", () => {
    assert.equal(safeError("boom"), "Unexpected server error");
    assert.equal(safeError(undefined), "Unexpected server error");
  });
});

describe("userMessage", () => {
  it("passes an HttpError through verbatim, since those are written for members", () => {
    assert.equal(userMessage(new HttpError(403, "This request must originate from the application.")), "This request must originate from the application.");
  });

  it("explains validator capacity as an automatic retry", () => {
    const expected = "GenLayer validators are at capacity right now. This review will retry automatically.";
    for (const raw of ["Server busy: all 8 execution slots occupied", "all execution slots occupied", "Please retry later", "rate limit exceeded", "Too many requests", "status 429"])
      assert.equal(userMessage(new Error(raw)), expected, raw);
  });

  it("explains a transport failure as an automatic retry", () => {
    const expected = "GenLayer was temporarily unreachable. This review will retry automatically.";
    for (const raw of ["request timeout", "socket hang up", "ETIMEDOUT", "ECONNRESET", "fetch failed", "HTTP 502", "HTTP 503", "HTTP 504"])
      assert.equal(userMessage(new Error(raw)), expected, raw);
  });

  it("explains an unreadable finalized verdict as a retryable review", () => {
    const expected = "GenLayer finalized this review but its stored verdict could not be read. Retry the review to run a fresh evaluation.";
    assert.equal(userMessage(genvmError("Evaluation failed", "KeyError: 'proposal:42'")), expected);
    assert.equal(userMessage(new Error("execution failed")), expected);
  });

  it("explains a misconfigured platform service without naming it", () => {
    const expected = "A platform service is not fully configured yet. The team has been notified.";
    assert.equal(userMessage(new Error("RESEND_API_KEY is not configured")), expected);
    assert.equal(userMessage(new Error("The gmail.com domain is not verified")), expected);
  });

  it("falls back to a generic retry sentence", () => {
    assert.equal(userMessage(new Error("something entirely unexpected")), "This review could not be completed. Retry, or contact the DAO stewards if it keeps failing.");
  });

  // Regression guard: this is the split that keeps Python tracebacks and viem
  // wrappers out of the product UI while the admin panel still sees them.
  it("never leaks internal exception text that safeError does expose", () => {
    const error = genvmError("Internal JSON-RPC error", "Traceback (most recent call last):\n  File \"/genvm/runner.py\", line 118\nKeyError: 'proposal:42'");
    assert.ok(safeError(error).includes("KeyError"));
    const message = userMessage(error);
    for (const leak of ["KeyError", "Traceback", "runner.py", "JSON-RPC", "genvm"])
      assert.ok(!message.toLowerCase().includes(leak.toLowerCase()), `leaked ${leak}`);
  });
});
