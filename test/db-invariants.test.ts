import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoClient, type Db } from "mongodb";

/**
 * Integration tests for the uniqueness invariants MongoDB enforces for us. These run only
 * when MONGODB_URI is set, and always against an isolated `*_indextest` database that is
 * dropped afterwards — never against `dearmers_dao` or whatever MONGODB_DB names.
 *
 * The index definitions below mirror `server/_db.ts`. They are duplicated rather than
 * imported because `database()` resolves its own database name and would write to the real
 * one. If you change an index in `server/_db.ts`, change it here too.
 */

const uri = process.env.MONGODB_URI;
const skip = uri ? false : "set MONGODB_URI to run database invariant tests";
const productionName = process.env.MONGODB_DB || "dearmers_dao";
const testName = `${productionName}_indextest`;

let client: MongoClient | undefined;
let db: Db;

const duplicateKey = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
const expectDuplicate = async (write: () => Promise<unknown>, what: string) => {
  await assert.rejects(write, duplicateKey, `${what} should have been rejected as a duplicate`);
};

before(async () => {
  if (!uri) return;
  assert.ok(testName.endsWith("_indextest") && testName !== productionName, "refusing to run against a non-test database");
  client = await new MongoClient(uri).connect();
  db = client.db(testName);
  await db.dropDatabase();
  await Promise.all([
    db.collection("profiles").createIndex({ wallet: 1 }, { unique: true, partialFilterExpression: { wallet: { $type: "string" } } }),
    db.collection("profiles").createIndex({ identity: 1 }, { unique: true, sparse: true }),
    db.collection("follows").createIndex({ actor: 1, target: 1, targetType: 1 }, { unique: true }),
    db.collection("bookmarks").createIndex({ actor: 1, target: 1, targetType: 1 }, { unique: true }),
    db.collection("proposalVotes").createIndex({ proposalId: 1, wallet: 1 }, { unique: true, partialFilterExpression: { wallet: { $type: "string" } } }),
    db.collection("proposalJobs").createIndex({ proposalId: 1 }, { unique: true }),
    db.collection("grantJobs").createIndex({ applicationId: 1 }, { unique: true }),
    db.collection("grantApplications").createIndex({ grantId: 1, actor: 1 }, { unique: true }),
    db.collection("daoMembers").createIndex({ daoId: 1, actor: 1 }, { unique: true }),
    db.collection("membershipApplications").createIndex({ daoId: 1, actor: 1 }, { unique: true }),
    db.collection("emailJobs").createIndex({ eventKey: 1 }, { unique: true }),
    db.collection("executionJobs").createIndex({ executionKey: 1 }, { unique: true }),
    db.collection("media.files").createIndex({ "metadata.scope": 1, "metadata.resourceId": 1, "metadata.purpose": 1 }),
  ]);
});

after(async () => {
  if (!client) return;
  await db.dropDatabase();
  await client.close();
});

describe("profile uniqueness", { skip }, () => {
  it("rejects a second profile for the same wallet", async () => {
    await db.collection("profiles").insertOne({ wallet: "0xaaa", identity: "privy:did:privy:a" });
    await expectDuplicate(() => db.collection("profiles").insertOne({ wallet: "0xaaa", identity: "privy:did:privy:b" }), "a duplicate wallet");
  });

  it("rejects a second profile for the same Privy identity", async () => {
    await db.collection("profiles").insertOne({ wallet: "0xbbb", identity: "privy:did:privy:c" });
    await expectDuplicate(() => db.collection("profiles").insertOne({ wallet: "0xccc", identity: "privy:did:privy:c" }), "a duplicate identity");
  });

  // This is the E11000 duplicate-null failure the partial index exists to prevent:
  // email-only Privy users have no wallet, and there can be many of them.
  it("allows many wallet-less profiles", async () => {
    await db.collection("profiles").insertMany([{ identity: "privy:did:privy:d" }, { identity: "privy:did:privy:e" }]);
    assert.equal(await db.collection("profiles").countDocuments({ wallet: { $exists: false } }), 2);
  });
});

describe("social action uniqueness", { skip }, () => {
  it("rejects a duplicate follow but allows following a different target type with the same id", async () => {
    await db.collection("follows").insertOne({ actor: "did:privy:a", target: "dao-1", targetType: "dao" });
    await expectDuplicate(() => db.collection("follows").insertOne({ actor: "did:privy:a", target: "dao-1", targetType: "dao" }), "a duplicate follow");
    await db.collection("follows").insertOne({ actor: "did:privy:a", target: "dao-1", targetType: "profile" });
    assert.equal(await db.collection("follows").countDocuments({ actor: "did:privy:a" }), 2);
  });

  it("rejects a duplicate bookmark", async () => {
    await db.collection("bookmarks").insertOne({ actor: "did:privy:a", target: "dao-1", targetType: "dao" });
    await expectDuplicate(() => db.collection("bookmarks").insertOne({ actor: "did:privy:a", target: "dao-1", targetType: "dao" }), "a duplicate bookmark");
  });

  it("keeps follows and bookmarks independent of each other", async () => {
    await db.collection("follows").insertOne({ actor: "did:privy:z", target: "dao-9", targetType: "dao" });
    await db.collection("bookmarks").insertOne({ actor: "did:privy:z", target: "dao-9", targetType: "dao" });
    assert.equal(await db.collection("follows").countDocuments({ actor: "did:privy:z" }), 1);
    assert.equal(await db.collection("bookmarks").countDocuments({ actor: "did:privy:z" }), 1);
  });
});

