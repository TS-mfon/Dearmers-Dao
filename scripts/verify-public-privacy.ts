/**
 * Probes a deployed site's public, unauthenticated endpoints for leaked Privy DIDs and email
 * addresses, and for the regex-injection defect that made `?q=(` a 500.
 *
 *   npx tsx scripts/verify-public-privacy.ts https://dreamersdao.me
 *   npx tsx scripts/verify-public-privacy.ts --redos https://dreamersdao.me
 *
 * This exists because a deploy log saying "ready" proves nothing about what the origin serves, and
 * because the edge cache has served a five-day-old response during a previous verification. Every
 * request below is cache-busted and the assertions read the response body, not the deploy status.
 */
const args = process.argv.slice(2);
const redosOnly = args.includes("--redos");
const base = (args.find((arg) => !arg.startsWith("--")) || "https://dreamersdao.me").replace(/\/$/, "");

const DID = /did:privy:[A-Za-z0-9]+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

type Probe = { path: string; label: string };

async function get(path: string) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${base}${path}${separator}_cb=${Date.now()}${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  const response = await fetch(url, { headers: { "cache-control": "no-cache", pragma: "no-cache" } });
  const body = await response.text();
  return { status: response.status, body, ms: Date.now() - started, age: response.headers.get("age") || "0", cache: response.headers.get("x-vercel-cache") || "none" };
}

/** A wallet that actually exists, so /api/profile is probed against a real document. */
async function knownWallet() {
  const { body } = await get("/api/daos");
  const wallet = (body.match(/0x[a-fA-F0-9]{40}/) || [])[0];
  return wallet || "";
}

let failures = 0;
const fail = (message: string) => { failures += 1; console.error(`  FAIL ${message}`); };

if (redosOnly) {
  // Each of these used to reach `new RegExp(value)` unescaped. `(` is a syntax error and so a 500;
  // `(a+)+$` is a backtracking pattern. A 200 here means the input was escaped into a literal.
  const hostile = ["(", "[", "*", "+", "?", "\\", "(a+)+$", "(.*)*$", "^(a|a)+$"];
  const paths = (value: string) => [`/api/search?q=${encodeURIComponent(value)}`, `/api/daos?q=${encodeURIComponent(value)}`, `/api/social?kind=profile&q=${encodeURIComponent(value)}`];
  console.log(`Probing ${base} with regex metacharacters\n`);
  for (const value of hostile) {
    for (const path of paths(value)) {
      const { status, ms } = await get(path);
      const ok = status === 200 && ms < 8_000;
      console.log(`  ${ok ? "ok  " : "FAIL"} ${status} ${String(ms).padStart(5)}ms  q=${JSON.stringify(value)}  ${path.split("?")[0]}`);
      if (!ok) fail(`${path} answered ${status} in ${ms}ms`);
    }
  }
  if (failures) { console.error(`\n${failures} hostile query probe(s) failed.`); process.exit(1); }
  console.log(`\nREDOS GATE PASS: ${hostile.length * 3} hostile queries all answered 200 without backtracking.`);
  process.exit(0);
}

const wallet = await knownWallet();
const probes: Probe[] = [
  { path: "/api/daos", label: "DAO directory" },
  { path: "/api/daos?q=a", label: "DAO search" },
  { path: "/api/search?q=a", label: "global search (a)" },
  { path: "/api/search?q=dao", label: "global search (dao)" },
  { path: "/api/search?q=e", label: "global search (e)" },
  { path: "/api/search?q=m", label: "global search (m)" },
  { path: "/api/social?kind=profile", label: "people directory (no query)" },
  { path: "/api/social?kind=profile&q=a", label: "people directory (a)" },
  ...(wallet ? [{ path: `/api/profile?wallet=${wallet}`, label: "profile by wallet" }] : []),
];

console.log(`Probing ${base} for leaked identifiers\n`);
let totalDids = 0;
let totalEmails = 0;

for (const { path, label } of probes) {
  const { status, body, age, cache } = await get(path);
  const dids = body.match(DID) || [];
  const emails = body.match(EMAIL) || [];
  totalDids += dids.length;
  totalEmails += emails.length;
  const clean = status === 200 && dids.length === 0 && emails.length === 0;
  console.log(`  ${clean ? "ok  " : "FAIL"} ${status} dids=${String(dids.length).padStart(3)} emails=${String(emails.length).padStart(3)} cache=${cache} age=${age}  ${label}`);
  if (status !== 200) fail(`${path} answered ${status}`);
  if (dids.length) fail(`${path} published ${dids.length} Privy DID(s), first ${dids[0].slice(0, 22)}…`);
  if (emails.length) fail(`${path} published ${emails.length} email address(es)`);
}

// Positive control: without it, a probe suite that silently stopped fetching would report clean.
if (!probes.some(({ path }) => path.startsWith("/api/search"))) fail("the probe list lost its search endpoints");
const control = await get("/api/search?q=a");
if (!control.body.includes("profiles")) fail("/api/search?q=a did not return a profiles field; the probe may be reading an error page rather than real results");

if (!wallet) console.log("\n  note: no wallet was discoverable from /api/daos, so the profile-by-wallet probe was skipped.");

if (failures) { console.error(`\n${failures} check(s) failed. ${totalDids} DID(s) and ${totalEmails} email(s) are public.`); process.exit(1); }
console.log(`\nPUBLIC PRIVACY GATE PASS: ${probes.length} endpoints, 0 Privy DIDs, 0 email addresses.`);
