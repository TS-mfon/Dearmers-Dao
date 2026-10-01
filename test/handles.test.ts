import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GENERATED_PREFIX,
  HANDLE_MAX,
  HANDLE_MIN,
  RESERVED_HANDLES,
  disambiguateHandle,
  generatedHandle,
  handleProblem,
  isGeneratedHandle,
  isValidHandle,
  normalizeHandle,
  sanitizeUsername,
} from "../shared/profile.js";

const bytes = (...values: number[]) => new Uint8Array(values.length ? values : new Array(16).fill(0));

describe("sanitizeUsername", () => {
  it("keeps the member's own casing but drops anything the server would strip", () => {
    assert.equal(sanitizeUsername("Mfon_Builds-1"), "Mfon_Builds-1");
    // The onboarding placeholder used to suggest "mfon.builds", whose dot silently disappeared.
    assert.equal(sanitizeUsername("mfon.builds"), "mfonbuilds");
    assert.equal(sanitizeUsername("a b c"), "abc");
    assert.equal(sanitizeUsername("émoji🙂"), "moji");
  });

  it("truncates to the same length the server stores", () => {
    assert.equal(sanitizeUsername("x".repeat(80)).length, HANDLE_MAX);
  });

  it("survives every absent value without throwing", () => {
    for (const value of [null, undefined, 0, false, {}, []]) assert.equal(typeof sanitizeUsername(value), "string");
  });
});

describe("normalizeHandle", () => {
  it("case-folds, so two members cannot claim the same name in different cases", () => {
    assert.equal(normalizeHandle("Mfon"), "mfon");
    assert.equal(normalizeHandle("MFON"), normalizeHandle("mfon"));
  });

  it("is idempotent, so re-running the backfill cannot drift", () => {
    for (const value of ["Mfon", "mfon.builds", "  spaced  ", "A".repeat(80)]) {
      assert.equal(normalizeHandle(normalizeHandle(value)), normalizeHandle(value));
    }
  });
});

describe("isValidHandle", () => {
  it("accepts an ordinary handle", () => {
    for (const handle of ["mfon", "mfon-builds", "mfon_1", "a1b", "x".repeat(HANDLE_MAX)]) assert.ok(isValidHandle(handle), handle);
  });

  it("rejects anything that would not round-trip through a URL segment", () => {
    for (const handle of ["", "ab", "Mfon", "mfon.builds", "-mfon", "mfon-", "_mfon", "mfon_", "x".repeat(HANDLE_MAX + 1), "a b"]) {
      assert.equal(isValidHandle(handle), false, handle);
    }
  });

  // A member holding these would shadow a route or impersonate the platform.
  it("rejects every reserved handle", () => {
    for (const reserved of RESERVED_HANDLES) assert.equal(isValidHandle(reserved), false, reserved);
    assert.ok(RESERVED_HANDLES.includes("identity"), "the retired DID route segment must stay reserved");
    assert.ok(RESERVED_HANDLES.includes("u"), "the handle route prefix must stay reserved");
  });

  /**
   * These two functions have different domains and must not be confused: `handleProblem` judges
   * what a member typed, while `isValidHandle` judges an already-normalized handle. The safety
   * property is one-way -- anything the UI accepts must normalize to a valid handle -- and it is
   * deliberately not an iff: "mfon.builds" normalizes to the valid "mfonbuilds", but accepting it
   * silently would be the same silent reshaping this work exists to remove.
   */
  it("guarantees that anything handleProblem accepts normalizes to a valid handle", () => {
    for (const username of ["mfon", "Mfon", "MFON", "mfon-builds", "mfon_1", "a1b", "", "ab", "admin", "Admin", "mfon.builds", "-mfon", "x".repeat(HANDLE_MAX + 1)]) {
      if (handleProblem(username) === "") assert.ok(isValidHandle(normalizeHandle(username)), `accepted ${username} but its handle is invalid`);
    }
  });

  it("refuses input it would have to reshape, instead of quietly reshaping it", () => {
    assert.match(handleProblem("mfon.builds"), /only contain/i);
    assert.ok(isValidHandle(normalizeHandle("mfon.builds")), "the normalized form is valid, so only the silent reshape is refused");
  });

  it("treats a mixed-case username as acceptable input whose handle is lowercase", () => {
    assert.equal(handleProblem("Mfon"), "");
    assert.equal(isValidHandle("Mfon"), false);
    assert.equal(normalizeHandle("Mfon"), "mfon");
    assert.ok(isValidHandle(normalizeHandle("Mfon")));
  });
});

