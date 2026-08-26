/**
 * Verifying a call from an automation service, rather than from Initiative.
 *
 * There are two kinds of caller an app hears from with a bearer token, and they
 * are not the same party:
 *
 * - **Initiative** presents a *context token* — see `./context.ts`. It names a
 *   guild, an install and a scope, and it never names a caller, because there
 *   is only one Initiative.
 * - **A delegate** presents a *delegation token* it signed itself. Initiative
 *   holds the public half on that delegate's registration and publishes it at
 *   {@link delegateJwksPath}, so an app can verify one the same way, from the
 *   same deployment, with the same cache.
 *
 * Which is why the app-facing surfaces here — subscribing to this app's events
 * — take delegation and not context. A context token would tell the app
 * "Initiative vouched for this"; a delegation token is signed by a party the
 * operator explicitly granted `delegation` to, and stops verifying the moment
 * they take that grant away. The operator's kill switch reaches an app-facing
 * call without Initiative being in the request at all.
 *
 * ## A token is for one audience, and this one is for you
 *
 * Initiative and an app are two separate audiences, and a token minted for one
 * must not verify at the other — an app is not permitted to reach Initiative's
 * data, and a credential that crossed the boundary would be a way around that
 * rather than a way through it.
 *
 * So a token presented to an app must name **the app** — `initiative-app:
 * <public id>`, the same shape a context token uses — and this module refuses
 * anything else. Initiative pins its own audience when it verifies, so the
 * separation holds from both ends and neither side depends on the other's
 * discipline for it.
 *
 * ## The caller says which delegate it is, and the signature settles it
 *
 * A delegate's keys are published **per delegate**, at an address that names
 * one, and that is what makes attribution real: a key that verifies out of
 * `/delegates/morelitea.auto/jwks.json` is that registration's key and nobody
 * else's. A merged document could not do this — `kid` is an opaque label each
 * app picks and two may pick the same one, so a set keyed by `kid` alone would
 * resolve one delegate's label to another delegate's key with nothing on either
 * side saying so.
 *
 * The cost is that the verifier has to know **which** delegate before it can
 * fetch anything, and the token cannot say: `iss` is deployment-wide. So the
 * caller names itself in a header — {@link DELEGATE_HEADER}, the same
 * `X-Initiative-App` an app uses when it calls Initiative, and with exactly the
 * same meaning: *which key set to check against*.
 *
 * Nothing is trusted on the strength of that header. It selects a document; the
 * signature decides whether the call happened. Naming a delegate you are not
 * fetches a key set you cannot sign for, and verification ends there.
 */

import { createVerify } from "node:crypto";

import { JwksCache, audienceFor } from "./context.js";
import { isPublicId } from "./parse.js";
import { APP_HEADER } from "./signing.js";

/**
 * Where a caller names which delegate it is.
 *
 * Deliberately the header an app already uses to name itself to Initiative: in
 * both directions it says which key the signature should be checked under, and
 * in both directions it is a selector rather than a claim.
 */
export const DELEGATE_HEADER = APP_HEADER;

/** Where a deployment publishes one delegate's verification keys. */
export function delegateJwksPath(publicId: string): string {
  return `/api/v1/app-platform/delegates/${encodeURIComponent(publicId)}/jwks.json`;
}

export class DelegationTokenError extends Error {}

/** Who signed. */
export interface DelegationSigner {
  /**
   * The registration whose key verified this — the delegate's own public id.
   *
   * Trustworthy because of where the key came from rather than because the
   * caller said so: the key set is addressed by this id, so a signature that
   * verifies against it was made with that registration's key.
   */
  publicId: string;
  /** The key within that set. */
  kid: string;
}

/** A verified delegation token. */
export interface DelegationClaims {
  /**
   * One-shot. Record it and refuse a repeat, the way Initiative does — this
   * module cannot, because replay protection needs storage with a lifetime and
   * that belongs to the app.
   */
  jti: string;
  /**
   * The pairwise subject the delegate knows this member by.
   *
   * Opaque, and it stays opaque: an app that resolves nothing from it learns
   * nothing about who the member is, which is the point of it being here rather
   * than a user id.
   */
  subject: string;
  /** The one guild this call is about. Check it against what you are asked to do. */
  guildId: number;
  initiativeId: number | null;
  /**
   * The token's own `iss` — the deployment's delegation issuer, not the
   * delegate. {@link signer} is what identifies the caller.
   */
  issuer: string;
  expiresAt: number;
  signer: DelegationSigner;
}

