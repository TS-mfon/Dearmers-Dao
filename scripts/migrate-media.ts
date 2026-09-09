import { MongoClient, ObjectId } from "mongodb";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const client = await new MongoClient(uri).connect();
const db = client.db(process.env.MONGODB_DB || "dearmers_dao");
const daos = await db.collection("daoIndex").find({ $or: [{ logoUri: { $type: "string", $ne: "" } }, { bannerUri: { $type: "string", $ne: "" } }] }).toArray();
let cleared = 0;
for (const dao of daos) {
  const unset: Record<string, ""> = {};
  for (const field of ["logoUri", "bannerUri"] as const) {
    const uriValue = String(dao[field] || "");
    const id = uriValue.match(/[?&]id=([a-f0-9]{24})$/i)?.[1];
    const file = id && ObjectId.isValid(id) ? await db.collection("media.files").findOne({ _id: new ObjectId(id) }) : null;
    const metadata = file?.metadata as { scope?: string; resourceId?: string; purpose?: string } | undefined;
    const valid = metadata?.scope === "dao" && metadata.resourceId === String(dao.daoId) && metadata.purpose === (field === "logoUri" ? "dao-logo" : "dao-banner");
    if (!valid) unset[field] = "";
    console.log(`${apply ? "APPLY" : "DRY-RUN"} ${dao.daoId} ${field}: ${valid ? "verified" : "cleared (unprovable legacy association)"}`);
  }
  if (Object.keys(unset).length) {
    cleared += Object.keys(unset).length;
    if (apply) await db.collection("daoIndex").updateOne({ _id: dao._id }, { $unset: unset, $set: { updatedAt: new Date() } });
    if (apply) await db.collection("auditLogs").insertOne({ scopeId: String(dao.daoId), type: "media_migration_cleared", target: String(dao.daoId), fields: Object.keys(unset), createdAt: new Date() });
  }
}
console.log(`${apply ? "Applied" : "Would clear"} ${cleared} unprovable DAO media references.`);
await client.close();
