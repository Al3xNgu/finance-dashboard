import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM for secrets at rest (Plaid access tokens — ARCHITECTURE.md §6.3).
 * Format: "v1:<iv b64>:<ciphertext b64>:<tag b64>". The version prefix enables
 * key/algorithm rotation: writes always use the newest version, reads dispatch
 * on the prefix.
 */
const VERSION = "v1";
const IV_BYTES = 12;

function defaultKey(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }
  return Buffer.from(env.ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plaintext: string, key?: Buffer): string {
  const k = key ?? defaultKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

export function decryptSecret(encoded: string, key?: Buffer): string {
  const [version, ivB64, ctB64, tagB64, ...rest] = encoded.split(":");
  if (version !== VERSION || !ivB64 || !ctB64 || !tagB64 || rest.length > 0) {
    throw new Error("Unrecognized encrypted payload format");
  }
  const k = key ?? defaultKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    k,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
