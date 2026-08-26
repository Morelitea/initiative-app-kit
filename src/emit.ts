/**
 * The outbound direction: your app telling a subscriber that something happened
 * at your vendor.
 *
 * Everything else in this package is about Initiative — calls to it, calls from
 * it, a document it fetches. This module is not. It is what an *automation
 * service* connects to, and Initiative is not in the path at all: an app
 * already holds its vendor's webhook connection and has already verified its
 * vendor's signature, so it hands the result straight to whoever asked for it.
 *
 * ## What has to be identical, and what does not
 *
 * The *inbound* half is the vendor's shape and should stay so. GitHub's
 * `X-Hub-Signature-256` over the raw body and Shopify's HMAC header have
 * nothing in common, and forcing them into one abstraction would mean an app
 * verifying its vendor through a layer that understands neither.
 *
 * The *outbound* half is the opposite: it must be identical everywhere, or an
 * automation service needs one receiver per vendor and every new app is a code
 * change over there. So this module fixes all of it —
 *
 * - the envelope, field for field, as Initiative's own outbox poller builds it
 * - the headers, and the HMAC over `timestamp + "." + body`
 * - a deterministic `event_id`, so a retry is recognizable as a retry
 * - the path a subscriber creates and deletes a subscription at
 *
 * — and leaves the app exactly two jobs: storing subscriptions, and deciding
 * what its vendor's deliveries mean.
 *
 * ## The envelope is Initiative's, deliberately
 *
 * A consumer parses one shape from two kinds of producer, and tells them apart
 * by `source` on each change item. Initiative's own items carry no `source`;
 * an app's carry `{"type": "app", "public_id": "…"}`. A resource-sourced item
 * is re-read through the API, where the gates apply to the read; an app-sourced
 * one carries its `payload`, because there is nothing to re-read — a GitHub
 * issue is not a row in anybody's database here.
 *
 * `resource` still names something real, and it is the install rather than the
 * issue: `{"type": "apps", "id": <app_install_id>}`, which resolves at
 * `/apps/{id}` like any other event id. That keeps an app's envelope parseable
 * by a consumer that has not learned the `source` branch — the outer parse, the
 * dedup and the id checks all pass — so adopting app emissions is one branch on
 * the payload side rather than a new receiver.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { ENDPOINTS_PATH } from "./endpoints.js";
import type { Endpoint } from "./manifest.js";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./signing.js";

/** Where a subscriber creates, lists and deletes its subscriptions. */
export const SUBSCRIPTIONS_PATH = `${ENDPOINTS_PATH}/subscriptions`;

/** The envelope's own id, repeated in a header so a receiver can dedup early. */
export const EVENT_ID_HEADER = "X-Initiative-Event-ID";

/** What Initiative's dispatcher sends, so a receiver's log reads the same. */
export const DELIVERY_USER_AGENT = "initiative-webhooks/1";

/**
 * The `source` marker on a change item an app produced.
 *
 * Initiative's own items have no `source` at all — absent means the change
 * names a row and should be re-read.
 */
export const APP_SOURCE_TYPE = "app";

/**
 * The resource type an app-produced change names.
 *
 * `guild_apps` is published under `apps` on the event bus because that is the
 * segment its detail route lives at, and this is the same resource: the install
 * that produced the event.
 */
export const APP_RESOURCE_TYPE = "apps";

/** One subscriber's standing request, as your app stores it. */
export interface Subscription {
  /**
   * Yours to mint, and an **integer** rather than a string or a uuid.
   *
   * Not a style choice: a receiver written against Initiative's envelope
   * already refuses one whose `subscription_id` is not an int, so an app that
   * mints uuids here needs that receiver changed before it can be heard at all.
   * A `BIGSERIAL` is the obvious source.
   */
  id: number;
  guildId: number;
  targetUrl: string;
  /** Minted by you at create and shown once. See {@link mintSubscriptionSecret}. */
  secret: string;
  /** Which of your `emit` endpoints this subscriber wants. */
  endpoints: string[];
  /**
   * Which delegate asked for it, for the one thing ownership decides: who may
   * change or delete it.
   *
   * `signer.publicId` off the delegation token that created it — the
   * registration whose published key verified the call, not a name the caller
   * asserted. Two delegates on one deployment therefore cannot reach each
   * other's subscriptions.
   */
  subscriber: string;
}

/** One change item inside an envelope, as an app produces it. */
export interface AppChange {
  event_type: string;
  /** Always null: an app has no initiative to name. See the module note. */
  initiative_id: null;
  source: { type: typeof APP_SOURCE_TYPE; public_id: string };
  resource: { type: typeof APP_RESOURCE_TYPE; id: number };
  /** The vendor's facts. Nothing here is re-readable, so it travels. */
  payload: Record<string, unknown>;
}

