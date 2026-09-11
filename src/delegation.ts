/**
 * Verifying a call made on a member's behalf by another app.
 *
 * There are two kinds of caller an app hears from with a bearer token, and both
 * are signed by the same party:
 *
 * - **Initiative acting for itself** presents a *context token* — see
 *   `./context.ts`. It names a guild, an install and a scope, and it names no
 *   caller, because there is only one Initiative.
 * - **A delegate acting for a member** presents a token Initiative issued *for
 *   you*, carrying the member it is acting for and an {@link DelegationClaims.actor}
 *   saying who asked.
 *
 * ## Why the issuer is Initiative and not the delegate
 *
 * A delegate used to sign these itself, and an app verified one against the key
 * set that delegate published. That could not survive pairwise references: you
 * know a guild and a member by the references minted at **your** install, the
 * delegate knows its own, and the two are unrelated values. A token the
 * delegate signed could name neither of them to you.
 *
 * Only the deployment holds both, so the delegate trades what it holds for a
 * token addressed to you, and the names in it are already yours. That exchange
 * is the standard shape for this (RFC 8693), and it has a second effect worth
 * having: one issuer and one key set, rather than a key set to discover and
 * trust per delegate.
 *
 * ## A token is for one audience, and this one is for you
 *
 * Initiative and an app are two separate audiences, and a token minted for one
 * must not verify at the other — an app is not permitted to reach Initiative's
 * data, and a credential that crossed the boundary would be a way around that
 * rather than a way through it.
 *
 * So a token presented to an app must name **the app** — `initiative-app:<public
 * id>`, the same shape a context token uses — and this module refuses anything
 * else. Initiative pins its own audience when it verifies, so the separation
 * holds from both ends and neither side depends on the other's discipline.
 *
 * ## Who is acting is signed, not asserted
 *
 * {@link DelegationClaims.actor} comes out of the token. A caller may also name
 * itself in {@link DELEGATE_HEADER}, and that is a routing hint and nothing
 * more — the claim is what attribution is read from, because the claim is
 * inside the signature.
 */

import { createVerify } from "node:crypto";

import { JwksCache, audienceFor } from "./context.js";
import { isPublicId } from "./parse.js";
import { APP_HEADER } from "./signing.js";

/**
 * Where a caller may say it is acting for a member rather than as the platform.
 *
 * A hint about which shape to read, not a claim about who is calling: that is
 * {@link DelegationClaims.actor}, which is signed.
 */
export const DELEGATE_HEADER = APP_HEADER;

export class DelegationTokenError extends Error {}

/** The app that asked for this call to be made. */
export interface DelegationActor {
  /** Its public id, as its registration carries it. */
  publicId: string;
}

export interface DelegationClaims {
  /**
   * One-shot. Record it and refuse a repeat, the way Initiative does — this
   * module cannot, because replay protection needs storage with a lifetime and
   * that belongs to the app.
   */
  jti: string;
  /**
   * The member this call is for, as **you** know them.
   *
   * Minted at your install, so it is the same value on a context token and on
   * this one, and it is what your own rows key on. What the delegate knows them
   * by is a different value and never reaches you.
   */
  subject: string;
  /** The one guild this call is about, as you know it. Same property as above. */
  guildRef: string;
  /** Your install in that guild. */
  appInstallId: number;
  /**
   * Connection id → the handle you know that member's own credential by.
   *
   * Present only where the member has a live connection to you, and the same
   * claim a context token carries: a call made *for* a member is usually a call
   * made *with* their credential, and asking for the handle separately would
   * be a round trip to learn something the token could say.
   */
  connectionRefs?: Record<string, string>;
  /** Who asked. Signed — see the module note. */
  actor: DelegationActor;
  /** The token's own `iss` — the deployment. */
  issuer: string;
  expiresAt: number;
}

