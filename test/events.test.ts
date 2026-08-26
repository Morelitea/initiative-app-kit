/**
 * The producer surface, checked against the thing it has to match.
 *
 * Almost every assertion here is a compatibility assertion rather than a
 * behavioural one: Initiative's outbox poller already produces envelopes, and
 * an automation service already parses them. The value of this module is that
 * an app's envelope is indistinguishable from that one apart from the fields
 * that genuinely differ — so the tests are written as "the same as Initiative"
 * and not as "what this code happens to do".
 *
 * The reference is `app/services/tenant/outbox_poller.py::_envelope` and
 * `app/services/tenant/webhook_dispatcher.py::_sign`.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  EVENT_ID_HEADER,
  EventProducer,
  deliveryEventId,
  eventEnvelope,
  isPublicTarget,
  mintSubscriptionSecret,
  parseSubscribe,
  signDelivery,
  verifyDelivery,
  type AppEvent,
  type EventSubscription,
} from "../src/events.js";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../src/signing.js";

const PUBLIC_ID = "morelitea.github";
const DECLARED = [
  "app.morelitea.github.issue-opened",
  "app.morelitea.github.issue-closed",
];

const subscription: EventSubscription = {
  id: 7,
  guildId: 42,
  targetUrl: "https://auto.example.com/webhooks/initiative",
  secret: "s3cr3t",
  eventTypes: DECLARED,
  subscriber: "initiative-auto",
};

const event: AppEvent = {
  guildId: 42,
  appInstallId: 99,
  eventType: "app.morelitea.github.issue-opened",
  payload: { repository: "widgets", issue_number: 42 },
  deliveryKey: "72d3162e-cc78-11e3-81ab-4c9367dc0958",
  occurredAt: new Date("2026-08-25T12:00:00.000Z"),
};

describe("the envelope", () => {
  it("carries exactly the fields Initiative's own does", () => {
    // A receiver written against the platform's envelope reads these five keys
    // off the top level and nothing else. Adding one is harmless; missing one
    // is a 400 before any app-specific branch is reached.
    expect(Object.keys(eventEnvelope(PUBLIC_ID, subscription, event)).sort()).toEqual([
      "actor_user_id",
      "changes",
      "event_id",
      "guild_id",
      "occurred_at",
      "subscription_id",
    ]);
  });

  it("names an integer subscription id", () => {
    // Not cosmetic. A receiver built for Initiative refuses an envelope whose
    // `subscription_id` is not an int, so an app minting uuids here cannot be
    // heard at all until that receiver is changed — which is the one thing this
    // whole module exists to avoid needing.
    const envelope = eventEnvelope(PUBLIC_ID, subscription, event);
    expect(Number.isInteger(envelope.subscription_id)).toBe(true);
    expect(envelope.guild_id).toBe(42);
  });

  it("has no Initiative actor and no initiative, because there is neither", () => {
    const envelope = eventEnvelope(PUBLIC_ID, subscription, event);
    expect(envelope.actor_user_id).toBeNull();
    expect(envelope.changes[0].initiative_id).toBeNull();
  });

  it("marks the change as app-sourced, and says which app", () => {
    // The one branch a consumer has to add: a change with no `source` names a
    // row to re-read, one with this carries its facts because there is no row.
    const change = eventEnvelope(PUBLIC_ID, subscription, event).changes[0];
    expect(change.source).toEqual({ type: "app", public_id: PUBLIC_ID });
    expect(change.payload).toEqual({ repository: "widgets", issue_number: 42 });
  });

  it("still names a resource a consumer could resolve", () => {
    // The install, not the issue — and it is what lets a consumer that has not
    // yet learned the `source` branch parse this at all: the outer checks and
    // the integer resource id both pass.
    const change = eventEnvelope(PUBLIC_ID, subscription, event).changes[0];
    expect(change.resource).toEqual({ type: "apps", id: 99 });
    expect(Number.isInteger(change.resource.id)).toBe(true);
  });

  it("times the event by the vendor, not by when it was posted", () => {
    expect(eventEnvelope(PUBLIC_ID, subscription, event).occurred_at).toBe(
      "2026-08-25T12:00:00.000Z"
    );
  });
});

describe("the event id", () => {
  it("is the same on every retry of the same delivery", () => {
    // The whole point. A vendor re-sending a delivery it thinks failed produces
    // the id the receiver already recorded, and it collapses.
    expect(deliveryEventId(PUBLIC_ID, 7, "abc")).toBe(deliveryEventId(PUBLIC_ID, 7, "abc"));
  });

  it("differs per subscription, so two subscribers dedup independently", () => {
    expect(deliveryEventId(PUBLIC_ID, 7, "abc")).not.toBe(
      deliveryEventId(PUBLIC_ID, 8, "abc")
    );
  });

  it("differs per app, so two apps cannot collide in one receiver", () => {
    expect(deliveryEventId("a.b", 7, "abc")).not.toBe(deliveryEventId("c.d", 7, "abc"));
  });

  it("is a v5 uuid, which is what a receiver storing it expects", () => {
    expect(deliveryEventId(PUBLIC_ID, 7, "abc")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("the signature", () => {
  const body = new TextEncoder().encode('{"hello":"world"}');

  it("is a MAC over timestamp, a dot, and the body — in that order", () => {
    // Restated here rather than called, so a change to the concatenation fails
    // this test instead of being discovered by a receiver rejecting everything.
    const expected = createHmac("sha256", "s3cr3t")
      .update("1700000000.")
      .update(body)
      .digest("hex");
    expect(signDelivery("s3cr3t", "1700000000", body)).toBe(`sha256=${expected}`);
  });

  it("changes when the timestamp does, which is what stops a replay", () => {
    // GitHub signs the body alone and a captured delivery is replayable at its
    // endpoint forever. This does not have that shape: re-stamping invalidates
    // the MAC, and keeping the stamp fails the receiver's freshness window.
    expect(signDelivery("s3cr3t", "1700000000", body)).not.toBe(
      signDelivery("s3cr3t", "1700000001", body)
    );
  });

  it("round-trips through the verifier a receiver would use", () => {
    const signature = signDelivery("s3cr3t", "1700000000", body);
    expect(verifyDelivery("s3cr3t", "1700000000", body, signature)).toBe(true);
    expect(verifyDelivery("wrong", "1700000000", body, signature)).toBe(false);
    expect(verifyDelivery("s3cr3t", "1700000001", body, signature)).toBe(false);
  });

  it("refuses a malformed signature without throwing on the length", () => {
    expect(verifyDelivery("s3cr3t", "1700000000", body, "")).toBe(false);
    expect(verifyDelivery("s3cr3t", "1700000000", body, "sha256=")).toBe(false);
  });

  it("mints a secret with enough entropy to be one", () => {
    const secret = mintSubscriptionSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toBe(mintSubscriptionSecret());
  });
});

describe("delivering", () => {
  function producer(fetchImpl: typeof globalThis.fetch, store = [subscription]) {
    return new EventProducer({
      publicId: PUBLIC_ID,
      store: { matching: async () => store },
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
    });
  }

  it("signs the bytes it sends, and sends the bytes it signed", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;

    const [outcome] = await producer(fetchImpl).publish(event);
    expect(outcome.ok).toBe(true);

    const { init } = calls[0];
    const headers = init.headers as Record<string, string>;
    const sent = init.body as Uint8Array;
    // The check that matters: recompute over exactly what went out.
    expect(verifyDelivery("s3cr3t", headers[TIMESTAMP_HEADER], sent, headers[SIGNATURE_HEADER])).toBe(
      true
    );
    // And the body is the envelope, not a re-serialization of it.
    expect(JSON.parse(new TextDecoder().decode(sent)).event_id).toBe(outcome.eventId);
    expect(headers[EVENT_ID_HEADER]).toBe(outcome.eventId);
  });

  it("does not follow a redirect", async () => {
    // The address was checked; the one it redirects to was not, and following
    // it is exactly how a checked target becomes an unchecked one.
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    await producer(fetchImpl).publish(event);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports a refusal rather than throwing it", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("no", { status: 500 })
    ) as unknown as typeof globalThis.fetch;
    const [outcome] = await producer(fetchImpl).publish(event);
    expect(outcome).toMatchObject({ ok: false, status: 500, subscriptionId: 7 });
  });

  it("survives one subscriber being unreachable", async () => {
    // One bad subscriber is not the others' problem, and an app publishing an
    // event should not have a vendor webhook fail because of one.
    const second = { ...subscription, id: 8, targetUrl: "https://other.example.com/in" };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("other")) throw new Error("econnrefused");
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const outcomes = await producer(fetchImpl, [subscription, second]).publish(event);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false]);
    expect(outcomes[1].error).toContain("econnrefused");
  });

  it("never connects to a target it would refuse", async () => {
    // Re-checked at delivery and not only at subscribe: a hostname's resolution
    // can change in between, and this is the moment that matters.
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch;
    const inside = { ...subscription, targetUrl: "http://169.254.169.254/latest/meta-data" };
    const [outcome] = await producer(fetchImpl, [inside]).publish(event);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("target refused");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("delivers nothing when nobody subscribed to the type", async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch;
    expect(await producer(fetchImpl, []).publish(event)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("which targets are allowed", () => {
  const allowed = (url: string) => isPublicTarget(new URL(url));

  it("takes an ordinary public address", () => {
    expect(allowed("https://auto.example.com/hooks")).toBe(true);
    expect(allowed("http://auto.example.com/hooks")).toBe(true);
  });

  it("refuses the addresses that reach back inside", () => {
    for (const url of [
      "http://localhost:9000/in",
      "http://auto.internal/in",
      "http://svc.local/in",
      "http://127.0.0.1/in",
      "http://10.0.0.5/in",
      "http://172.16.4.1/in",
      "http://192.168.1.9/in",
      "http://100.64.0.1/in",
      "http://[::1]/in",
      "http://[fd00::1]/in",
      "http://[fe80::1]/in",
    ]) {
      expect(allowed(url), url).toBe(false);
    }
  });

  it("refuses the cloud metadata address specifically", () => {
    // The one address whose whole purpose is handing out credentials to
    // whatever can reach it.
    expect(allowed("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("refuses a scheme that is not http", () => {
    expect(allowed("file:///etc/passwd")).toBe(false);
    expect(allowed("gopher://example.com/")).toBe(false);
  });

  it("refuses credentials in the target", () => {
    // They would be stored in plaintext and sent on every delivery.
    expect(allowed("https://user:pass@auto.example.com/in")).toBe(false);
  });
});

describe("accepting a subscription", () => {
  const parse = (body: unknown) => parseSubscribe(body, DECLARED);

  it("takes a well-formed request", () => {
    const result = parse({
      guild_id: 42,
      target_url: "https://auto.example.com/in",
      event_types: [DECLARED[0]],
    });
    expect(result).toEqual({
      ok: true,
      request: {
        guild_id: 42,
        target_url: "https://auto.example.com/in",
        event_types: [DECLARED[0]],
      },
    });
  });

  it("refuses a type this app does not produce", () => {
    // Stored inert, it would never fire and the subscriber would have no way to
    // find out — which is the failure this whole module exists to stop, one
    // level up.
    const result = parse({
      guild_id: 42,
      target_url: "https://auto.example.com/in",
      event_types: ["app.morelitea.github.issue-teleported"],
    });
    expect(result).toEqual({
      ok: false,
      error: "this app does not produce 'app.morelitea.github.issue-teleported'",
    });
  });

  it("collapses a repeated type", () => {
    // Two copies would deliver twice, and the second delivery would carry the
    // id of the first — a receiver deduping correctly would drop it, which
    // looks exactly like a lost event.
    const result = parse({
      guild_id: 42,
      target_url: "https://auto.example.com/in",
      event_types: [DECLARED[0], DECLARED[0]],
    });
    expect(result.ok && result.request.event_types).toEqual([DECLARED[0]]);
  });

  it("refuses a target it would not post to", () => {
    const result = parse({
      guild_id: 42,
      target_url: "http://localhost:9000/in",
      event_types: [DECLARED[0]],
    });
    expect(result.ok).toBe(false);
  });

  it("insists on the fields it routes on", () => {
    expect(parse(null).ok).toBe(false);
    expect(parse({ target_url: "https://a.example.com/", event_types: DECLARED }).ok).toBe(false);
    expect(parse({ guild_id: "42", target_url: "https://a.example.com/", event_types: DECLARED }).ok).toBe(
      false
    );
    expect(parse({ guild_id: 42, target_url: "https://a.example.com/", event_types: [] }).ok).toBe(
      false
    );
    expect(parse({ guild_id: 42, target_url: "not a url", event_types: DECLARED }).ok).toBe(false);
  });
});
