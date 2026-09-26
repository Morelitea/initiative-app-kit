/** An app declaring one of everything, recording what each handler was handed. */

import { defineApp, defineEndpoint, type Call } from "../../src/manifest.js";
import { EndpointError } from "../../src/server.js";

export function trackerApp() {
  const seen: Array<{ name: string; call: Call & Record<string, unknown> }> = [];
  const record = (name: string, call: Call) => seen.push({ name, call: call as Call & Record<string, unknown> });

  const projects = defineEndpoint({
    direction: "read",
    label: { en: "Projects" },
    returns: { ids: { type: "string", list: true } },
    handler: async (call) => {
      record("projects", call);
      return { result: { ids: ["p1", "p2"] } };
    },
  });

  const openTickets = defineEndpoint({
    direction: "read",
    label: { en: "Open tickets" },
    public: true,
    actors: ["installation", "member"],
    cache_ttl_seconds: 60,
    params: {
      project: { type: "string", label: { en: "Project" }, options_from: { endpoint: "projects", key: "ids" } },
      labels: { type: "string", label: { en: "Labels" }, list: true },
    },
    returns: { titles: { type: "string", list: true, label: { en: "Titles" } }, total: "int" },
    handler: async (call) => {
      record("open-tickets", call);
      if (call.params.project === "refuse") throw new EndpointError(409, "not-configured", "no project yet");
      if (call.params.project === "fail") throw new Error("the vendor fell over");
      return { result: { titles: ["Broken build"], total: 1 }, ...(call.params.project === "mine" ? { actor: "member" as const } : {}) };
    },
  });

  const closeTicket = defineEndpoint({
    direction: "write",
    label: { en: "Close a ticket" },
    public: true,
    actors: ["member"],
    returns: { closed: "bool" },
    handler: async (call) => {
      record("close-ticket", call);
      return { result: { closed: true } };
    },
  });

  const ticketOpened = defineEndpoint({
    direction: "emit",
    label: { en: "A ticket was opened" },
    returns: { title: "string", number: "int" },
    identity: { kind: "ticket", key: ["number"] },
  });

  const app = defineApp({
    publicId: "acme.tracker",
    uid: "K7M2QX8N4TVB9C",
    name: "Tracker",
    scopes: ["projects:read", "apps:acme.github"],
    vendor: { fields: [{ key: "client_id", type: "string", required: true, label: { en: "Client id" } }] },
    connections: {
      account: {
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
    },
    schedules: {
      sweep: {
        every: "15m",
        run: async (call) => {
          record("sweep", call);
        },
      },
    },
    endpoints: {
      projects,
      "open-tickets": openTickets,
      "close-ticket": closeTicket,
      "ticket-opened": ticketOpened,
    },
    guildSummary: "projects",
    hooks: {
      after_connect: async (call) => {
        record("after_connect", call);
        if (call.access_token === "fail") throw new Error("the vendor would not say");
        return call.access_token === "stranger" ? { refuse: true } : { account_label: "@alice" };
      },
      revoke: async (call) => {
        record("revoke", call);
      },
      webhook: async (call) => {
        record("webhook", call);
      },
    },
    widgets: {
      "open-count": {
        meta: { name: { en: "Open tickets" } },
        endpoints: ["open-tickets"],
        module: "widgets/open-count.ts",
        sample_data: { "open-tickets": { total: 3 } },
      },
    },
    surfaces: {
      board: {
        path: "/board",
        name: { en: "Board" },
        scopes: ["initiative"],
        handler: async ({ handoff }) =>
          Response.json({ viewer: handoff?.viewer ?? null, initiative: handoff?.initiative ?? null, admin: handoff?.admin ?? null }),
      },
    },
    dashboards: [
      {
        uid: "M3N4P5Q6R7S8T9",
        public_id: "acme.tracker-overview",
        name: "Overview",
        widgets: [{ type: "open-count", binding: { endpoint_id: "open-tickets", params: { project: "p1" } } }],
      },
    ],
  });
  return { app, seen };
}
