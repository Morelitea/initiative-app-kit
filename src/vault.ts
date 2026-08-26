/**
 * Sealing the credentials an app holds on somebody else's behalf.
 *
 * An app that runs a vendor flow ends up holding tokens that reach whatever the
 * member reaches. Stored as plaintext in a column, a backup, a replica or a
 * stray `SELECT` hands over every member's account at once — so they are sealed
 * with a key the database does not have.
 *
 * Here rather than in each app because getting it wrong fails **silently**.
 * AES-256-GCM with a nonce reused across values is broken in a way no test
 * notices and no error reports; a tag left unverified turns a tampered
 * ciphertext into plaintext of somebody else's choosing. The construction is
 * the same in every app, so it is written once.
 *
 * **Custody is still yours.** This takes a key and takes no view on where it
 * came from: an environment variable, a mounted file, a KMS that hands one over
 * at boot. Where the key lives and how it rotates are answers an operator gets
 * to change without the protocol moving.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Seals values under one key, and opens what it sealed. */
export interface Vault {
  /** `<nonce>.<ciphertext>.<tag>`, all base64url. */
  seal(plaintext: string): string;
  /** The plaintext, or `null` if it does not open under this key. */
  open(sealed: string): string | null;
}

/**
 * A vault for one key, checked at construction rather than at first use.
 *
 * The key is 32 bytes, base64. Checked here so a deployment with a truncated
 * one fails at boot beside everything else that starts, rather than the first
 * time a member connects.
 */
export function createVault(keyBase64: string): Vault {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `an encryption key must be ${KEY_BYTES} bytes, base64-encoded — ` +
        "generate one with: openssl rand -base64 32"
    );
  }

  return {
    seal(plaintext: string): string {
      // A fresh nonce per value. Reusing one under GCM is the way this
      // construction actually breaks, and it breaks quietly.
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, nonce);
      const sealed = Buffer.concat([
        cipher.update(plaintext, "utf-8"),
        cipher.final(),
      ]);
      return [nonce, sealed, cipher.getAuthTag()]
        .map((part) => part.toString("base64url"))
        .join(".");
    },

    open(sealed: string): string | null {
      const parts = sealed.split(".");
      if (parts.length !== 3) return null;
      try {
        const [nonce, body, tag] = parts.map((part) =>
          Buffer.from(part, "base64url")
        );
        if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) return null;
        const decipher = createDecipheriv(ALGORITHM, key, nonce);
        // Authenticated: a value that was tampered with fails to open rather
        // than decrypting into something else.
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(body),
          decipher.final(),
        ]).toString("utf-8");
      } catch {
        // Not an error to handle — a credential that no longer opens is one the
        // caller treats as absent, and the remedy is to connect again.
        return null;
      }
    },
  };
}
