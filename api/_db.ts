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
    await Promise.all([
      db.collection("profiles").createIndex({ wallet: 1 }, { unique: true }),
      db.collection("profiles").createIndex({ username: 1 }),
      db.collection("profiles").createIndex({ identity: 1 }, { unique: true, sparse: true }),
      db.collection("daoIndex").createIndex({ daoId: 1 }, { unique: true }),
      db.collection("daoIndex").createIndex({ name: 1, category: 1 }),
      db.collection("follows").createIndex({ follower: 1, target: 1 }, { unique: true }),
      db.collection("bookmarks").createIndex({ follower: 1, target: 1 }, { unique: true }),
      db.collection("notifications").createIndex({ wallet: 1, createdAt: -1 }),
      db.collection("announcements").createIndex({ daoId: 1, createdAt: -1 }),
      db.collection("assetMetadata").createIndex({ chain: 1, address: 1 }, { unique: true }),
      db.collection("adminAuditLog").createIndex({ createdAt: -1 }),
    ]).then(() => undefined);
  })();
  await indexesPromise;
  return db;
}
