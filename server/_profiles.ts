import type { Db } from "mongodb";

export type ActorProfile = { displayName: string; username: string; avatarUrl: string };

/**
 * Resolves actor identifiers to public display fields. Actors are stored bare on most collections
 * (`daoMembers.actor`, `auditLogs.actor`) but prefixed on profiles (`identity: "privy:<sub>"`), so both
 * spellings are looked up and indexed. Generalizes the join previously inlined in server/chat.ts.
 */
export async function displayNames(db: Db, actors: Array<string | undefined | null>) {
  const unique = [...new Set(actors.map((actor) => String(actor || "")).filter(Boolean))];
  const resolved = new Map<string, ActorProfile>();
  if (!unique.length) return resolved;
  const profiles = await db.collection("profiles")
    .find({ $or: unique.flatMap((actor) => [{ identity: actor }, { identity: `privy:${actor}` }]) })
    .project({ _id: 0, identity: 1, username: 1, displayName: 1, avatarUrl: 1 })
    .toArray();
  for (const profile of profiles) {
    const identity = String(profile.identity || "");
    const value = { displayName: String(profile.displayName || ""), username: String(profile.username || ""), avatarUrl: String(profile.avatarUrl || "") };
    resolved.set(identity, value);
    resolved.set(identity.replace(/^privy:/, ""), value);
  }
  return resolved;
}

/** True for a Privy DID in either its bare (`did:privy:…`) or profile-prefixed (`privy:did:privy:…`) spelling. */
export const isIdentity = (value: unknown) => /(^|:)did:/.test(String(value || ""));

/**
 * Projection for any `daoIndex` read whose result reaches a client. `adminIdentity` holds the
 * founder's Privy DID and exists only so `dao-auth.ts` can authorize the DAO admin — it is never
 * read by the frontend, so it must not be served. Use this instead of a bare `{ _id: 0 }`.
 */
export const publicDaoProjection = { _id: 0, adminIdentity: 0 } as const;

/**
 * Fields no client may ever see. `identity` is the member's Privy DID — it was served deliberately
 * while it was the only public route key, and is withheld now that `handle` routes profiles.
 * `githubProfile` is a raw third-party API document and `usernameHistory` is a moderation trail.
 */
export const NEVER_PUBLIC_PROFILE_FIELDS = ["identity", "banned", "githubProfile", "usernameHistory"] as const;

/**
 * Fields only the profile's own owner may read back. They must reach the owner: the editor posts
 * its whole draft, so a GET that omitted them would silently reset both on the next save —
 * `profileVisibility` and `emailNotifications` are write-defaulted in server/profile.ts.
 */
export const OWNER_ONLY_PROFILE_FIELDS = ["email", "emailVerified", "emailNotifications", "profileVisibility"] as const;

/**
 * Projection for any `profiles` read that reaches a client with no notion of an owner — search,
 * follower lists, the people directory. Use this instead of a bare `{ _id: 0, email: 0 }`.
 */
export const publicProfileProjection = Object.freeze(Object.fromEntries([
  ["_id", 0],
  ...NEVER_PUBLIC_PROFILE_FIELDS.map((field) => [field, 0]),
  ...OWNER_ONLY_PROFILE_FIELDS.map((field) => [field, 0]),
])) as Record<string, 0>;

/**
 * Redacts a profile document read without a projection, for the one route that must decide
 * ownership from the document itself (a handle or wallet lookup does not name an identity).
 * Derived from the same field lists as `publicProfileProjection`, so the two cannot drift.
 */
export function publicProfile(document: Record<string, unknown>, owner = false) {
  const profile = { ...document };
  delete profile._id;
  for (const field of NEVER_PUBLIC_PROFILE_FIELDS) delete profile[field];
  if (!owner) for (const field of OWNER_ONLY_PROFILE_FIELDS) delete profile[field];
  return profile;
}

/** Public-facing name for an actor. Never returns a Privy DID. */
export function actorLabel(profile?: ActorProfile, fallbackWallet?: string | null) {
  const wallet = String(fallbackWallet || "");
  if (profile?.displayName) return profile.displayName;
  if (profile?.username) return profile.username;
  if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return "DAO member";
}