describe("governance uniqueness", { skip }, () => {
  it("rejects a second vote from the same wallet on the same proposal", async () => {
    await db.collection("proposalVotes").insertOne({ proposalId: "p-1", wallet: "0xaaa", support: true });
    await expectDuplicate(() => db.collection("proposalVotes").insertOne({ proposalId: "p-1", wallet: "0xaaa", support: false }), "a duplicate vote");
  });

  it("allows the same wallet to vote on a different proposal", async () => {
    await db.collection("proposalVotes").insertOne({ proposalId: "p-2", wallet: "0xbbb", support: true });
    await db.collection("proposalVotes").insertOne({ proposalId: "p-3", wallet: "0xbbb", support: true });
    assert.equal(await db.collection("proposalVotes").countDocuments({ wallet: "0xbbb" }), 2);
  });

  it("rejects a second review job for the same proposal, so a stale job cannot be duplicated", async () => {
    await db.collection("proposalJobs").insertOne({ proposalId: "p-4", status: "submitting" });
    await expectDuplicate(() => db.collection("proposalJobs").insertOne({ proposalId: "p-4", status: "queued" }), "a duplicate review job");
  });

  it("rejects a second review job for the same grant application", async () => {
    await db.collection("grantJobs").insertOne({ applicationId: "a-1", status: "submitting" });
    await expectDuplicate(() => db.collection("grantJobs").insertOne({ applicationId: "a-1", status: "queued" }), "a duplicate grant job");
  });

  it("rejects a duplicate grant application from the same actor", async () => {
    await db.collection("grantApplications").insertOne({ grantId: "g-1", actor: "did:privy:a" });
    await expectDuplicate(() => db.collection("grantApplications").insertOne({ grantId: "g-1", actor: "did:privy:a" }), "a duplicate application");
  });

  it("rejects a duplicate execution job, so a treasury transfer cannot run twice", async () => {
    await db.collection("executionJobs").insertOne({ executionKey: "dao-1:p-1" });
    await expectDuplicate(() => db.collection("executionJobs").insertOne({ executionKey: "dao-1:p-1" }), "a duplicate execution job");
  });
});

describe("membership and email uniqueness", { skip }, () => {
  it("rejects duplicate membership records and applications per DAO", async () => {
    await db.collection("daoMembers").insertOne({ daoId: "dao-1", actor: "did:privy:a" });
    await expectDuplicate(() => db.collection("daoMembers").insertOne({ daoId: "dao-1", actor: "did:privy:a" }), "a duplicate membership");
    await db.collection("membershipApplications").insertOne({ daoId: "dao-1", actor: "did:privy:a" });
    await expectDuplicate(() => db.collection("membershipApplications").insertOne({ daoId: "dao-1", actor: "did:privy:a" }), "a duplicate application");
  });

  it("rejects a duplicate email job, so an event cannot send twice", async () => {
    await db.collection("emailJobs").insertOne({ eventKey: "proposal_live:p-1" });
    await expectDuplicate(() => db.collection("emailJobs").insertOne({ eventKey: "proposal_live:p-1" }), "a duplicate email job");
  });
});

describe("media scope isolation", { skip }, () => {
  // A DAO and its creator can share a resource id, and a DAO has both a logo and a banner.
  // Every read must filter on all three of scope, resource, and purpose — never "latest image".
  it("resolves media by scope, resource, and purpose together", async () => {
    const files = db.collection("media.files");
    await files.insertMany([
      { filename: "dao-logo.png", metadata: { scope: "dao", resourceId: "shared-1", purpose: "dao-logo" } },
      { filename: "dao-banner.png", metadata: { scope: "dao", resourceId: "shared-1", purpose: "dao-banner" } },
      { filename: "user-avatar.png", metadata: { scope: "profile", resourceId: "shared-1", purpose: "profile-avatar" } },
      { filename: "user-banner.png", metadata: { scope: "profile", resourceId: "shared-1", purpose: "profile-banner" } },
    ]);

    for (const [scope, purpose, expected] of [
      ["dao", "dao-logo", "dao-logo.png"],
      ["dao", "dao-banner", "dao-banner.png"],
      ["profile", "profile-avatar", "user-avatar.png"],
      ["profile", "profile-banner", "user-banner.png"],
    ]) {
      const found = await files.find({ "metadata.scope": scope, "metadata.resourceId": "shared-1", "metadata.purpose": purpose }).toArray();
      assert.equal(found.length, 1, `${scope}/${purpose} matched ${found.length} files`);
      assert.equal(found[0].filename, expected);
    }
  });

  it("returns nothing rather than another scope's image when a DAO has no logo", async () => {
    const files = db.collection("media.files");
    await files.insertOne({ filename: "creator-avatar.png", metadata: { scope: "profile", resourceId: "dao-no-logo", purpose: "profile-avatar" } });
    const found = await files.find({ "metadata.scope": "dao", "metadata.resourceId": "dao-no-logo", "metadata.purpose": "dao-logo" }).toArray();
    assert.deepEqual(found, [], "a DAO logo lookup must not fall back to the creator's avatar");
  });
});
