import { MongoClient, type Db } from "mongodb";

let clientPromise: Promise<MongoClient> | undefined;
let indexesPromise: Promise<void> | undefined;

export async function database(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  clientPromise ||= new MongoClient(uri).connect();
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "dearmers_dao");
  indexesPromise ||= (async () => {
    const profiles = db.collection("profiles");
    await profiles.updateMany({ wallet: null }, { $unset: { wallet: "" } });
    await profiles.dropIndex("wallet_1").catch(() => undefined);
    await Promise.all([
      profiles.createIndex({ wallet: 1 }, { unique: true, partialFilterExpression: { wallet: { $type: "string" } } }),
      profiles.createIndex({ username: 1 }),
      profiles.createIndex({ identity: 1 }, { unique: true, sparse: true }),
      db.collection("daoIndex").createIndex({ daoId: 1 }, { unique: true }),
      db.collection("daoIndex").createIndex({ name: 1, category: 1 }),
      db.collection("follows").dropIndex("follower_1_target_1").catch(() => undefined).then(() => db.collection("follows").dropIndex("actor_1_target_1").catch(() => undefined)).then(() => db.collection("follows").createIndex({ actor: 1, target: 1, targetType: 1 }, { unique: true })),
      db.collection("bookmarks").dropIndex("follower_1_target_1").catch(() => undefined).then(() => db.collection("bookmarks").dropIndex("actor_1_target_1").catch(() => undefined)).then(() => db.collection("bookmarks").createIndex({ actor: 1, target: 1, targetType: 1 }, { unique: true })),
      db.collection("notifications").createIndex({ wallet: 1, createdAt: -1 }),
      db.collection("announcements").createIndex({ daoId: 1, createdAt: -1 }),
      db.collection("assetMetadata").createIndex({ chain: 1, address: 1 }, { unique: true }),
      db.collection("adminAuditLog").createIndex({ createdAt: -1 }),
      db.collection("daoMembers").createIndex({ daoId: 1, actor: 1 }, { unique: true }),
      db.collection("membershipApplications").createIndex({ daoId: 1, actor: 1 }, { unique: true }),
      db.collection("chatMessages").createIndex({ daoId: 1, createdAt: -1 }),
      db.collection("grants").createIndex({ slug: 1 }, { unique: true }),
      db.collection("grantApplications").createIndex({ grantId: 1, actor: 1 }, { unique: true }),
      db.collection("proposalIntents").createIndex({ proposalKey: 1, actor: 1 }, { unique: true }),
      db.collection("emailJobs").createIndex({ eventKey: 1 }, { unique: true }),
      db.collection("auditLogs").createIndex({ scopeId: 1, createdAt: -1 }),
      db.collection("media.files").createIndex({ "metadata.scope": 1, "metadata.resourceId": 1, "metadata.purpose": 1 }),
    ]).then(() => undefined);
  })();
  await indexesPromise;
  return db;
}
