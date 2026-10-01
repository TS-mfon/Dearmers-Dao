import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError, creationMessage, safeError, userMessage } from "../server/_http.js";
import { tokenError } from "../server/_privy.js";

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

/** jose attaches a `code` to every verification failure; that code is the whole classification. */
const joseError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("tokenError", () => {
  it("turns an expired Privy token into a 401 a member can act on", () => {
    const mapped = tokenError(joseError("ERR_JWT_EXPIRED", '"exp" claim timestamp check failed'));
    assert.equal(mapped.status, 401);
    assert.equal(mapped.message, "Your session expired. Sign in again.");
  });

  /**
   * Regression guard for the defect this replaces: jose threw a raw JWTExpired, which is not an
   * HttpError, so errorResponse answered 500 and safeError showed the member jose's own wording.
   * Privy access tokens are short-lived, so every tab left open hit it.
   */
  it("never lets jose's internal wording reach the member", () => {
    for (const code of ["ERR_JWT_EXPIRED", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWS_INVALID", "ERR_JWKS_NO_MATCHING_KEY"]) {
      const mapped = tokenError(joseError(code, '"exp" claim timestamp check failed: signature verification failed'));
      assert.equal(mapped.status, 401, code);
      // "exp" is not in this list on purpose: it is a substring of the legitimate word "expired".
      for (const leak of ['"exp"', "claim", "signature", "timestamp", "jws", "jwks", "jose", "ERR_", "verification failed"]) {
        assert.ok(!mapped.message.toLowerCase().includes(leak.toLowerCase()), `${code} leaked ${leak}`);
      }
    }
  });

  /**
   * A JWKS outage is deliberately not a 401: telling someone to sign in again cannot fix our
   * network, and it would log them out of a working session over a transient fetch failure.
   */
  it("reports a JWKS outage as 503 rather than blaming the member's session", () => {
    for (const code of ["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JWKS_MULTIPLE_MATCHING_KEYS"]) {
      assert.equal(tokenError(joseError(code, "fetch failed")).status, 503, code);
    }
    assert.equal(tokenError(new Error("fetch failed")).status, 503);
  });

  it("passes an HttpError through untouched, since those are already written for members", () => {
    const original = new HttpError(401, "Your session is missing an account. Sign in again.");
    assert.equal(tokenError(original), original);
  });

  it("classifies a stale key id as a rejected token, not an outage", () => {
    assert.equal(tokenError(joseError("ERR_JWKS_NO_MATCHING_KEY", "no applicable key found")).status, 401);
  });

  it("never returns a 500, because no verification failure is a server bug", () => {
    for (const error of [joseError("ERR_JWT_EXPIRED", "x"), joseError("ERR_JWKS_TIMEOUT", "x"), new Error("x"), "x", null, undefined]) {
      const status = tokenError(error).status;
      assert.ok(status === 401 || status === 503, `got ${status}`);
    }
  });
});

describe("creationMessage", () => {
  it("passes a member-readable HttpError through verbatim", () => {
    assert.equal(creationMessage(new HttpError(409, "Registry identity does not match the creation request.")), "Registry identity does not match the creation request.");
  });

  it("attributes a transport failure to Base, not to GenLayer", () => {
    const expected = "Base was temporarily unreachable while creating this DAO. Retry — your progress is saved.";
    for (const raw of ["request timeout", "socket hang up", "ETIMEDOUT", "fetch failed", "HTTP 503", "nonce too low"]) {
      assert.equal(creationMessage(new Error(raw)), expected, raw);
    }
    assert.ok(!creationMessage(new Error("request timeout")).includes("GenLayer"));
  });

  it("explains a relayer funding failure without naming a signer", () => {
    const message = creationMessage(new Error("insufficient funds for intrinsic transaction cost"));
    assert.match(message, /could not fund/i);
    for (const leak of ["0x", "private", "key", "signer"]) assert.ok(!message.toLowerCase().includes(leak), `leaked ${leak}`);
  });

  /**
   * Regression guard: _dao-creation.ts stored only `error`, and the status page rendered it as the
   * page's lede, so a raw viem wrapper was the first thing a member read after creating a DAO.
   */
  it("never leaks internal exception text that safeError does expose", () => {
    const error = Object.assign(new Error("Internal JSON-RPC error"), { cause: { data: { receipt: { genvm_result: { stderr: "Traceback (most recent call last):\nKeyError: 'dao'" } } } } });
    assert.ok(safeError(error).includes("KeyError"));
    const message = creationMessage(error);
    for (const leak of ["KeyError", "Traceback", "JSON-RPC", "genvm"]) assert.ok(!message.toLowerCase().includes(leak.toLowerCase()), `leaked ${leak}`);
  });

  it("falls back to a creation-specific sentence rather than a review one", () => {
    const message = creationMessage(new Error("something entirely unexpected"));
    assert.match(message, /DAO creation/);
    assert.ok(!message.includes("review"));
  });
});
