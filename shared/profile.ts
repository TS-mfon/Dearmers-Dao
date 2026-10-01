/**
 * The profile field contract, shared by the API and the product UI so a form cannot accept
 * something the server will silently reshape. server/profile.ts truncates and strips on write;
 * before this module existed the editor rendered bare inputs with no caps, so a 900-character
 * bio was halved and still reported "Profile updated".
 */

/** Maximum stored length per profile field. The server truncates to exactly these values. */
export const PROFILE_LIMITS = {
  username: 32,
  displayName: 80,
  bio: 500,
  website: 240,
  github: 80,
  location: 100,
  timezone: 80,
  email: 180,
  avatarUrl: 500,
  bannerUrl: 500,
} as const;

export const HANDLE_MIN = 3;
export const HANDLE_MAX = PROFILE_LIMITS.username;

/**
 * Route segments and support-impersonation risks that must never become a member's handle.
 * `identity` is listed because `/profile/identity/<did>` stays mounted as a redirect.
 */
export const RESERVED_HANDLES: readonly string[] = [
  "admin", "administrator", "api", "control-room", "dao", "daos", "dearmers", "dreamers",
  "edit", "explorer", "forge", "governance", "grant", "grants", "help", "identity", "me",
  "new", "notifications", "null", "profile", "protocol", "root", "sanctuary", "search",
  "settings", "signals", "staff", "support", "system", "treasury", "u", "undefined",
];

/** Display username: the member's own casing, reduced to the charset the server stores. */
export function sanitizeUsername(value: unknown) {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, PROFILE_LIMITS.username);
}

/** The case-folded, unique routing form of a username. */
export function normalizeHandle(value: unknown) {
  return sanitizeUsername(value).toLowerCase();
}

/** A handle must read as a handle: no leading or trailing separator, nothing reserved. */
export const HANDLE_PATTERN = new RegExp(`^[a-z0-9][a-z0-9_-]{${HANDLE_MIN - 2},${HANDLE_MAX - 2}}[a-z0-9]$`);

export function isValidHandle(value: unknown) {
  const handle = String(value ?? "");
  return handle === normalizeHandle(handle) && HANDLE_PATTERN.test(handle) && !RESERVED_HANDLES.includes(handle);
}

/** Member-readable reason a handle was refused, or "" when it is acceptable. */
export function handleProblem(value: unknown): string {
  const raw = String(value ?? "");
  const handle = normalizeHandle(raw);
  if (!handle) return "Choose a username using letters, numbers, hyphens, or underscores.";
  if (handle.length < HANDLE_MIN) return `Usernames need at least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `Usernames can be at most ${HANDLE_MAX} characters.`;
  if (handle !== raw.toLowerCase().slice(0, HANDLE_MAX)) return "Usernames can only contain letters, numbers, hyphens, and underscores.";
  if (!HANDLE_PATTERN.test(handle)) return "Usernames must start and end with a letter or number.";
  if (RESERVED_HANDLES.includes(handle)) return "That username is reserved. Choose another.";
  return "";
}

/** Unambiguous alphabet: no 0/1/i/l/o, so a generated handle survives being read aloud. */
const GENERATED_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const GENERATED_PREFIX = "dreamer-";
export const GENERATED_LENGTH = 7;

/**
 * A handle for a member who never chose a username. Derived only from the supplied random
 * bytes — never from a Privy DID, email, or wallet, since reversing those is exactly the
 * leak that retiring the DID route key is meant to close.
 */
export function generatedHandle(randomBytes: Uint8Array) {
  if (randomBytes.length < GENERATED_LENGTH) throw new Error(`generatedHandle needs at least ${GENERATED_LENGTH} random bytes`);
  let handle = GENERATED_PREFIX;
  for (let index = 0; index < GENERATED_LENGTH; index += 1) handle += GENERATED_ALPHABET[randomBytes[index] % GENERATED_ALPHABET.length];
  return handle;
}

/** True for a handle this module generated, so the UI can invite the member to choose their own. */
export const isGeneratedHandle = (value: unknown) =>
  new RegExp(`^${GENERATED_PREFIX}[${GENERATED_ALPHABET}]{${GENERATED_LENGTH}}$`).test(String(value ?? ""));

/**
 * Deterministic collision suffixing: the first claimant keeps the bare handle and later ones
 * get -2, -3, … Re-running the backfill over the same input therefore produces the same result.
 */
export function disambiguateHandle(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, HANDLE_MAX - String(suffix).length - 1)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}
