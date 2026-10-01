import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { escapeRegex, searchPattern, searchTerm } from "../server/_http.js";

const serverDir = new URL("../server/", import.meta.url);
const serverFiles = readdirSync(serverDir).filter((name) => name.endsWith(".ts"));
const read = (name: string) => readFileSync(new URL(name, serverDir), "utf8");

describe("escapeRegex", () => {
  it("neutralizes every metacharacter a search box can carry", () => {
    for (const metacharacter of [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]) {
      const pattern = new RegExp(escapeRegex(metacharacter));
      assert.ok(pattern.test(metacharacter), `${metacharacter} should match itself literally`);
    }
  });

  it("makes an unbalanced group a literal instead of a syntax error", () => {
    // `?q=(` was a 500 from /api/daos and /api/social before this helper was used there.
    assert.doesNotThrow(() => new RegExp(escapeRegex("(")));
    assert.ok(new RegExp(escapeRegex("(")).test("a(b"));
  });

  it("stops a wildcard from matching everything", () => {
    assert.equal(new RegExp(escapeRegex(".*")).test("anything"), false);
    assert.ok(new RegExp(escapeRegex(".*")).test("literal.*here"));
  });

  it("defuses a catastrophic backtracking pattern", () => {
    const hostile = "(a+)+$";
    const pattern = new RegExp(escapeRegex(hostile));
    const started = Date.now();
    assert.equal(pattern.test(`${"a".repeat(2_000)}b`), false);
    assert.ok(Date.now() - started < 1_000, "an escaped pattern must not backtrack");
  });
});

describe("searchTerm", () => {
  it("trims and bounds the query so a huge value cannot reach Mongo", () => {
    assert.equal(searchTerm("  mfon  "), "mfon");
    assert.equal(searchTerm("x".repeat(500)).length, 80);
    assert.equal(searchTerm("x".repeat(500), 10).length, 10);
  });

  it("returns an empty string for every absent value", () => {
    for (const value of [null, undefined, "", "   ", 0, false]) assert.equal(searchTerm(value), String(value ?? "").trim().slice(0, 80));
    for (const value of [null, undefined, "", "   "]) assert.equal(searchTerm(value), "");
  });
});

describe("searchPattern", () => {
  it("returns null for an empty term so callers branch instead of matching everything", () => {
    for (const value of [null, undefined, "", "   "]) assert.equal(searchPattern(value), null);
  });

  it("builds a case-insensitive literal matcher", () => {
    const pattern = searchPattern("MFON");
    assert.ok(pattern?.test("mfon builds"));
    assert.equal(pattern?.flags.includes("i"), true);
  });

  it("escapes the term it was given", () => {
    const pattern = searchPattern("a.c");
    assert.ok(pattern?.test("a.c"));
    assert.equal(pattern?.test("abc"), false);
  });
});

/**
 * Absence assertions. Both scanners below are also exercised against a planted positive control in
 * the same test, because a scanner whose filter matches nothing passes vacuously -- which is how an
 * absence check silently stops protecting anything.
 */
describe("no handler builds a regex from request input", () => {
  const rawRegexLine = /new RegExp\(/;

  it("finds the one legitimate construction site, proving the scan can see the pattern at all", () => {
    const owners = serverFiles.filter((name) => rawRegexLine.test(read(name)));
    assert.deepEqual(owners, ["_http.ts"], `expected only _http.ts to construct a RegExp, got ${owners.join(", ")}`);
  });

  it("finds no other construction site anywhere in server/", () => {
    for (const name of serverFiles.filter((file) => file !== "_http.ts")) {
      for (const [index, line] of read(name).split("\n").entries()) {
        assert.ok(!rawRegexLine.test(line), `${name}:${index + 1} builds a RegExp directly: ${line.trim().slice(0, 120)}`);
      }
    }
  });

  it("fails on a planted violation rather than reporting clean", () => {
    const planted = 'const expression = new RegExp(query, "i");';
    assert.ok(rawRegexLine.test(planted), "the scanner must match the exact shape it is meant to forbid");
  });

  it("covers a meaningful number of files, so the scan cannot pass by reading nothing", () => {
    assert.ok(serverFiles.length > 30, `only ${serverFiles.length} server files were scanned`);
  });
});
