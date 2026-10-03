/**
 * One definition, one manifest: what `defineApp` declares becomes the
 * contract's manifest with its handlers left out and its keys made ids, and
 * the definition's types refuse what the manifest could not say.
 */

import { describe, expect, it } from "vitest";

import { manifestOf } from "../src/define.js";
import { defineApp, defineEndpoint, validateManifest } from "../src/manifest.js";
import { issuesApp, trackerApp } from "./support/app.js";

const { app } = trackerApp();
const manifest = manifestOf(app, { "open-count": "globalThis.render = function () {};" });

describe("manifestOf", () => {
  it("writes the contract's manifest, in its order, with every key made an id", () => {
    expect(JSON.stringify(manifest, null, 2)).toBe(
      JSON.stringify(
        {
          app_kind: "service",
          service: { public_id: "acme.tracker", protocol: 1, scopes: ["projects:read", "apps:acme.github"] },
          features: ["dashboards", "embeds", "endpoints", "widgets"],
          default_name: "Tracker",
          vendor: { fields: [{ key: "client_id", type: "string", required: true, label: { en: "Client id" } }] },
          connections: [
            {
              id: "account",
              scope: "interactive",
              label: { en: "Your account" },
              fields: [],
              flow: {
                type: "oauth2",
                authorize_url: "https://tracker.example/authorize",
                token_url: "https://tracker.example/token",
                client_id: "{vendor.client_id}",
                after_connect: true,
                revoke: "hook",
              },
            },
          ],
          schedules: [{ id: "sweep", every: "15m" }],
          endpoints: [
            {
              id: "app.acme.tracker.projects",
              direction: "read",
              label: { en: "Projects" },
              returns: [{ key: "ids", type: "string", list: true }],
            },
            {
              id: "app.acme.tracker.open-tickets",
              direction: "read",
              label: { en: "Open tickets" },
              public: true,
              actors: ["installation", "member"],
              cache_ttl_seconds: 60,
              params: [
                {
                  key: "project",
                  type: "string",
                  label: { en: "Project" },
                  options_from: { endpoint: "app.acme.tracker.projects", key: "ids" },
                },
                { key: "labels", type: "string", label: { en: "Labels" }, list: true },
              ],
              returns: [
                { key: "titles", type: "string", list: true, label: { en: "Titles" } },
                { key: "total", type: "int" },
              ],
            },
            {
              id: "app.acme.tracker.close-ticket",
              direction: "write",
              label: { en: "Close a ticket" },
              public: true,
              actors: ["member"],
              returns: [{ key: "closed", type: "bool" }],
            },
            {
              id: "app.acme.tracker.ticket-opened",
              direction: "emit",
              label: { en: "A ticket was opened" },
              returns: [
                { key: "title", type: "string" },
                { key: "number", type: "int" },
              ],
              identity: { kind: "ticket", key: ["number"] },
            },
          ],
          community_summary: "app.acme.tracker.projects",
          widgets: [
            {
              id: "open-count",
              meta: { name: { en: "Open tickets" } },
              endpoints: ["app.acme.tracker.open-tickets"],
              module_source: "globalThis.render = function () {};",
              sample_data: { "app.acme.tracker.open-tickets": { total: 3 } },
            },
          ],
          embeds: [{ id: "board", path: "/board", name: { en: "Board" }, scopes: ["initiative"] }],
          dashboards: [
            {
              uid: "M3N4P5Q6R7S8T9",
              public_id: "acme.tracker-overview",
              name: "Overview",
              widgets: [
                {
                  type: "open-count",
                  binding: { endpoint_id: "app.acme.tracker.open-tickets", params: { project: "p1" } },
                },
              ],
            },
          ],
        },
        null,
        2
      )
    );
  });

  it("is a manifest the SDK's own validation passes", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("declares a feature only for a block that carries something", () => {
    const bare = manifestOf(defineApp({ publicId: "acme.bare", uid: "K7M2QX8N4TVB9D", name: "Bare", endpoints: {} }));
    expect(bare).toEqual({
      app_kind: "service",
      service: { public_id: "acme.bare", protocol: 1 },
      features: [],
      default_name: "Bare",
    });
  });
});

describe("a declarative definition", () => {
  const declarative = manifestOf(issuesApp());

  it("writes its hosts and no service block, and names an event's emission by id", () => {
    expect(declarative).not.toHaveProperty("service");
    expect(Object.keys(declarative).slice(0, 5)).toEqual(["app_kind", "features", "default_name", "hosts", "vendor"]);
    expect(declarative.hosts).toEqual(["api.tracker.example", "*.tracker.example"]);
    expect(declarative.webhooks?.events?.[0].emit).toBe("app.acme.issues.issue-opened");
    expect(declarative.endpoints?.[1]).toMatchObject({ id: "app.acme.issues.label", steps: [{ name: "current" }, { name: "set" }] });
  });

  it("is a manifest the SDK's own validation passes", () => {
    expect(validateManifest(declarative, { publicId: "acme.issues" })).toEqual([]);
  });
});

describe("the definition's types", () => {
  it("type a handler from its endpoint's params and returns", () => {
    defineEndpoint({
      direction: "read",
      params: { repo: { type: "string", label: { en: "Repository" } }, tags: { type: "string", label: { en: "Tags" }, list: true } },
      returns: { names: { type: "string", list: true }, total: "int", open: "bool" },
      handler: async (call) => {
        const repo: string | number | boolean | undefined = call.params.repo;
        const tags: Array<string | number | boolean> | undefined = call.params.tags;
        // @ts-expect-error an undeclared parameter
        void call.params.branch;
        void repo;
        void tags;
        return { result: { names: ["a"], total: 2, open: null } };
      },
    });
    defineEndpoint({
      direction: "read",
      returns: { total: "int" },
      // @ts-expect-error a return of the wrong type
      handler: async () => ({ result: { total: "two" } }),
    });
    defineEndpoint({
      direction: "read",
      returns: { names: { type: "string", list: true } },
      // @ts-expect-error a single value where a list is declared
      handler: async () => ({ result: { names: "a" } }),
    });
    defineEndpoint({
      direction: "read",
      returns: { total: "int" },
      // @ts-expect-error a return the endpoint does not declare
      handler: async () => ({ result: { count: 1 } }),
    });
  });

  it("keep an endpoint to a handler or a request and a map", () => {
    defineEndpoint({ direction: "read", request: { method: "GET", url: '"https://x.example"', connection: "c" }, map: "{}" });
    // @ts-expect-error a map with nothing to map
    defineEndpoint({ direction: "read", map: "{}" });
    // @ts-expect-error a request beside steps
    defineEndpoint({ direction: "read", request: { method: "GET", url: "u" }, steps: [], map: "{}" });
    defineEndpoint({
      direction: "read",
      request: { method: "GET", url: "u" },
      map: "{}",
      // @ts-expect-error an endpoint with a request has no handler
      handler: async () => ({ result: {} }),
    });
  });

  it("name an event's emission by its key", () => {
    const emitted = defineEndpoint({ direction: "emit", returns: { n: "int" } });
    const read = defineEndpoint({ direction: "read", request: { method: "GET", url: "u", connection: "c" }, map: "{}" });
    const name = { publicId: "acme.x", uid: "K7M2QX8N4TVB9E", name: "X", hosts: ["x.example"] };
    const webhooks = { verify: issuesApp().webhooks!.verify, dedup: "X-Delivery", route: { path: "a", connection: "c", field: "f" } };
    defineApp({ ...name, endpoints: { emitted, read }, webhooks: { ...webhooks, events: [{ when: "true", emit: "emitted", map: "{}" }] } });
    // @ts-expect-error a read is not emitted
    defineApp({ ...name, endpoints: { emitted, read }, webhooks: { ...webhooks, events: [{ when: "true", emit: "read", map: "{}" }] } });
  });

  it("refuse a widget or a summary naming an endpoint that is not a declared read", () => {
    const read = defineEndpoint({ direction: "read", returns: { total: "int" }, handler: async () => ({ result: {} }) });
    const write = defineEndpoint({ direction: "write", handler: async () => ({ result: {} }) });
    const name = { publicId: "acme.x", uid: "K7M2QX8N4TVB9E", name: "X" };
    defineApp({ ...name, endpoints: { read, write }, widgets: { w: { meta: {}, module: "w.ts", endpoints: ["read"] } } });
    // @ts-expect-error not declared
    defineApp({ ...name, endpoints: { read, write }, widgets: { w: { meta: {}, module: "w.ts", endpoints: ["missing"] } } });
    // @ts-expect-error a write draws nothing
    defineApp({ ...name, endpoints: { read, write }, widgets: { w: { meta: {}, module: "w.ts", endpoints: ["write"] } } });
    // @ts-expect-error a summary is a read
    defineApp({ ...name, endpoints: { read, write }, communitySummary: "write" });
  });
});
