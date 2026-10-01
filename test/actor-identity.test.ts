import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  NEVER_PUBLIC_PROFILE_FIELDS,
  OWNER_ONLY_PROFILE_FIELDS,
  actorLabel,
  isIdentity,
  publicDaoProjection,
  publicProfile,
  publicProfileProjection,
} from "../server/_profiles.js";

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

describe("publicDaoProjection", () => {
  it("withholds the founder's Privy DID and the raw object id", () => {
    assert.deepEqual({ ...publicDaoProjection }, { _id: 0, adminIdentity: 0 });
  });

  // Regression guard: /api/daos and /api/search served daoIndex documents with a bare
  // `{ _id: 0 }`, which published `adminIdentity` — the founder's Privy DID — to anyone.
  // Any new client-facing daoIndex read must go through the shared projection.
  it("is used by every daoIndex read that reaches a client", () => {
    for (const file of ["server/daos.ts", "server/search.ts"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const read of source.split("\n").filter((line) => line.includes('collection("daoIndex")') && /\.project\(|projection:/.test(line))) {
        assert.ok(read.includes("publicDaoProjection"), `${file} serves daoIndex without publicDaoProjection: ${read.trim().slice(0, 120)}`);
      }
    }
  });
});

describe("publicProfileProjection", () => {
  it("withholds the member's Privy DID, their email, and their moderation state", () => {
    for (const field of ["identity", "email", "emailVerified", "emailNotifications", "profileVisibility", "banned", "githubProfile", "usernameHistory", "_id"]) {
      assert.equal(publicProfileProjection[field], 0, `${field} is not withheld`);
    }
  });

  it("is built from the same field lists publicProfile redacts, so the two cannot drift", () => {
    const expected = ["_id", ...NEVER_PUBLIC_PROFILE_FIELDS, ...OWNER_ONLY_PROFILE_FIELDS].sort();
    assert.deepEqual(Object.keys(publicProfileProjection).sort(), expected);
    assert.ok(NEVER_PUBLIC_PROFILE_FIELDS.includes("identity"), "the Privy DID must be in the never-public list");
  });

  it("is an exclusion projection, so a new profile field is public by default and never secret by accident", () => {
    assert.deepEqual([...new Set(Object.values(publicProfileProjection))], [0]);
  });
});

describe("publicProfile", () => {
  const document = {
    _id: "abc", identity: "privy:did:privy:clz9k1x0m000008l3g4h5i6j7", handle: "mfon", username: "mfon",
    displayName: "Mfon", wallet: "0xEd9E", email: "person@example.com", emailVerified: true,
    emailNotifications: false, profileVisibility: "private", banned: false,
    githubProfile: { login: "mfon" }, usernameHistory: [{ from: "old", to: "mfon" }],
  };

  it("never returns a Privy DID to a visitor", () => {
    const profile = publicProfile(document);
    assert.equal(profile.identity, undefined);
    assert.equal(JSON.stringify(profile).includes("did:privy"), false);
  });

  it("never returns a Privy DID to the owner either, who already has it from Privy", () => {
    assert.equal(publicProfile(document, true).identity, undefined);
    assert.equal(JSON.stringify(publicProfile(document, true)).includes("did:privy"), false);
  });

  it("withholds the email and moderation trail from a visitor", () => {
    const profile = publicProfile(document);
    for (const field of ["email", "emailVerified", "emailNotifications", "profileVisibility", "banned", "githubProfile", "usernameHistory", "_id"]) {
      assert.equal(profile[field], undefined, `${field} reached a visitor`);
    }
  });

  /**
   * The owner's settings must come back: the editor posts its whole draft, so a response that
   * omitted profileVisibility would silently flip a private profile public on the next save.
   */
  it("returns the owner's own settings so saving a bio cannot reset them", () => {
    const profile = publicProfile(document, true);
    assert.equal(profile.profileVisibility, "private");
    assert.equal(profile.emailNotifications, false);
    assert.equal(profile.email, "person@example.com");
  });

  it("keeps the fields the product actually renders", () => {
    const profile = publicProfile(document);
    assert.equal(profile.handle, "mfon");
    assert.equal(profile.displayName, "Mfon");
    assert.equal(profile.wallet, "0xEd9E");
  });

  it("does not mutate the document it was given", () => {
    const original = { ...document };
    publicProfile(document);
    assert.deepEqual(document, original);
  });
});

/**
 * The absence assertion that matters most. It is paired with a positive control below, because a
 * scanner whose filter matches nothing reports clean forever — which is exactly how the
 * `adminIdentity` leak survived a `{ _id: 0 }` projection in two handlers.
 */
describe("no client-facing profiles read serves a raw document", () => {
  const serverDir = new URL("../server/", import.meta.url);
  const files = readdirSync(serverDir).filter((name) => name.endsWith(".ts"));
  const profileReads = (source: string) => source.split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.includes('collection("profiles")') && /\.find\(|\.findOne\(/.test(line));

  // These reads never reach a client: they build internal join maps or select email recipients.
  const internalOnly = new Set(["_profiles.ts", "reviews.ts", "announcements.ts", "admin.ts", "chat.ts", "profile.ts"]);

  it("sees every profiles read in server/, proving the filter is not vacuous", () => {
    const total = files.reduce((sum, name) => sum + profileReads(readFileSync(new URL(name, serverDir), "utf8")).length, 0);
    assert.ok(total >= 8, `only ${total} profiles reads were found; the scanner filter has stopped matching`);
  });

  it("requires a shared projection on every client-facing read", () => {
    for (const name of files.filter((file) => !internalOnly.has(file))) {
      for (const { line, number } of profileReads(readFileSync(new URL(name, serverDir), "utf8"))) {
        assert.ok(
          /publicProfileProjection|publicProfile\(/.test(line) || /projection: \{ (_id|identity|handle)/.test(line),
          `server/${name}:${number} reads profiles without a shared projection: ${line.trim().slice(0, 140)}`,
        );
      }
    }
  });

  it("fails on a planted violation rather than reporting clean", () => {
    const planted = 'const profiles = await db.collection("profiles").find(filter).project({ _id: 0, email: 0 }).toArray();';
    const reads = profileReads(planted);
    assert.equal(reads.length, 1, "the scanner must see the shape it is meant to forbid");
    assert.equal(/publicProfileProjection|publicProfile\(/.test(reads[0].line), false, "the planted bare projection must not satisfy the rule");
  });

  it("confirms the one route that redacts in code does so through the shared helper", () => {
    const source = readFileSync(new URL("profile.ts", serverDir), "utf8");
    assert.ok(source.includes("publicProfile("), "server/profile.ts must redact through publicProfile()");
    for (const { line, number } of profileReads(source)) {
      assert.ok(!/\.project\(\{ _id: 0, email: 0 \}\)/.test(line), `server/profile.ts:${number} still uses the old bare projection`);
    }
  });
});
