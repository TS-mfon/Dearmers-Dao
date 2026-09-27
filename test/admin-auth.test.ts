import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { VercelRequest } from "@vercel/node";
import { adminWallets, digest, requireSameOrigin, verifyPassword } from "../server/_admin-session.js";
import { HttpError } from "../server/_http.js";

const request = (headers: Record<string, string>) => ({ headers }) as unknown as VercelRequest;
const encode = (password: string, salt = "a".repeat(32)) => `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;

describe("adminWallets", () => {
  afterEach(() => { delete process.env.ADMIN_WALLETS; });

  it("is empty when the allowlist is unset, so no wallet is an admin by default", () => {
    delete process.env.ADMIN_WALLETS;
    assert.equal(adminWallets().size, 0);
  });

  it("lowercases the allowlist so a checksummed address still matches", () => {
    process.env.ADMIN_WALLETS = "0xEd9EDd8586b20524CafA4F568413C504C9B03172";
    assert.ok(adminWallets().has("0xed9edd8586b20524cafa4f568413c504c9b03172"));
  });

  it("tolerates padding and empty entries in the allowlist", () => {
    process.env.ADMIN_WALLETS = " 0xAAA , ,0xBBB,,";
    assert.deepEqual([...adminWallets()].sort(), ["0xaaa", "0xbbb"]);
  });

  it("does not admit a wallet that is merely a prefix of an allowlisted one", () => {
    process.env.ADMIN_WALLETS = "0xed9edd8586b20524cafa4f568413c504c9b03172";
    assert.equal(adminWallets().has("0xed9edd"), false);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    assert.equal(verifyPassword("correct horse battery staple", encode("correct horse battery staple")), true);
  });

  it("rejects a wrong password", () => {
    assert.equal(verifyPassword("wrong", encode("correct horse battery staple")), false);
  });

  it("rejects an encoding that does not name scrypt", () => {
    const [, salt, hash] = encode("pw").split(":");
    assert.equal(verifyPassword("pw", `md5:${salt}:${hash}`), false);
    assert.equal(verifyPassword("pw", `${salt}:${hash}`), false);
  });

  it("rejects a malformed salt or hash rather than throwing", () => {
    const valid = encode("pw");
    const [, , hash] = valid.split(":");
    assert.equal(verifyPassword("pw", `scrypt:tooshort:${hash}`), false);
    assert.equal(verifyPassword("pw", `scrypt:${"a".repeat(32)}:deadbeef`), false);
    assert.equal(verifyPassword("pw", "scrypt::"), false);
    assert.equal(verifyPassword("pw", ""), false);
  });

  it("rejects an oversized password instead of paying to hash it", () => {
    assert.equal(verifyPassword("x".repeat(257), encode("x".repeat(257))), false);
  });
});

describe("requireSameOrigin", () => {
  afterEach(() => { delete process.env.APP_ORIGIN; });

  it("rejects a request with no Origin header", () => {
    assert.throws(() => requireSameOrigin(request({ host: "dreamersdao.me" })), (error: unknown) => error instanceof HttpError && error.status === 403);
  });

  it("rejects a cross-origin request", () => {
    assert.throws(() => requireSameOrigin(request({ host: "dreamersdao.me", origin: "https://evil.example" })), HttpError);
  });

  it("accepts a same-origin request, assuming https for a deployed host", () => {
    requireSameOrigin(request({ host: "dreamersdao.me", origin: "https://dreamersdao.me" }));
  });

  it("assumes http for a localhost host so local development works", () => {
    requireSameOrigin(request({ host: "localhost:5173", origin: "http://localhost:5173" }));
    assert.throws(() => requireSameOrigin(request({ host: "localhost:5173", origin: "https://localhost:5173" })), HttpError);
  });

  it("prefers an explicitly configured origin over the request host", () => {
    process.env.APP_ORIGIN = "https://dreamersdao.me";
    requireSameOrigin(request({ host: "dearmers.vercel.app", origin: "https://dreamersdao.me" }));
    assert.throws(() => requireSameOrigin(request({ host: "dearmers.vercel.app", origin: "https://dearmers.vercel.app" })), HttpError);
  });
});

describe("digest", () => {
  it("is a stable sha256, so a session cookie is never stored in the clear", () => {
    assert.equal(digest("token"), "3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0");
    assert.notEqual(digest("token"), "token");
  });
});