/** What lands on a subscriber's endpoint. Field for field, Initiative's. */
export interface EventEnvelope {
  event_id: string;
  subscription_id: number;
  guild_id: number;
  /** Always null: no Initiative member did this, a vendor did. */
  actor_user_id: null;
  occurred_at: string;
  changes: AppChange[];
}

/**
 * A secret for one subscription, minted by the producer.
 *
 * The producer mints rather than the subscriber supplying one, matching how
 * Initiative's own subscriptions work: it is returned in the create response
 * and never again, so a subscriber that loses it makes a new subscription
 * instead of asking for a copy of the old one.
 */
export function mintSubscriptionSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * `sha256=<hex>` over `timestamp + "." + body`.
 *
 * The timestamp is inside the MAC, which is what makes a captured body
 * un-replayable at a fresh timestamp: re-stamping it invalidates the signature,
 * and keeping the original stamp fails the receiver's freshness window.
 */
export function signDelivery(
  secret: string,
  timestamp: string,
  body: Uint8Array
): string {
  const mac = createHmac("sha256", Buffer.from(secret, "utf-8"));
  mac.update(timestamp, "utf-8");
  mac.update(".", "utf-8");
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

/**
 * Whether a delivery carries the signature this secret would produce.
 *
 * Here so a *receiver* built on this kit checks exactly what a producer built
 * on it sends, rather than reimplementing the concatenation and discovering the
 * separator by bisection. Freshness and dedup are the receiver's, because both
 * need storage with a lifetime.
 */
export function verifyDelivery(
  secret: string,
  timestamp: string,
  body: Uint8Array,
  offered: string
): boolean {
  const expected = Buffer.from(signDelivery(secret, timestamp, body), "utf-8");
  const given = Buffer.from(offered.trim(), "utf-8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * The namespace app-produced envelope ids are derived in.
 *
 * Fixed forever. Changing it would make every in-flight delivery look new to a
 * receiver deduping on `event_id`, which is the one thing the id exists for.
 * Distinct from the namespace Initiative's poller uses, so an app's id space
 * and the platform's cannot collide however the inputs line up.
 */
const EVENT_ID_NAMESPACE = "1f0b6f5a7a3e5c9d9f1b2c4e6a8d0b31";

/**
 * The id for one delivery to one subscription — the same on every retry.
 *
 * `deliveryKey` is the **vendor's** own id for the occurrence, not one you
 * mint: GitHub's `X-GitHub-Delivery`, Stripe's event id. That is what makes the
 * property hold end to end — the vendor re-sending a delivery it thinks failed
 * produces the id the receiver already recorded, and it collapses, exactly as
 * your own retry does.
 *
 * An app whose vendor offers no stable id can pass anything unique and gets
 * at-least-once with no dedup, which is worth knowing rather than discovering.
 */
export function deliveryEventId(
  publicId: string,
  subscriptionId: number,
  deliveryKey: string
): string {
  return uuid5(EVENT_ID_NAMESPACE, `${publicId}:${subscriptionId}:${deliveryKey}`);
}

/** RFC 4122 §4.3: SHA-1 over the namespace bytes and the name. */
function uuid5(namespace: string, name: string): string {
  // The namespace is stored without separators, so this is a straight decode.
  const bytes = Buffer.from(namespace, "hex");
  const hash = createHash("sha1").update(bytes).update(name, "utf-8").digest();
  const out = Buffer.from(hash.subarray(0, 16));
  out[6] = (out[6] & 0x0f) | 0x50; // version 5
  out[8] = (out[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = out.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** One thing that happened at your vendor, in one guild. */
export interface Emission {
  guildId: number;
  /** Which install this belongs to — one guild may hold your app twice. */
  appInstallId: number;
  /** The `emit` endpoint this announces, as your manifest declares it. */
  endpoint: string;
  payload: Record<string, unknown>;
  /** The vendor's own id for this occurrence. See {@link deliveryEventId}. */
  deliveryKey: string;
  /** When the vendor says it happened. Defaults to now. */
  occurredAt?: Date;
}

/** The envelope this emission becomes for one subscription. */
export function eventEnvelope(
  publicId: string,
  subscription: Subscription,
  emission: Emission
): EventEnvelope {
  return {
    event_id: deliveryEventId(publicId, subscription.id, emission.deliveryKey),
    subscription_id: subscription.id,
    guild_id: emission.guildId,
    actor_user_id: null,
    occurred_at: (emission.occurredAt ?? new Date()).toISOString(),
    changes: [
      {
        // The endpoint id is what travels: one string names the thing in the
        // manifest, in a subscription, and on the wire.
        event_type: emission.endpoint,
        initiative_id: null,
        source: { type: APP_SOURCE_TYPE, public_id: publicId },
        resource: { type: APP_RESOURCE_TYPE, id: emission.appInstallId },
        payload: emission.payload,
      },
    ],
  };
}

/** What your storage has to be able to answer for a publish to happen. */
export interface SubscriptionStore {
  /**
   * Active subscriptions in this guild that named this endpoint.
   *
   * Filtering here rather than in the emitter is deliberate: it is an index
   * lookup in a database and a full scan in memory, and a busy app has more
   * subscriptions than emissions it can afford to loop over.
   */
  matching(guildId: number, endpoint: string): Promise<Subscription[]>;
}

/** What one POST to one subscriber did. */
export interface DeliveryOutcome {
  subscriptionId: number;
  eventId: string;
  ok: boolean;
  /** The status, or null if the request never got one. */
  status: number | null;
  error?: string;
}

export interface EmitterOptions {
  /** Your service id — namespaces the endpoints and identifies the source. */
  publicId: string;
  store: SubscriptionStore;
  /** Injectable so a test can answer without a network. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** How long to wait on one subscriber before giving up. Default 5s. */
  timeoutMs?: number;
  /**
   * Whether a target address is one this app will POST to.
   *
   * Read the note on {@link isPublicTarget} before turning this off. A
   * subscriber chooses the address and your app is the thing that connects to
   * it, so this is the gate between "an automation service subscribed" and "an
   * automation service made your app fetch a URL inside your cluster".
   */
  allowTarget?: (url: URL) => boolean;
}

/**
 * Posts your vendor's emissions to whoever subscribed.
 *
 * Stateless apart from the store you hand it, so construct one at boot and keep
 * it. Delivery is best-effort and concurrent: one subscriber being down is not
 * the others' problem, and the outcome array is what you log or retry from.
 *
 * There is deliberately **no retry in here**. Retrying needs durable state with
 * a lifetime — which attempt, how long to back off, when to give up — and an
 * app that has that already has somewhere better to put it than a client
 * object. The deterministic `event_id` is what makes retrying safe whenever you
 * choose to do it.
 */
export class Emitter {
  private readonly publicId: string;
  private readonly store: SubscriptionStore;
  /**
   * Only what was passed. `globalThis.fetch` is read at call time instead of
   * captured here, so a runtime that installs one after this was constructed —
   * and a test that replaces it — is not talking to a reference taken before
   * either happened.
   */
  private readonly injectedFetch?: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly allowTarget: (url: URL) => boolean;

  constructor(options: EmitterOptions) {
    this.publicId = options.publicId;
    this.store = options.store;
    this.injectedFetch = options.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.allowTarget = options.allowTarget ?? isPublicTarget;
  }

  /** Deliver one emission to every subscription that named its endpoint. */
  async publish(emission: Emission): Promise<DeliveryOutcome[]> {
    const subscriptions = await this.store.matching(emission.guildId, emission.endpoint);
    return Promise.all(subscriptions.map((sub) => this.deliver(sub, emission)));
  }

  private async deliver(
    subscription: Subscription,
    emission: Emission
  ): Promise<DeliveryOutcome> {
    const envelope = eventEnvelope(this.publicId, subscription, emission);
    // Serialized once, signed as bytes, sent as the same bytes. Re-serializing
    // between signing and sending is the failure this ordering forecloses.
    const body = new TextEncoder().encode(JSON.stringify(envelope));
    const timestamp = String(Math.floor(this.now() / 1000));
    const outcome: DeliveryOutcome = {
      subscriptionId: subscription.id,
      eventId: envelope.event_id,
      ok: false,
      status: null,
    };

    let target: URL;
    try {
      target = new URL(subscription.targetUrl);
    } catch {
      return { ...outcome, error: "target is not a url" };
    }
    // Re-checked here and not only when the subscription was created: a
    // hostname's resolution can change between the two, and this is the moment
    // that matters.
    if (!this.allowTarget(target)) {
      return { ...outcome, error: "target refused" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const doFetch = this.injectedFetch ?? globalThis.fetch;
      const response = await doFetch(target.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EVENT_ID_HEADER]: envelope.event_id,
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signDelivery(subscription.secret, timestamp, body),
          "User-Agent": DELIVERY_USER_AGENT,
        },
        body,
        signal: controller.signal,
        // A redirect is not a delivery. The address was checked; the one it
        // redirects to was not, and following it is how a checked target
        // becomes an unchecked one.
        redirect: "manual",
      });
      return {
        ...outcome,
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
      };
    } catch (error) {
      return { ...outcome, error: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Names that are never a subscriber, only a way back inside. */
const RESERVED_NAMES = new Set(["localhost"]);

/** And the suffixes that mean the same thing one level up. */
const RESERVED_SUFFIXES = [".localhost", ".local", ".internal"];

/**
 * The v4 ranges that are not the public internet, as `[first octet, low, high]`
 * on the second where one is needed.
 *
 * Compared numerically against octets `node:net` has already validated, rather
 * than matched against the text of the address. That distinction is the whole
 * reason this is not a pattern: `127.0.0.1`, `0177.0.0.1`, `2130706433` and
 * `0x7f.1` are the same host to a resolver and four different strings, and a
 * check that reads digits out of a string sees only the first.
 */
const PRIVATE_V4: Array<[number, number, number]> = [
  [0, 0, 255], // "this network"
  [10, 0, 255], // RFC 1918
  [100, 64, 127], // carrier-grade NAT
  [127, 0, 255], // loopback
  [169, 254, 254], // link-local, and the cloud metadata address
  [172, 16, 31], // RFC 1918
  [192, 168, 168], // RFC 1918
];

/**
 * One `node:net`-validated IPv6 address as its sixteen bytes.
 *
 * Expanded rather than compared as text, because the text is not stable: `URL`
 * normalizes what it is given, so `::ffff:127.0.0.1` arrives as `::ffff:7f00:1`
 * and a check looking for the dotted form sees a public address. Sixteen bytes
 * have one representation and every question below is arithmetic on them.
 */
function ipv6Bytes(host: string): Uint8Array | null {
  const [head, tail, ...rest] = host.split("::");
  // `node:net` accepts at most one `::`, so more than one split is not an
  // address it validated.
  if (rest.length) return null;

  const groups = (part: string): string[] => (part ? part.split(":") : []);
  const leading = groups(head);
  const trailing = tail === undefined ? [] : groups(tail);

  const bytes = new Uint8Array(16);
  const write = (list: string[], at: number): number | null => {
    let index = at;
    for (const group of list) {
      // The last group may be a dotted-quad — the `::ffff:127.0.0.1` form.
      if (group.includes(".")) {
        if (isIP(group) !== 4) return null;
        for (const octet of group.split(".")) bytes[index++] = Number.parseInt(octet, 10);
        continue;
      }
      const value = Number.parseInt(group, 16);
      if (Number.isNaN(value)) return null;
      bytes[index++] = (value >> 8) & 0xff;
      bytes[index++] = value & 0xff;
    }
    return index;
  };

  const afterHead = write(leading, 0);
  if (afterHead === null) return null;
  if (tail === undefined) return afterHead === 16 ? bytes : null;

  // Everything after `::` sits at the end; the gap between is already zero.
  const tailLength = trailing.reduce((total, group) => total + (group.includes(".") ? 4 : 2), 0);
  if (afterHead + tailLength > 16) return null;
  return write(trailing, 16 - tailLength) === 16 ? bytes : null;
}

/** Whether these sixteen bytes are an IPv4-mapped address, and which one. */
function mappedV4(bytes: Uint8Array): string | null {
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return null;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

/** Whether a v6 address is one of the ranges that is not the public internet. */
function isPrivateV6(bytes: Uint8Array): boolean {
  const allZero = bytes.every((byte) => byte === 0);
  // Unspecified (::) and loopback (::1).
  if (allZero) return true;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  // Unique-local, fc00::/7 — seven bits, so the mask is 0xfe and not 0xff.
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  // Link-local, fe80::/10 — ten bits. Matching on `0xfe` alone would take the
  // whole of fe00::/8, which is four times the range and mostly public.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  return false;
}

/**
 * A default that refuses the addresses a subscriber has no business naming.
 *
 * **This is a guard, not a defence.** It checks the literal in the URL, and a
 * hostname that *resolves* to a private address passes it — real protection
 * means resolving the name and connecting to the address you resolved, which
 * needs a custom agent and belongs to the app rather than to a shape-checking
 * helper.
 *
 * What actually keeps this narrow is who may call: a subscription is created by
 * a delegate the operator provisioned a key for, so the population that can
 * name a target is the population the operator already trusts to act as its
 * members. This stops a misconfiguration and an obvious mistake; it does not
 * stop that party.
 *
 * The address itself goes through `node:net` rather than being matched as text.
 * That is not tidiness: a textual check accepts `0177.0.0.1` and `2130706433`
 * as hostnames because they are not dotted quads, and a resolver treats both as
 * loopback. `isIP` parses them properly and this compares the result.
 */
export function isPublicTarget(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  // Credentials in a subscription target are always a mistake, and they would
  // be stored in plaintext and sent on every delivery.
  if (url.username || url.password) return false;

  // `URL` brackets a v6 literal; `node:net` will not parse it bracketed.
  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return false;

  const lower = host.toLowerCase();
  if (RESERVED_NAMES.has(lower)) return false;
  for (const suffix of RESERVED_SUFFIXES) {
    if (lower.endsWith(suffix)) return false;
  }

  const family = isIP(host);
  if (family === 4) return isPublicV4(host);
  if (family === 6) {
    const bytes = ipv6Bytes(host);
    // Validated by `isIP` and still unparseable here would be a disagreement
    // between two readings of the same string, which is the one case worth
    // refusing outright rather than guessing at.
    if (!bytes) return false;
    // An IPv4-mapped address is an IPv4 address wearing v6 notation:
    // `::ffff:127.0.0.1` reaches loopback exactly as `127.0.0.1` does, and
    // answering the v6 question about it would answer the wrong question.
    const mapped = mappedV4(bytes);
    if (mapped) return isPublicV4(mapped);
    return !isPrivateV6(bytes);
  }
  // A name. Whatever it resolves to is not knowable here — see the note above.
  return true;
}

/** Whether a `node:net`-validated v4 address is outside every private range. */
function isPublicV4(host: string): boolean {
  const octets = host.split(".").map((part) => Number.parseInt(part, 10));
  const [first, second] = octets;
  for (const [prefix, low, high] of PRIVATE_V4) {
    if (first === prefix && second >= low && second <= high) return false;
  }
  return true;
}

/** What a subscriber POSTs to {@link SUBSCRIPTIONS_PATH}. */
export interface SubscribeRequest {
  guild_id: number;
  target_url: string;
  endpoints: string[];
}

/** What it gets back. `secret` appears here and nowhere else, ever. */
export interface SubscribeResponse {
  id: number;
  guild_id: number;
  target_url: string;
  endpoints: string[];
  secret: string;
}

/** A rejected subscribe, with the sentence to answer 400 with. */
export interface SubscribeProblem {
  ok: false;
  error: string;
}

export type ParsedSubscribe =
  | { ok: true; request: SubscribeRequest }
  | SubscribeProblem;

/**
 * Check a subscribe body against what your app declares, before storing it.
 *
 * `declared` is your manifest's whole endpoint list — the same one the call
 * surface reads — and only the `emit` entries can be subscribed to. Naming a
 * read or a write is refused for the same reason as naming nothing at all: it
 * would never fire, and the subscriber would have no way to find out.
 *
 * Note what is **not** checked here: whether the caller may act for
 * `guild_id`. That is the delegation token's job and it belongs to the route,
 * because it decides whether to read the body at all.
 */
export function parseSubscribe(
  body: unknown,
  declared: readonly Endpoint[],
  options: { maxEndpoints?: number } = {}
): ParsedSubscribe {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "expected a json object" };
  }
  const raw = body as Partial<SubscribeRequest>;

  if (!Number.isInteger(raw.guild_id)) {
    return { ok: false, error: "guild_id must be an integer" };
  }
  if (typeof raw.target_url !== "string" || !raw.target_url.trim()) {
    return { ok: false, error: "target_url is required" };
  }
  let target: URL;
  try {
    target = new URL(raw.target_url);
  } catch {
    return { ok: false, error: "target_url is not a url" };
  }
  if (!isPublicTarget(target)) {
    return { ok: false, error: "target_url is not an address this app will post to" };
  }
  if (!Array.isArray(raw.endpoints) || raw.endpoints.length === 0) {
    return { ok: false, error: "endpoints must name at least one endpoint" };
  }
  if (raw.endpoints.length > (options.maxEndpoints ?? 50)) {
    return { ok: false, error: "endpoints names too many endpoints" };
  }
  const emitted = new Set(
    declared.filter((endpoint) => endpoint.direction === "emit").map((e) => e.id)
  );
  for (const id of raw.endpoints) {
    if (typeof id !== "string" || !emitted.has(id)) {
      return { ok: false, error: `this app does not emit '${String(id)}'` };
    }
  }
  return {
    ok: true,
    request: {
      guild_id: raw.guild_id as number,
      target_url: target.toString(),
      // Deduplicated: two copies of one id would deliver twice, and the second
      // delivery carries the id of the first.
      endpoints: [...new Set(raw.endpoints)],
    },
  };
}
