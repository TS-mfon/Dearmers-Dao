/**
 * Backfills the unique `profiles.handle` that replaces the Privy DID as the public profile route key.
 *
 * Dry run by default; pass --apply to write. Idempotent: it only touches profiles that have no
 * handle yet, so a second run is a no-op. Deterministic: profiles are processed in `_id` order, so
 * the oldest claimant of a contested username keeps the bare handle and later ones are suffixed.
 *
 *   MONGODB_URI=... npx tsx scripts/migrate-handles.ts            # review the plan
 *   MONGODB_URI=... npx tsx scripts/migrate-handles.ts --apply    # write it
 *
 * Run this BEFORE deploying the unique index in server/_db.ts. That index is created with `await`
 * on cold start, so creating it while duplicates exist would fail every request on the instance.
 */
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { disambiguateHandle, generatedHandle, isValidHandle, normalizeHandle, sanitizeUsername } from "../shared/profile.js";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");

const client = await new MongoClient(uri).connect();
const db = client.db(process.env.MONGODB_DB || "dearmers_dao");
const profiles = db.collection("profiles");

// `_id` ascending is the tie-break: an ObjectId's leading bytes are its creation time, so the
// earliest profile wins a contested username and a re-run reaches the same answer.
const everyone = await profiles.find({}, { projection: { _id: 1, identity: 1, username: 1, handle: 1, displayName: 1 } }).sort({ _id: 1 }).toArray();
const taken = new Set(everyone.map((profile) => String(profile.handle || "")).filter(Boolean));

const uniqueGenerated = () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = generatedHandle(randomBytes(16));
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("Could not generate an unused handle after 200 attempts");
};

type Plan = { id: unknown; handle: string; username: string; kind: "kept" | "suffixed" | "generated"; from: string };
const plans: Plan[] = [];

for (const profile of everyone) {
  if (String(profile.handle || "")) continue;
  const username = sanitizeUsername(profile.username);
  const base = normalizeHandle(username);
  let handle: string;
  let kind: Plan["kind"];
  if (!isValidHandle(base)) {
    // Empty, too short, or reserved. Derived only from random bytes -- never from the DID,
    // email, or wallet, since reversing those is the leak this migration exists to close.
    handle = uniqueGenerated();
    kind = "generated";
  } else {
    handle = disambiguateHandle(base, taken);
    if (!handle) throw new Error(`Could not disambiguate a handle for ${base}`);
    kind = handle === base ? "kept" : "suffixed";
  }
  taken.add(handle);
  // A suffixed or generated handle becomes the member's username too, so the @name they see
  // matches the URL they live at. Leaving them different would show two members as "@dave".
  plans.push({ id: profile._id, handle, username: kind === "kept" ? username : handle, kind, from: username });
}

const counts = { kept: 0, suffixed: 0, generated: 0 };
for (const plan of plans) {
  counts[plan.kind] += 1;
  if (plan.kind !== "kept") console.log(`${apply ? "APPLY" : "DRY-RUN"} ${plan.kind.toUpperCase().padEnd(9)} ${plan.from || "(no username)"} -> ${plan.handle}${apply ? "" : plan.kind === "generated" ? "  (a fresh random handle is drawn on --apply)" : ""}`);
}

if (apply) {
  for (const plan of plans) {
    const set: Record<string, unknown> = { handle: plan.handle, username: plan.username, updatedAt: new Date() };
    const renamed = plan.kind !== "kept";
    if (renamed) set.usernameHistory = [{ from: plan.from, to: plan.handle, at: new Date(), reason: `handle_backfill_${plan.kind}` }];
    await profiles.updateOne({ _id: plan.id as never, handle: { $exists: false } }, { $set: set });
    if (renamed) {
      const profile = await profiles.findOne({ _id: plan.id as never }, { projection: { identity: 1 } });
      const identity = String(profile?.identity || "").replace(/^privy:/, "");
      if (identity) {
        await db.collection("notifications").updateOne(
          { identity, kind: "handle_changed", eventKey: `handle_backfill:${plan.handle}` },
          { $setOnInsert: { identity, kind: "handle_changed", eventKey: `handle_backfill:${plan.handle}`, title: "Your profile link changed", body: plan.kind === "generated" ? `Your profile now lives at /u/${plan.handle}. Open your profile to choose a username you prefer.` : `Your username was already taken, so your profile now lives at /u/${plan.handle}.`, readAt: null, createdAt: new Date(), targetUrl: `/u/${plan.handle}` } },
          { upsert: true },
        );
      }
    }
  }
}

// Measured from the database after the write, not from the plan that produced it.
const [missing, duplicates, invalid] = await Promise.all([
  profiles.countDocuments({ $or: [{ handle: { $exists: false } }, { handle: "" }, { handle: null }] }),
  profiles.aggregate<{ _id: string; count: number }>([{ $match: { handle: { $type: "string" } } }, { $group: { _id: "$handle", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]).toArray(),
  profiles.find({ handle: { $type: "string" } }, { projection: { handle: 1 } }).toArray().then((docs) => docs.filter((doc) => !isValidHandle(String(doc.handle))).length),
]);

console.log(`\nProfiles: ${everyone.length}. ${apply ? "Assigned" : "Would assign"} ${plans.length} (${counts.kept} kept, ${counts.suffixed} suffixed, ${counts.generated} generated).`);
console.log(`Remaining without a handle: ${missing}. Duplicate handles: ${duplicates.length}. Malformed handles: ${invalid}.`);
if (!apply) console.log("\nDry run only. Re-run with --apply to write, then deploy the unique index.");
else if (missing === 0 && duplicates.length === 0 && invalid === 0) console.log("\nHANDLE BACKFILL COMPLETE: 0 missing, 0 duplicate, 0 malformed. Safe to deploy the unique index.");
else console.log("\nHANDLE BACKFILL INCOMPLETE. Do not deploy the unique index until all three counts are zero.");

await client.close();
