import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/lib/crypto";

const keyA = Buffer.alloc(32, 1);
const keyB = Buffer.alloc(32, 2);

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const token = "access-sandbox-abc-123";
    expect(decryptSecret(encryptSecret(token, keyA), keyA)).toBe(token);
  });

  it("produces the v1:iv:ciphertext:tag format with unique IVs", () => {
    const a = encryptSecret("same-input", keyA);
    const b = encryptSecret("same-input", keyA);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b); // random IV — no deterministic ciphertext
    expect(a).not.toContain("same-input");
  });

  it("rejects tampered ciphertext (auth tag)", () => {
    const enc = encryptSecret("secret", keyA);
    const parts = enc.split(":");
    const ct = Buffer.from(parts[2], "base64");
    ct[0] ^= 0xff;
    parts[2] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"), keyA)).toThrow();
  });

  it("rejects decryption with the wrong key", () => {
    expect(() => decryptSecret(encryptSecret("secret", keyA), keyB)).toThrow();
  });

  it("rejects unknown formats and versions", () => {
    expect(() => decryptSecret("v2:a:b:c", keyA)).toThrow(/format/);
    expect(() => decryptSecret("not-encrypted", keyA)).toThrow(/format/);
  });
});
