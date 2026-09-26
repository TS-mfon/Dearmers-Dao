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

/** Public-facing name for an actor. Never returns a Privy DID. */
export function actorLabel(profile?: ActorProfile, fallbackWallet?: string | null) {
  const wallet = String(fallbackWallet || "");
  if (profile?.displayName) return profile.displayName;
  if (profile?.username) return profile.username;
  if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return "DAO member";
}
