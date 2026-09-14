import { HttpError } from "./_http.js";

export function privateKeyFromEnv(name: string): `0x${string}` {
  const raw = process.env[name]?.trim().replace(/^['"]|['"]$/g, "");
  const normalized = raw && /^0x/i.test(raw) ? raw : raw ? `0x${raw}` : "";
  if (!/^0x[0-9a-f]{64}$/i.test(normalized)) throw new HttpError(503, `${name} is missing or invalid. Configure a 32-byte hexadecimal private key.`);
  return normalized as `0x${string}`;
}