/**
 * Verify a delegation token and return what it claims.
 *
 * Everything is checked: the algorithm is pinned, the signature is checked
 * against the key published for the delegate that named itself, the audience
 * must be *you*, and expiry is enforced. A partial verification is worse than
 * none, because it reads as a check.
 *
 * Two things this deliberately does not do, both because they need state:
 *
 * - **Replay.** {@link DelegationClaims.jti} comes back for you to record.
 *   Refuse one you have already seen; a delegation token is one-shot.
 * - **Authorization.** A verified token says a delegate is acting for a member
 *   in a guild. Whether that guild has your app, and whether what is being
 *   asked is something you offer, is yours to decide.
 */
export async function verifyDelegationToken(
  token: string,
  options: {
    /** Your app's public id. The audience must name it. */
    publicId: string;
    /**
     * Which delegate says it is calling — the {@link DELEGATE_HEADER} value.
     *
     * A selector, not a claim: it decides which published key set is fetched,
     * and the signature decides whether the call is real.
     */
    delegate: string;
    /** The deployment whose delegates you trust, for key lookup. */
    baseUrl: string;
    jwks: JwksCache;
    now?: () => number;
    leewaySeconds?: number;
  }
): Promise<DelegationClaims> {
  // Checked before it is put in a URL, because this value arrives from the
  // caller and becomes a path segment. `isPublicId` reads it character by
  // character rather than matching a pattern — see `./parse.ts` on why.
  const delegate = options.delegate.trim().toLowerCase();
  if (!isPublicId(delegate)) {
    throw new DelegationTokenError("the caller named no delegate");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new DelegationTokenError("not a JWT");
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJson(rawHeader) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") {
    throw new DelegationTokenError(`unexpected algorithm ${header.alg}`);
  }
  if (!header.kid) {
    throw new DelegationTokenError("token names no key");
  }

  let key;
  try {
    key = await options.jwks.keyFor(
      options.baseUrl,
      header.kid,
      delegateJwksPath(delegate)
    );
  } catch (error) {
    // A delegate that does not exist, one that is switched off, and one with no
    // key provisioned yet all arrive here as one sentence — which is the
    // deployment's own wiring rather than the caller's business. See the note
    // on `missing` in `./context.ts`.
    throw new DelegationTokenError((error as Error).message);
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${rawHeader}.${rawPayload}`);
  verifier.end();
  if (!verifier.verify(key, Buffer.from(rawSignature, "base64url"))) {
    throw new DelegationTokenError("signature did not verify");
  }

  const claims = decodeJson(rawPayload) as Record<string, unknown>;

  // The audience check, and the reason this module exists as its own file.
  const expected = audienceFor(options.publicId);
  const audience = claims.aud;
  const named = Array.isArray(audience) ? audience : [audience];
  if (!named.includes(expected)) {
    throw new DelegationTokenError(
      `token is for ${JSON.stringify(audience)}, not ${expected}`
    );
  }

  const issuer = claims.iss;
  if (typeof issuer !== "string" || !issuer) {
    throw new DelegationTokenError("token names no issuer");
  }

  const jti = claims.jti;
  if (typeof jti !== "string" || !jti) {
    throw new DelegationTokenError("token carries no jti — it cannot be one-shot");
  }
  const subject = claims.sub;
  if (typeof subject !== "string" || !subject) {
    throw new DelegationTokenError("sub must be a pairwise subject");
  }
  const guildId = claims.guild_id;
  if (!Number.isInteger(guildId)) {
    throw new DelegationTokenError("guild_id must be an integer");
  }
  const initiativeId = claims.initiative_id ?? null;
  if (initiativeId !== null && !Number.isInteger(initiativeId)) {
    throw new DelegationTokenError("initiative_id must be an integer when present");
  }

  const seconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const leeway = options.leewaySeconds ?? 30;
  const exp = claims.exp;
  if (typeof exp !== "number") {
    throw new DelegationTokenError("token carries no expiry");
  }
  if (exp + leeway < seconds) {
    throw new DelegationTokenError("token has expired");
  }
  const iat = claims.iat;
  if (typeof iat === "number" && iat - leeway > seconds) {
    throw new DelegationTokenError("token is not valid yet");
  }

  return {
    jti,
    subject,
    guildId: guildId as number,
    initiativeId: initiativeId as number | null,
    issuer,
    expiresAt: exp,
    signer: { publicId: delegate, kid: header.kid },
  };
}

/** The {@link DELEGATE_HEADER} value out of a request's headers, or null. */
export function delegateHeader(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const raw = headers[DELEGATE_HEADER] ?? headers[DELEGATE_HEADER.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"));
  } catch {
    throw new DelegationTokenError("token segment is not JSON");
  }
}
