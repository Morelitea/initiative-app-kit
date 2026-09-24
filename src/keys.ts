/**
 * Your app's signing keys.
 *
 * An app proves who it is to Initiative by signing a short JWT with its own
 * private key (`private_key_jwt`, RFC 7523). The deployment's operator
 * registers the matching public keys — a JWKS — against your app's public id,
 * and the private key never leaves your app.
 *
 * Two algorithms are supported, and the deployment picks the one to check by
 * the registered key's type: `RS256` for an RSA key, `ES256` for a P-256 key.
 *
 * Every key carries a `kid`. Each JWT names the `kid` it was signed with, so
 * rotating is: generate a new key, have the operator register a JWKS holding
 * both public keys, switch your app to the new one, then drop the old entry.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";

/** The algorithms an app key may use. */
export type AppKeyAlgorithm = "RS256" | "ES256";

/** One public key, as a JWK. */
export interface PublicJwk {
  kty: "RSA" | "EC";
  kid: string;
  alg: AppKeyAlgorithm;
  use: "sig";
  n?: string;
  e?: string;
  crv?: "P-256";
  x?: string;
  y?: string;
}

/** A JSON Web Key Set: what the operator registers for your app. */
export interface Jwks {
  keys: PublicJwk[];
}

/** A private key ready to sign with. */
export interface AppSigningKey {
  key: KeyObject;
  kid: string;
  alg: AppKeyAlgorithm;
}

/** What {@link generateAppKeys} returns. */
export interface GeneratedAppKeys {
  /** PKCS#8 PEM. Keep it secret, and out of source control. */
  privateKeyPem: string;
  /** The public half, to register with the deployment. */
  jwks: Jwks;
  kid: string;
  alg: AppKeyAlgorithm;
}

/**
 * Generate a new signing key.
 *
 * `kid` defaults to the key's RFC 7638 thumbprint, so the same key always gets
 * the same id and two keys never share one.
 */
export function generateAppKeys(
  options: { alg?: AppKeyAlgorithm; kid?: string } = {}
): GeneratedAppKeys {
  const alg = options.alg ?? "RS256";
  const { privateKey } =
    alg === "RS256"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : alg === "ES256"
        ? generateKeyPairSync("ec", { namedCurve: "P-256" })
        : unsupported(alg);
  const kid = options.kid ?? thumbprint(privateKey);
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    jwks: publicJwks({ key: privateKey, kid, alg }),
    kid,
    alg,
  };
}

/**
 * Load a PEM private key for signing, under the `kid` it was registered with.
 *
 * The algorithm follows from the key: an RSA key signs `RS256`, a P-256 key
 * signs `ES256`, and any other key is refused.
 */
export function loadPrivateKey(pem: string, kid: string): AppSigningKey {
  if (!kid) throw new TypeError("a signing key needs the kid it was registered with");
  const key = createPrivateKey(pem);
  return { key, kid, alg: algorithmOf(key) };
}

/** The JWKS for one signing key: its public half, with its `kid`. */
export function publicJwks(signing: AppSigningKey): Jwks {
  const jwk = createPublicKey(signing.key).export({ format: "jwk" }) as Record<
    string,
    string
  >;
  const entry: PublicJwk =
    signing.alg === "RS256"
      ? { kty: "RSA", kid: signing.kid, alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }
      : {
          kty: "EC",
          kid: signing.kid,
          alg: "ES256",
          use: "sig",
          crv: "P-256",
          x: jwk.x,
          y: jwk.y,
        };
  return { keys: [entry] };
}

/** The algorithm a key signs with, from its type. */
export function algorithmOf(key: KeyObject): AppKeyAlgorithm {
  if (key.asymmetricKeyType === "rsa") return "RS256";
  if (key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1") {
    return "ES256";
  }
  throw new TypeError(
    `unsupported key type ${key.asymmetricKeyType ?? "unknown"}: use an RSA or P-256 key`
  );
}

/**
 * Sign a compact JWT with an app key.
 *
 * ES256 signatures are written in the JOSE form (`r || s`, 64 bytes), which is
 * what `ieee-p1363` produces.
 */
export function signJwt(
  signing: AppSigningKey,
  claims: Record<string, unknown>
): string {
  const header = { alg: signing.alg, kid: signing.kid, typ: "JWT" };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature =
    signing.alg === "ES256"
      ? cryptoSign("sha256", Buffer.from(input), { key: signing.key, dsaEncoding: "ieee-p1363" })
      : cryptoSign("sha256", Buffer.from(input), signing.key);
  return `${input}.${signature.toString("base64url")}`;
}

function base64url(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64url");
}

/** RFC 7638: SHA-256 over the required members, in lexical order. */
function thumbprint(privateKey: KeyObject): string {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, string>;
  const members =
    jwk.kty === "RSA"
      ? { e: jwk.e, kty: jwk.kty, n: jwk.n }
      : { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return createHash("sha256").update(JSON.stringify(members)).digest("base64url");
}

function unsupported(alg: string): never {
  throw new TypeError(`unsupported algorithm ${alg}: use RS256 or ES256`);
}
