/**
 * Public profile identity on the client. `handle` is the route key; Privy DIDs are deliberately
 * absent from every API response, because being the only route key for wallet-less members is
 * exactly why /api/search used to publish them.
 */
export type PublicProfile = {
  handle?: string;
  wallet?: string;
  username?: string;
  displayName?: string;
  bio?: string;
  website?: string;
  github?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  location?: string;
  timezone?: string;
  profileVisibility?: string;
  emailNotifications?: boolean;
};

/**
 * The canonical URL for a profile. The wallet route stays as a fallback for any profile the handle
 * backfill has not reached, so a member is never unreachable while the migration is in flight.
 */
export function profileHref(profile: Pick<PublicProfile, "handle" | "wallet"> | null | undefined) {
  if (profile?.handle) return `/u/${encodeURIComponent(profile.handle)}`;
  if (profile?.wallet) return `/profile/${profile.wallet}`;
  return "/profile";
}

/** A label that is always safe to render: never a DID, never a bare wallet where a name exists. */
export function profileLabel(profile: PublicProfile | null | undefined) {
  return profile?.displayName || profile?.username || (profile?.handle ? `@${profile.handle}` : "") || "Dreamer profile";
}
