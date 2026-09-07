import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.DELEGATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 24) throw new Error("DELEGATION_ENCRYPTION_KEY must contain at least 24 characters");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decrypt(value: { iv: string; tag: string; ciphertext: string }) {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
