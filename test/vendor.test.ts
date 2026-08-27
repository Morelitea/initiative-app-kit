/**
 * The three things a vendor flow gets wrong quietly.
 *
 * A fault that arrives as an exception, a refusal that cannot be told from an
 * outage, and a verifier sent for a challenge that never travelled. None of
 * them shows up in a flow you click through by hand, which is why they are all
 * asserted here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginAuthorization,
  exchangeCode,
  fetchJson,
  refreshGrant,
} from "../src/vendor.js";
import { challengeFor } from "../src/pkce.js";

const TOKEN_URL = "https://vendor.test/login/oauth/access_token";

/** One canned answer for whatever is asked. */
function answering(reply: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply());
}

/** The form body a call actually put on the wire. */
function sent(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ""));
}

/** The `init` of the nth call, which is where everything asserted below is. */
function nth(fetching: ReturnType<typeof answering>, index: number): RequestInit {
  return fetching.mock.calls[index]?.[1] as RequestInit;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("beginning a flow", () => {
  it("keeps the verifier and sends only its challenge", () => {
    const { verifier, params } = beginAuthorization({ clientId: "abc" });

    expect(verifier).toBeTruthy();
    expect(params.get("code_challenge")).toBe(challengeFor(verifier!));
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.toString()).not.toContain(verifier!);
  });

  it("has no verifier when no challenge goes out", () => {
    // The invariant this function exists for. A destination that will not carry
    // a challenge to the vendor's authorize step hands back nothing to store,
    // so there is nothing to send back and claim a binding that was never made.
    const { verifier, params } = beginAuthorization({ pkce: false });

    expect(verifier).toBeNull();
    expect(params.has("code_challenge")).toBe(false);
    expect(params.has("code_challenge_method")).toBe(false);
    expect(params.get("state")).toBeTruthy();
  });

  it("mints a fresh state every time", () => {
    const states = new Set(
      Array.from({ length: 50 }, () => beginAuthorization().state)
    );
    expect(states.size).toBe(50);
  });

  it("puts on only what it was given", () => {
    const bare = beginAuthorization({ pkce: false });
    expect([...bare.params.keys()]).toEqual(["state"]);

    const full = beginAuthorization({
      clientId: "abc",
      redirectUri: "https://app.test/callback",
      scope: "repo read:org",
      extra: { prompt: "consent" },
    });
    expect(full.params.get("redirect_uri")).toBe("https://app.test/callback");
    expect(full.params.get("scope")).toBe("repo read:org");
    expect(full.params.get("prompt")).toBe("consent");
  });
});

describe("a call that answers instead of throwing", () => {
  it("reports a vendor it could not reach", async () => {
    answering(() => {
      throw new TypeError("fetch failed");
    });

    const answer = await fetchJson("https://vendor.test/user");

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("unreachable");
    expect(answer.status).toBeNull();
  });

  it("reports a body that is not JSON", async () => {
    // A proxy's error page, which is what an outage looks like from here.
    answering(() => new Response("<html>502 Bad Gateway</html>", { status: 200 }));

    const answer = await fetchJson("https://vendor.test/user");

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("malformed");
  });

  it("keeps what the vendor said when it refused", async () => {
    answering(() => Response.json({ message: "Bad credentials" }, { status: 401 }));

    const answer = await fetchJson("https://vendor.test/user");

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("http");
    expect(answer.status).toBe(401);
    expect(answer.detail).toBe("Bad credentials");
  });

  it("hands back the body when there is one", async () => {
    answering(() => Response.json({ login: "alice" }));

    const answer = await fetchJson<{ login: string }>("https://vendor.test/user");

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.body.login).toBe("alice");
  });
});

