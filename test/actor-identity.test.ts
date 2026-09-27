import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actorLabel, isIdentity } from "../server/_profiles.js";

describe("isIdentity", () => {
  it("recognizes a Privy DID in both spellings", () => {
    assert.equal(isIdentity("did:privy:clz9k1x0m000008l3g4h5i6j7"), true);
    assert.equal(isIdentity("privy:did:privy:clz9k1x0m000008l3g4h5i6j7"), true);
  });

  it("does not treat a wallet address as an identity", () => {
    assert.equal(isIdentity("0xEd9EDd8586b20524CafA4F568413C504C9B03172"), false);
  });

  it("does not treat an absent actor as an identity", () => {
    assert.equal(isIdentity(""), false);
    assert.equal(isIdentity(null), false);
    assert.equal(isIdentity(undefined), false);
  });

  it("does not match a bare colon or an unrelated prefix", () => {
    assert.equal(isIdentity("protocol:password"), false);
    assert.equal(isIdentity("dao:123"), false);
  });
});

describe("actorLabel", () => {
  it("prefers a display name, then a username", () => {
    assert.equal(actorLabel({ displayName: "Mfon", username: "mfon", avatarUrl: "" }), "Mfon");
    assert.equal(actorLabel({ displayName: "", username: "mfon", avatarUrl: "" }), "mfon");
  });

  it("truncates a wallet when there is no profile", () => {
    assert.equal(actorLabel(undefined, "0xEd9EDd8586b20524CafA4F568413C504C9B03172"), "0xEd9E…3172");
  });

  // Regression guard: a DID reaching this function must not be rendered as the label.
  it("never renders a Privy DID, even when one arrives in the wallet position", () => {
    const label = actorLabel(undefined, "did:privy:clz9k1x0m000008l3g4h5i6j7");
    assert.equal(label, "DAO member");
    assert.ok(!label.includes("did:"));
  });

  it("falls back to a generic label with nothing to go on", () => {
    assert.equal(actorLabel(undefined, null), "DAO member");
    assert.equal(actorLabel({ displayName: "", username: "", avatarUrl: "" }, ""), "DAO member");
  });

  it("does not truncate something that is not a wallet address", () => {
    assert.equal(actorLabel(undefined, "0xnot-a-wallet"), "DAO member");
    assert.equal(actorLabel(undefined, "protocol:password"), "DAO member");
  });
});