/**
 * Verify a token issued for a delegated call and return what it claims.
 *
 * Everything is checked: the algorithm is pinned, the signature is checked
 * against the deployment's published key, the audience must be *you*, and
 * expiry is enforced. A partial verification is worse than none, because it
 * reads as a check.
 *
 * Two things this deliberately does not do, both because they need state:
 *
 * - **Replay.** {@link DelegationClaims.jti} comes back for you to record.
 *   Refuse one you have already seen; these are one-shot.
 * - **Authorization.** A verified token says a delegate is acting for a member
 *   in a guild. Whether what is being asked is something you offer, and whether
 *   you will do it for that delegate, is yours to decide.
 */
export async function verifyDelegationToken(
  token: string,
  options: {
    /** Your app's public id. The audience must name it. */
    publicId: string;
    /** The deployment calling you, for key lookup. */
    baseUrl: string;
    jwks: JwksCache;
    /** Pin the issuer when you know it. */
    issuer?: string;
    now?: () => number;
    /** Tolerance for clock skew, in seconds. */
    leewaySeconds?: number;
  }
): Promise<DelegationClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new DelegationTokenError("not a JWT");
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJson(rawHeader) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") {
    // Named rather than guessed: an unexpected algorithm is the classic way a
    // token gets accepted on terms the issuer never intended.
    throw new DelegationTokenError(`unexpected algorithm ${header.alg}`);
  }
  if (!header.kid) {
    throw new DelegationTokenError("token names no key");
  }

  let key;
  try {
    key = await options.jwks.keyFor(options.baseUrl, header.kid);
  } catch (cause) {
    throw new DelegationTokenError(`no key for ${header.kid}`, { cause });
  }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${rawHeader}.${rawPayload}`);
  verifier.end();
  if (!verifier.verify(key, Buffer.from(rawSignature, "base64url"))) {
    throw new DelegationTokenError("signature did not verify");
  }

  const claims = decodeJson(rawPayload) as Record<string, unknown>;

  const expected = audienceFor(options.publicId);
  if (claims.aud !== expected) {
    throw new DelegationTokenError(`token is for ${claims.aud}, not ${expected}`);
  }
  const issuer = typeof claims.iss === "string" ? claims.iss : "";
  if (!issuer) {
    throw new DelegationTokenError("token names no issuer");
  }
  if (options.issuer && issuer !== options.issuer) {
    throw new DelegationTokenError(`token is from ${issuer}, not ${options.issuer}`);
  }

  const jti = claims.jti;
  if (typeof jti !== "string" || !jti) {
    throw new DelegationTokenError("token carries no jti — it cannot be one-shot");
  }
  const subject = claims.sub;
  if (typeof subject !== "string" || !subject) {
    throw new DelegationTokenError("sub must name a member");
  }
  const guildRef = claims.guild_ref;
  if (typeof guildRef !== "string" || !guildRef) {
    throw new DelegationTokenError("guild_ref must name a guild");
  }
  const appInstallId = claims.app_install_id;
  if (!Number.isInteger(appInstallId)) {
    throw new DelegationTokenError("app_install_id must be an integer");
  }

  const rawRefs = claims.connection_refs;
  let connectionRefs: Record<string, string> | undefined;
  if (rawRefs !== undefined) {
    if (typeof rawRefs !== "object" || rawRefs === null || Array.isArray(rawRefs)) {
      throw new DelegationTokenError("connection_refs must be an object");
    }
    connectionRefs = {};
    for (const [id, ref] of Object.entries(rawRefs as Record<string, unknown>)) {
      if (typeof ref !== "string" || !ref) {
        throw new DelegationTokenError(`connection_refs.${id} is not a handle`);
      }
      connectionRefs[id] = ref;
    }
  }

  const act = claims.act as { public_id?: unknown } | undefined;
  const actorId = act?.public_id;
  if (typeof actorId !== "string" || !isPublicId(actorId)) {
    throw new DelegationTokenError("act must name the app that is acting");
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
    guildRef,
    appInstallId: appInstallId as number,
    ...(connectionRefs ? { connectionRefs } : {}),
    actor: { publicId: actorId },
    issuer,
    expiresAt: exp,
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
