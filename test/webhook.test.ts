/**
 * Verifying Initiative's webhook deliveries: the signature over
 * `timestamp + "." + body`, and the timestamp window.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signWebhook, verifyWebhook } from "../src/webhook.js";

const SECRET = "whsec-test-only";
const BODY = '{"event_id":"e-1","changes":[]}';
const NOW = 1_780_000_000;

/** The signature computed independently, the way Initiative computes it. */
function reference(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function headers(timestamp: string, signature: string): Record<string, string> {
  return {
    "x-initiative-timestamp": timestamp,
    "x-initiative-signature": signature,
    "x-initiative-event-id": "e-1",
  };
}

const at = (seconds: number) => () => seconds * 1000;

describe("signWebhook", () => {
  it("is sha256= and hex over timestamp.body", () => {
    expect(signWebhook(SECRET, String(NOW), BODY)).toBe(reference(SECRET, String(NOW), BODY));
    expect(signWebhook(SECRET, String(NOW), Buffer.from(BODY))).toBe(
      reference(SECRET, String(NOW), BODY)
    );
  });
});

describe("verifyWebhook", () => {
  const good = headers(String(NOW), reference(SECRET, String(NOW), BODY));

  it("accepts a delivery Initiative signed, and returns its event id", () => {
    expect(verifyWebhook({ secret: SECRET, body: BODY, headers: good, now: at(NOW) })).toEqual({
      ok: true,
      eventId: "e-1",
      timestamp: NOW,
    });
  });

  it("reads a Headers object and any header case", () => {
    const fetchHeaders = new Headers(good);
    expect(
      verifyWebhook({ secret: SECRET, body: BODY, headers: fetchHeaders, now: at(NOW) }).ok
    ).toBe(true);
    const upper = {
      "X-Initiative-Timestamp": String(NOW),
      "X-Initiative-Signature": reference(SECRET, String(NOW), BODY),
    };
    expect(verifyWebhook({ secret: SECRET, body: BODY, headers: upper, now: at(NOW) })).toEqual({
      ok: true,
      eventId: null,
      timestamp: NOW,
    });
  });

  it("accepts a body given as bytes", () => {
    expect(
      verifyWebhook({ secret: SECRET, body: Buffer.from(BODY), headers: good, now: at(NOW) }).ok
    ).toBe(true);
  });

  it("refuses another secret, another body, or another timestamp", () => {
    const cases = [
      { secret: "other", body: BODY, headers: good },
      { secret: SECRET, body: `${BODY} `, headers: good },
      {
        secret: SECRET,
        body: BODY,
        headers: headers(String(NOW + 1), reference(SECRET, String(NOW), BODY)),
      },
    ];
    for (const options of cases) {
      expect(verifyWebhook({ ...options, now: at(NOW) })).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    }
  });

  it("refuses a timestamp outside the window, either way", () => {
    for (const offset of [-301, 301]) {
      const stamp = String(NOW + offset);
      const result = verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: headers(stamp, reference(SECRET, stamp, BODY)),
        now: at(NOW),
      });
      expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
    }
    const edge = String(NOW - 300);
    expect(
      verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: headers(edge, reference(SECRET, edge, BODY)),
        now: at(NOW),
      }).ok
    ).toBe(true);
  });

  it("takes a different window", () => {
    const stamp = String(NOW - 60);
    const options = {
      secret: SECRET,
      body: BODY,
      headers: headers(stamp, reference(SECRET, stamp, BODY)),
      now: at(NOW),
    };
    expect(verifyWebhook({ ...options, toleranceSeconds: 30 }).ok).toBe(false);
    expect(verifyWebhook({ ...options, toleranceSeconds: 90 }).ok).toBe(true);
  });

  it("refuses missing or malformed headers", () => {
    expect(
      verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: { "x-initiative-timestamp": String(NOW) },
        now: at(NOW),
      })
    ).toEqual({ ok: false, reason: "missing_signature" });
    for (const stamp of ["", "-1", "1.5", " 1", "0x10"]) {
      expect(
        verifyWebhook({
          secret: SECRET,
          body: BODY,
          headers: headers(stamp, reference(SECRET, stamp, BODY)),
          now: at(NOW),
        }),
        stamp
      ).toEqual({ ok: false, reason: "missing_timestamp" });
    }
  });

  it("refuses a signature of the wrong length without throwing", () => {
    expect(
      verifyWebhook({
        secret: SECRET,
        body: BODY,
        headers: headers(String(NOW), "sha256=abc"),
        now: at(NOW),
      })
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});
