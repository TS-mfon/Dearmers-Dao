import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { PROFILE_LIMITS } from "../shared/profile.js";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * The server truncates every profile field on write. The editor used to render bare inputs with no
 * caps and then report "Profile updated and ready for discovery.", so a 900-character bio was
 * silently halved. These tests hold the two sides to one set of numbers.
 */
describe("PROFILE_LIMITS", () => {
  it("covers every field the profile editor can write", () => {
    for (const field of ["username", "displayName", "bio", "website", "github", "location", "timezone", "email", "avatarUrl", "bannerUrl"]) {
      assert.equal(typeof PROFILE_LIMITS[field as keyof typeof PROFILE_LIMITS], "number", `${field} has no limit`);
    }
  });

  it("states positive, plausible caps", () => {
    for (const [field, limit] of Object.entries(PROFILE_LIMITS)) {
      assert.ok(limit > 0 && limit <= 5_000, `${field} limit ${limit} is implausible`);
    }
  });
});

describe("the server truncates through the shared limits", () => {
  const server = source("server/profile.ts");

  it("imports the shared contract rather than restating numbers", () => {
    assert.match(server, /from "\.\.\/shared\/profile\.js"/);
    assert.match(server, /PROFILE_LIMITS/);
  });

  /**
   * The original handler inlined every cap as a `.slice(0, N)` literal. Any literal left behind is
   * a number that can drift away from the client, so none may remain.
   */
  it("leaves no hardcoded truncation literal behind", () => {
    const literals = server.split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => /\.slice\(0, \d+\)/.test(line) && !line.includes("PROFILE_LIMITS"));
    assert.deepEqual(literals.map(({ line, number }) => `${number}: ${line.trim().slice(0, 100)}`), []);
  });

  it("caps each field through the helper, proving the scan is not vacuous", () => {
    assert.match(server, /const capped = \(value: unknown, field: keyof typeof PROFILE_LIMITS\)/);
    const cappedCalls = (server.match(/capped\(/g) || []).length;
    assert.ok(cappedCalls >= 9, `only ${cappedCalls} capped() uses found; the handler has stopped routing fields through it`);
  });
});

describe("the editor caps inputs at the same numbers", () => {
  const page = source("src/pages/ProfilePage.tsx");
  const app = source("src/App.tsx");

  it("imports the shared contract instead of restating numbers", () => {
    assert.match(page, /from "\.\.\/\.\.\/shared\/profile"/);
    assert.match(app, /from "\.\.\/shared\/profile"/);
  });

  // The editor's JSX is one long line, so this counts occurrences rather than lines.
  it("passes a limit to every Field in the editor", () => {
    const fields = page.split("<Field ").slice(1).map((segment) => segment.slice(0, segment.indexOf("/>")));
    assert.ok(fields.length >= 6, `only ${fields.length} Field uses found; the scan has stopped matching`);
    for (const field of fields) assert.match(field, /limit=\{PROFILE_LIMITS\./, `a Field renders without a limit: ${field.slice(0, 120)}`);
  });

  it("gives the Field component a real maxLength rather than only a counter", () => {
    assert.match(page, /maxLength=\{limit\}/);
    assert.equal((page.match(/maxLength=\{limit\}/g) || []).length, 2, "both the input and the textarea need the cap");
  });

  it("caps the onboarding handle input too", () => {
    assert.match(app, /maxLength=\{PROFILE_LIMITS\.username\}/);
  });

  /**
   * The onboarding placeholder suggested "mfon.builds". The server strips the dot, so a member's
   * very first handle silently became "mfonbuilds" -- the exact class of defect this closes.
   */
  it("does not suggest a handle the server would reshape", () => {
    const placeholders = [...app.matchAll(/placeholder="([^"]*)"/g), ...page.matchAll(/placeholder="([^"]*)"/g)].map((match) => match[1]);
    const handlePlaceholders = placeholders.filter((value) => /handle|username|mfon/i.test(value));
    assert.ok(handlePlaceholders.length > 0, "no handle placeholder was found; the scan has stopped matching");
    for (const value of handlePlaceholders) {
      const suggestion = value.replace(/^e\.g\.\s*/, "");
      assert.ok(!/[^a-zA-Z0-9_\- ]/.test(suggestion), `placeholder "${value}" suggests characters the server strips`);
    }
  });

  it("blocks the onboarding submit on a handle the server would refuse", () => {
    assert.match(app, /disabled=\{saving \|\| Boolean\(handleProblem\(handle\)\)/);
  });
});