describe("handleProblem", () => {
  it("explains each refusal in a sentence a member can act on", () => {
    assert.match(handleProblem(""), /letters, numbers/i);
    assert.match(handleProblem("ab"), new RegExp(`${HANDLE_MIN} characters`));
    assert.match(handleProblem("mfon.builds"), /only contain/i);
    assert.match(handleProblem("-mfon"), /start and end/i);
    assert.match(handleProblem("admin"), /reserved/i);
    assert.equal(handleProblem("mfon"), "");
  });

  it("never leaks an internal term into the sentence", () => {
    for (const handle of ["", "ab", "admin", "-mfon", "mfon.builds", "x".repeat(99)]) {
      const problem = handleProblem(handle).toLowerCase();
      for (const leak of ["privy", "did:", "mongo", "regex", "undefined", "null"]) assert.ok(!problem.includes(leak), `${handle} leaked ${leak}`);
    }
  });
});

describe("generatedHandle", () => {
  it("derives the handle only from the supplied random bytes", () => {
    const first = generatedHandle(bytes(1, 2, 3, 4, 5, 6, 7));
    assert.equal(first, generatedHandle(bytes(1, 2, 3, 4, 5, 6, 7)));
    assert.notEqual(first, generatedHandle(bytes(9, 8, 7, 6, 5, 4, 3)));
  });

  // This is the whole point of generating rather than deriving: a handle that encoded the DID,
  // email, or wallet would reinstate exactly the leak that retiring the DID route key closes.
  it("cannot encode a DID, email, or wallet, because it never receives one", () => {
    const handle = generatedHandle(bytes(...new Array(16).fill(0).map((_, index) => index * 7 % 256)));
    assert.ok(isValidHandle(handle), handle);
    assert.ok(isGeneratedHandle(handle), handle);
    assert.equal(generatedHandle.length, 1, "generatedHandle must take random bytes and nothing else");
    for (const secret of ["did", "privy", "0x", "@", "gmail"]) assert.ok(!handle.includes(secret), `generated handle contained ${secret}`);
  });

  it("produces something readable aloud: no 0, 1, i, l, or o", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const suffix = generatedHandle(bytes(...new Array(16).fill(seed))).slice(GENERATED_PREFIX.length);
      for (const ambiguous of ["0", "1", "i", "l", "o"]) assert.ok(!suffix.includes(ambiguous), `seed ${seed} produced ${ambiguous}`);
    }
  });

  it("refuses to run on too little entropy rather than producing a short handle", () => {
    assert.throws(() => generatedHandle(bytes(1, 2)), /random bytes/);
  });
});

describe("disambiguateHandle", () => {
  it("lets the first claimant keep the bare handle", () => {
    assert.equal(disambiguateHandle("dave", new Set()), "dave");
  });

  // The backfill walks profiles in _id order, so this is what decides who gets renamed.
  it("suffixes later claimants in a stable, gapless order", () => {
    const taken = new Set<string>();
    const assigned = ["dave", "dave", "dave", "dave"].map((base) => {
      const handle = disambiguateHandle(base, taken);
      taken.add(handle);
      return handle;
    });
    assert.deepEqual(assigned, ["dave", "dave-2", "dave-3", "dave-4"]);
  });

  it("is deterministic: the same input set yields the same output", () => {
    const first = disambiguateHandle("dave", new Set(["dave", "dave-2"]));
    const second = disambiguateHandle("dave", new Set(["dave-2", "dave"]));
    assert.equal(first, "dave-3");
    assert.equal(second, "dave-3");
  });

  it("keeps a suffixed handle inside the length limit and still valid", () => {
    const base = "x".repeat(HANDLE_MAX);
    const handle = disambiguateHandle(base, new Set([base]));
    assert.ok(handle.length <= HANDLE_MAX, `${handle} is ${handle.length} characters`);
    assert.ok(isValidHandle(handle), handle);
  });

  it("never returns a handle that was already taken", () => {
    const taken = new Set(["dave", "dave-2", "dave-3", "dave-4", "dave-5"]);
    const handle = disambiguateHandle("dave", taken);
    assert.ok(!taken.has(handle));
    assert.equal(handle, "dave-6");
  });
});
