/**
 * Answering Initiative's hook calls: the lifecycle token is verified for the
 * hook the path names, the body is checked, and the answer is shaped.
 */

import { describe, expect, it, vi } from "vitest";

import { JwksCache, audienceFor } from "../src/context.js";
import { HOOKS_PATH, handleHook, hookName } from "../src/hooks.js";
import { generateAppKeys, loadPrivateKey, signJwt } from "../src/keys.js";

const BASE = "https://initiative.example.com";
const PUBLIC_ID = "acme.tracker";
const NOW = 1_780_000_000;

const platform = generateAppKeys({ alg: "RS256", kid: "platform-1" });
const signing = loadPrivateKey(platform.privateKeyPem, "platform-1");

const fetchImpl = (async () =>
  new Response(JSON.stringify(platform.jwks), { status: 200 })) as unknown as typeof fetch;

const verify = {
  publicId: PUBLIC_ID,
  baseUrl: BASE,
  jwks: new JwksCache({ fetchImpl, now: () => NOW * 1000 }),
  now: () => NOW * 1000,
};

function token(extra: Record<string, unknown> = {}): string {
  return signJwt(signing, {
    jti: "j-1",
    iss: "initiative",
    aud: audienceFor(PUBLIC_ID),
    iat: NOW,
    exp: NOW + 60,
    guild_ref: "gapp_abc",
    app_install_id: 7,
    scope: "lifecycle",
    hook: "after_connect",
    ...extra,
  });
}

const call = (path: string, body: unknown, bearer = token()) => ({
  path,
  headers: { authorization: `Bearer ${bearer}` },
  body,
});

describe("hookName", () => {
  it("reads the hook from the path and nothing else", () => {
    expect(hookName(`${HOOKS_PATH}/after_connect`)).toBe("after_connect");
    expect(hookName(`${HOOKS_PATH}/revoke?x=1`)).toBe("revoke");
    expect(hookName(`${HOOKS_PATH}/other`)).toBeNull();
    expect(hookName("/v1/endpoints")).toBeNull();
  });
});

describe("handleHook", () => {
  it("hands after_connect the call and answers with the managed values", async () => {
    const afterConnect = vi.fn(async () => ({
      values: { owner: "acme", installation_id: "42" },
      account_label: "acme",
    }));
    const response = await handleHook(
      call(`${HOOKS_PATH}/after_connect`, {
        connection: "workspace",
        actor: "installation",
        access_token: "ghu_1",
        params: { installation_id: "42", ignored: 3 },
      }),
      { after_connect: afterConnect },
      verify
    );
    expect(response).toEqual({
      status: 200,
      body: { values: { owner: "acme", installation_id: "42" }, account_label: "acme" },
    });
    expect(afterConnect).toHaveBeenCalledWith(
      {
        connection: "workspace",
        actor: "installation",
        access_token: "ghu_1",
        params: { installation_id: "42" },
      },
      expect.objectContaining({ scope: "lifecycle", hook: "after_connect", app_install_id: 7 })
    );
  });

  it("passes a refusal through", async () => {
    const response = await handleHook(
      call(`${HOOKS_PATH}/after_connect`, {
        connection: "workspace",
        actor: "member",
        access_token: "ghu_1",
      }),
      { after_connect: async () => ({ refuse: true }) },
      verify
    );
    expect(response).toEqual({ status: 200, body: { refuse: true } });
  });

  it("answers revoke with 204", async () => {
    const revoke = vi.fn(async () => undefined);
    const response = await handleHook(
      call(
        `${HOOKS_PATH}/revoke`,
        { connection: "account", access_token: "gho_1", refresh_token: null },
        token({ hook: "revoke" })
      ),
      { revoke },
      verify
    );
    expect(response).toEqual({ status: 204 });
    expect(revoke).toHaveBeenCalledWith(
      { connection: "account", access_token: "gho_1", refresh_token: null },
      expect.objectContaining({ hook: "revoke" })
    );
  });

  it("hands webhook the vendor's headers and raw body and answers 204", async () => {
    const webhook = vi.fn(async () => undefined);
    const body = '{"action":"opened","installation":{"id":42}}';
    const response = await handleHook(
      call(
        `${HOOKS_PATH}/webhook`,
        {
          connection: "workspace",
          headers: { "X-GitHub-Event": "issues", "x-github-delivery": "d-1", other: 3 },
          body,
        },
        token({ hook: "webhook" })
      ),
      { webhook },
      verify
    );
    expect(response).toEqual({ status: 204 });
    expect(webhook).toHaveBeenCalledWith(
      {
        connection: "workspace",
        headers: { "x-github-event": "issues", "x-github-delivery": "d-1" },
        body,
      },
      expect.objectContaining({ hook: "webhook" })
    );

    const unparsed = await handleHook(
      call(
        `${HOOKS_PATH}/webhook`,
        { connection: "workspace", headers: {}, body: {} },
        token({ hook: "webhook" })
      ),
      { webhook },
      verify
    );
    expect(unparsed.status).toBe(400);
  });

  it("refuses a token minted for another hook", async () => {
    const response = await handleHook(
      call(`${HOOKS_PATH}/revoke`, { connection: "account" }),
      { revoke: async () => undefined },
      verify
    );
    expect(response.status).toBe(401);
  });

  it("refuses a missing or endpoint token", async () => {
    const missing = await handleHook(
      { path: `${HOOKS_PATH}/after_connect`, headers: {}, body: {} },
      { after_connect: async () => ({}) },
      verify
    );
    expect(missing.status).toBe(401);
    const endpoint = await handleHook(
      call(`${HOOKS_PATH}/after_connect`, {}, token({ scope: "endpoint", hook: undefined })),
      { after_connect: async () => ({}) },
      verify
    );
    expect(endpoint.status).toBe(401);
  });

  it("answers 404 for a hook the app does not handle", async () => {
    const response = await handleHook(call(`${HOOKS_PATH}/revoke`, {}), {}, verify);
    expect(response.status).toBe(404);
  });

  it("answers 400 for a body that is not the hook's shape", async () => {
    const response = await handleHook(
      call(`${HOOKS_PATH}/after_connect`, { connection: "workspace", actor: "robot" }),
      { after_connect: async () => ({}) },
      verify
    );
    expect(response.status).toBe(400);
  });

  it("answers 500 when the handler throws", async () => {
    const response = await handleHook(
      call(`${HOOKS_PATH}/after_connect`, {
        connection: "workspace",
        actor: "member",
        access_token: "ghu_1",
      }),
      {
        after_connect: async () => {
          throw new Error("vendor down");
        },
      },
      verify
    );
    expect(response.status).toBe(500);
  });
});