describe("spending an authorization code", () => {
  const request = {
    tokenUrl: TOKEN_URL,
    clientId: "abc",
    clientSecret: "shh",
    code: "the-code",
    redirectUri: "https://app.test/callback",
  };

  it("returns the grant, in the fields every vendor has", async () => {
    answering(() =>
      Response.json({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 28_800,
        refresh_token_expires_in: 15_811_200,
        scope: "repo",
      })
    );

    const exchange = await exchangeCode(request);

    expect(exchange.ok).toBe(true);
    if (!exchange.ok) return;
    expect(exchange.grant.accessToken).toBe("at");
    expect(exchange.grant.refreshToken).toBe("rt");
    expect(exchange.grant.expiresIn).toBe(28_800);
    expect(exchange.grant.refreshExpiresIn).toBe(15_811_200);
    // And everything else it said, for the fields only one vendor has.
    expect(exchange.grant.raw.scope).toBe("repo");
  });

  it("sends the verifier only when there is one", async () => {
    const fetching = answering(() => Response.json({ access_token: "at" }));

    await exchangeCode(request);
    expect(sent(nth(fetching, 0)).has("code_verifier")).toBe(false);

    await exchangeCode({ ...request, verifier: "v".repeat(43) });
    expect(sent(nth(fetching, 1)).get("code_verifier")).toBe("v".repeat(43));
  });

  it("sends a form, which is the encoding the grant types are specified in", async () => {
    const fetching = answering(() => Response.json({ access_token: "at" }));

    await exchangeCode(request);

    const init = nth(fetching, 0);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(sent(init).get("grant_type")).toBe("authorization_code");
    expect(sent(init).get("code")).toBe("the-code");
  });

  it("calls a 200 carrying an error what it is", async () => {
    // The refusal that does not arrive as one. A vendor answering `200` with
    // `{"error": ...}` has still said no, and the body is what says so.
    answering(() =>
      Response.json({ error: "bad_verification_code", error_description: "expired" })
    );

    const exchange = await exchangeCode(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("refused");
    expect(exchange.detail).toBe("expired");
  });

  it("calls a 4xx a refusal", async () => {
    answering(() => Response.json({ error: "invalid_client" }, { status: 401 }));

    const exchange = await exchangeCode(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("refused");
  });
});

describe("telling an outage from a refusal", () => {
  // The distinction the whole type exists for: one of these means delete the
  // row, and the other means do not touch it. An app that cannot tell them
  // apart disconnects everybody the first time the vendor is down.
  const request = {
    tokenUrl: TOKEN_URL,
    clientId: "abc",
    clientSecret: "shh",
    refreshToken: "rt",
  };

  it("does not call an unreachable vendor a refusal", async () => {
    answering(() => {
      throw new TypeError("fetch failed");
    });

    const exchange = await refreshGrant(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("unreachable");
  });

  it("does not call a 5xx a refusal", async () => {
    answering(() => new Response("upstream error", { status: 503 }));

    const exchange = await refreshGrant(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("unreachable");
  });

  it("does not call being rate limited a refusal", async () => {
    answering(() => Response.json({ message: "slow down" }, { status: 429 }));

    const exchange = await refreshGrant(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("unreachable");
  });

  it("does not call a proxy's HTML a refusal", async () => {
    answering(() => new Response("<html>gateway</html>", { status: 200 }));

    const exchange = await refreshGrant(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("unreachable");
  });

  it("does call a revoked refresh token a refusal", async () => {
    answering(() => Response.json({ error: "bad_refresh_token" }));

    const exchange = await refreshGrant(request);

    expect(exchange.ok).toBe(false);
    if (exchange.ok) return;
    expect(exchange.reason).toBe("refused");
  });

  it("asks for the grant type it means", async () => {
    const fetching = answering(() => Response.json({ access_token: "at" }));

    await refreshGrant(request);

    const init = nth(fetching, 0);
    expect(sent(init).get("grant_type")).toBe("refresh_token");
    expect(sent(init).get("refresh_token")).toBe("rt");
  });
});

describe("the deadline", () => {
  it("is on every call, so a hung socket does not outlive the request", async () => {
    const fetching = answering(() => Response.json({ access_token: "at" }));

    await fetchJson("https://vendor.test/user");

    expect(nth(fetching, 0).signal).toBeInstanceOf(AbortSignal);
  });

  it("gives up rather than waiting forever", async () => {
    // A vendor that accepts the connection and then says nothing — the failure
    // an unguarded call waits out for as long as the socket stays open.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        })
    );

    const answer = await fetchJson("https://vendor.test/user", { timeoutMs: 10 });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.reason).toBe("unreachable");
  });
});
