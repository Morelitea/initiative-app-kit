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

/** A declarative app using each of its terms: no handler, hook or service. */
export function issuesApp() {
  const api = (path: string) => JSON.stringify(`https://api.tracker.example${path}`);

  const openIssues = defineEndpoint({
    direction: "read",
    label: { en: "Open issues" },
    params: { state: { type: "select", options: ["Open", "Closed"], label: { en: "State" } } },
    returns: { titles: { type: "string", list: true }, total: "int" },
    request: {
      method: "GET",
      url: `${api("/repos/")} & connection.owner & "/issues"`,
      query: { state: "$lowercase(params.state)", labels: "params.labels" },
      headers: { Accept: '"application/json"' },
      connection: "workspace",
      paging: { kind: "page_number", page_param: "page", per_page_param: "per_page", per_page: 2, max_pages: 2, on_limit: "refuse" },
    },
    map: '{"titles": response.body.title[], "total": $count(response.body)}',
  });

  const label = defineEndpoint({
    direction: "write",
    actors: ["installation"],
    public: true,
    params: { number: { type: "int", label: { en: "Issue" }, required: true }, label: { type: "string", label: { en: "Label" } } },
    returns: { labels: { type: "string", list: true } },
    unavailable: ["locked"],
    steps: [
      { name: "current", request: { method: "GET", url: `${api("/issues/")} & params.number & "/labels"`, connection: "workspace" } },
      {
        name: "set",
        request: {
          method: "PUT",
          url: `${api("/issues/")} & params.number & "/labels"`,
          body: '{"labels": $append(steps.current.body.name, params.label)}',
          connection: "workspace",
        },
      },
    ],
    map: '{"labels": steps.set.body.name[]}',
    errors: [{ status: 422, when: 'response.body.message = "locked"', code: "locked" }],
  });

  const search = defineEndpoint({
    direction: "read",
    requires: { all_of: ["account"] },
    returns: { ids: { type: "string", list: true } },
    request: {
      method: "POST",
      url: api("/graphql"),
      graphql: { query: "query($after: String) { issues(after: $after) { nodes { id } pageInfo { endCursor hasNextPage } } }", variables: '{"after": null}' },
      connection: "account",
      paging: {
        kind: "cursor",
        next: "response.body.data.issues.pageInfo.endCursor",
        more: "response.body.data.issues.pageInfo.hasNextPage",
        variable: "after",
        items: "response.body.data.issues.nodes",
        max_pages: 3,
        on_limit: "truncate",
      },
    },
    map: '{"ids": response.body.id[]}',
  });

  const assign = defineEndpoint({
    direction: "write",
    actors: ["member"],
    public: true,
    requires: { all_of: ["workspace", "account"] },
    params: { number: { type: "int", label: { en: "Issue" }, required: true } },
    returns: { assignee: "string" },
    request: {
      method: "POST",
      url: `${api("/repos/")} & connections.workspace.owner & "/issues/" & params.number & "/assignees"`,
      body: '{"assignee": "me", "seen": $keys(connections)}',
      connection: "account",
    },
    map: '{"assignee": response.body.assignee}',
  });

  const issueOpened = defineEndpoint({
    direction: "emit",
    label: { en: "An issue was opened" },
    returns: { number: "int", title: "string" },
    identity: { kind: "issue", key: ["number"] },
  });

  return defineApp({
    publicId: "acme.issues",
    uid: "K7M2QX8N4TVB9F",
    name: "Issues",
    hosts: ["api.tracker.example", "*.tracker.example"],
    vendor: {
      fields: [
        { key: "client_id", type: "string", required: true, label: { en: "Client id" } },
        { key: "webhook_secret", type: "secret", required: true, label: { en: "Webhook secret" } },
      ],
    },
    connections: {
      workspace: {
        scope: "static",
        label: { en: "Workspace" },
        fields: [{ key: "owner", type: "string", label: { en: "Owner" }, managed: true }],
        flow: {
          type: "oauth2",
          authorize_url: "https://tracker.example/authorize",
          token_url: "https://tracker.example/token",
          client_id: "{vendor.client_id}",
          after_connect: {
            request: {
              method: "GET",
              url: api("/user/installations"),
              paging: { kind: "link_header", items: "response.body.installations", max_pages: 3, on_limit: "truncate" },
            },
            map: '($found := response.body[id = $$.params.installation_id]; {"values": {"owner": $found.account}, "account_label": $found.account})',
            refuse_when: "$not($exists(result.values.owner))",
            code: "not-installed",
          },
        },
        health: {
          request: { method: "GET", url: `${api("/installations/")} & connection.owner` },
          every: "15m",
          states: [
            { status: 404, state: "removed" },
            { status: 403, when: 'response.body.reason = "suspended"', state: "suspended" },
          ],
        },
      },
      account: {
        scope: "interactive",
        label: { en: "Your account" },
        fields: [],
        flow: {
          type: "oauth2",
          authorize_url: "https://tracker.example/authorize",
          token_url: "https://tracker.example/token",
          client_id: "{vendor.client_id}",
        },
      },
    },
    webhooks: {
      verify: { scheme: "hmac_sha256", header: "X-Signature", prefix: "sha256=", encoding: "hex", secret: "{vendor.webhook_secret}" },
      dedup: "X-Delivery",
      route: { path: "installation.account", connection: "workspace", field: "owner" },
      events: [
        {
          when: 'headers."x-event" = "issues" and payload.action = "opened"',
          emit: "issue-opened",
          map: '{"number": payload.issue.number, "title": payload.issue.title}',
        },
      ],
      status: [{ when: 'headers."x-event" = "installation" and payload.action = "suspend"', connection: "workspace", state: "suspended" }],
    },
    endpoints: { "open-issues": openIssues, label, search, assign, "issue-opened": issueOpened },
  });
}
