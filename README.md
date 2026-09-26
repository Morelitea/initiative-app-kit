# initiative-app-sdk

Build an app for [Initiative](https://github.com/Morelitea/initiative): a
service that reads and writes a community's content, answers Initiative's
calls, and draws tiles on its dashboards.

An app is its logic. You write one typed definition of its endpoints, hooks,
schedules, widgets and listing; the SDK serves it, verifies Initiative's calls,
holds its tokens, and builds its manifest.

| Import | Holds |
|---|---|
| `initiative-app-sdk/manifest` | `defineApp`, `defineEndpoint`, the contract's types, `validateManifest` |
| `initiative-app-sdk/server` | `createApp`, `serve`, `EndpointError` |
| `initiative-app-sdk/client` | `Initiative` and the `Client` it gives, acting as the community or a member; app keys |
| `initiative-app-sdk/widget` | What a widget is handed, and the scenes it returns |
| bin `initiative-app` | `build`, `validate`, `keygen`, `uid`, `schema` |

Node 20 or later. One runtime dependency (`ajv`); everything cryptographic uses
`node:crypto`. `initiative-app build` bundles widgets with
[esbuild](https://esbuild.github.io/), which you install beside the SDK:

```sh
npm install initiative-app-sdk
npm install --save-dev esbuild
```

## 1. Define the app

```ts
// src/app.ts
import { defineApp, defineEndpoint } from "initiative-app-sdk/manifest";

export const openTickets = defineEndpoint({
  direction: "read",
  label: { en: "Open tickets" },
  params: { project: { type: "string", label: { en: "Project" } } },
  returns: {
    titles: { type: "string", list: true },
    total: "int",
  },
  handler: async ({ params, installation, client }) => {
    const tickets = await lookUp(installation, params.project);
    return { result: { titles: tickets.map((ticket) => ticket.title), total: tickets.length } };
  },
});

export default defineApp({
  publicId: "acme.tracker",
  uid: "K7M2QX8N4TVB9C", // npx initiative-app uid, once
  name: "Acme Tracker",
  scopes: ["projects:read", "comments:write"],
  endpoints: { "open-tickets": openTickets },
  schedules: {
    sweep: { every: "15m", run: async ({ since, installation, client }) => { /* … */ } },
  },
  widgets: {
    "open-count": {
      meta: { name: { en: "Open tickets" } },
      endpoints: ["open-tickets"],
      module: "src/widgets/open-count.ts",
      sample_data: { "open-tickets": { total: 12 } },
    },
  },
});
```

- **Types come from the definition.** An endpoint's `params` type what its
  handler is handed, and its `returns` type what the handler answers with: a
  return of the wrong type, or one the endpoint does not declare, does not
  compile. A widget or a summary naming an endpoint that is not a declared read
  does not compile either.
- **Endpoints are named by their key.** The manifest id is
  `app.<publicId>.<key>`, and everywhere the definition refers to an endpoint
  (a widget, a sample, a parameter's `options_from`, a bundled dashboard) it
  uses the key.
- **Everything else is the contract's own shape**, from
  [`manifest.contract.json`](manifest.contract.json): `vendor`, `connections`
  (keyed by id), `webhooks`, `surfaces` (the contract's embeds, keyed by id),
  `dashboards`. The types are generated from the contract, so every term the
  contract declares has a type here.
- **Features follow from what is filled in.** An app with widgets declares
  `widgets`, and so on.

### What a handler is handed

| | |
|---|---|
| `params` | What the caller sent, by the declared names. Initiative sends strings; an automation may send numbers and booleans as they are. |
| `installation` | The community, by the reference this app's install knows it by. What your own rows key on. |
| `actor` | `{ kind: "installation" }`, or `{ kind: "member", member }` when another app called as one of the community's members. |
| `caller` | The app that made the call through Initiative, or null for Initiative's own. |
| `initiative` | The initiative the call is confined to, or null. |
| `connections` | Connection id → the handle Initiative gives a vendor token for. |
| `client` | Initiative, already acting as `actor` and narrowed to `initiative`. |
| `context` | What you gave `createApp` (below). |

A handler answers `{ result }`, and `actor` too when the call ran on another
credential than the call's own (a read that always uses the community's
installation, say). To refuse, throw `new EndpointError(status, code, detail)`;
anything else thrown is answered 500 and logged.

A `write` is reachable only through another app, as one of the actors it
declares, and only when it is `public`. The SDK refuses anything else before
the handler runs.

### Hooks

```ts
hooks: {
  after_connect: async ({ connection, actor, access_token, params, client }) => {
    const login = await vendorLogin(access_token);
    return { values: { login }, account_label: `@${login}` }; // or { refuse: true }
  },
  revoke: async ({ connection, access_token, refresh_token }) => { /* end the grant */ },
  webhook: async ({ connection, headers, body, client }) => {
    await client.emitEvent({ eventType: "app.acme.tracker.ticket-opened", payload: { number: 7 } });
  },
},
```

- `after_connect` runs once a connection's flow has exchanged its code, when
  the flow sets `after_connect`.
- `revoke` runs when a connection whose flow says `revoke: "hook"` ends.
- `webhook` runs once per community for each vendor delivery Initiative
  received, checked and routed; `headers` are the vendor's `x-` headers,
  lowercased, and `body` is exactly what the vendor sent.
- Each schedule's `run` is called once per community each interval, with
  `since`: when it last succeeded there, or null the first time.

A hook that throws is answered 500: a connection is then not recorded, and a
delivery or a schedule is tried again.

### Surfaces

A surface is one of your app's pages, framed by Initiative:

```ts
surfaces: {
  board: {
    path: "/board",
    name: { en: "Board" },
    scopes: ["initiative"],
    handler: async ({ request, handoff }) => {
      if (!handoff) return servePage(request); // the page's own files
      return startSession(handoff.viewer, handoff.initiative);
    },
  },
},
```

Initiative hands the frame a one-use handoff token. Send it from the page to
any path under the surface's as `Authorization: Bearer …`: the SDK verifies it
(type, signature, audience, surface, and that it was not used before) and hands the
handler `viewer`, `admin`, `initiative` and a `client` acting as the
installation, narrowed to that initiative.

## 2. Widgets

A widget is a module exporting `render`, typed from the endpoint it draws:

```ts
// src/widgets/open-count.ts
import type { Scene, WidgetData } from "initiative-app-sdk/widget";
import type { openTickets } from "../app.js";

export function render(data: WidgetData<typeof openTickets>): Scene {
  return { v: 1, scene: { kind: "metric", value: data.values.total ?? 0, label: "Open" } };
}
```

`data.rows` holds one entry per index across the endpoint's `list` returns,
and `data.values` its single-valued returns. `render` also receives the tile's
options and `{ locale, slots }`.

The build bundles each widget, with everything it imports, into the one script
Initiative runs in a sandbox with no network, DOM or timers, and checks the
contract's size cap. A widget imports nothing at run time.

## 3. Build

```sh
npx initiative-app build              # writes manifest.json
npx initiative-app build --check      # CI: fails if manifest.json is stale
```

`build` reads `src/app.ts` (`--app <file>` for another), bundles the widgets,
checks the result with `validateManifest`, and writes `manifest.json`. Commit
it and ship it with the app: the server serves it, and refuses to start if it
no longer matches the definition.

## 4. Serve

```ts
// src/main.ts
import app from "./app.js";
import { createApp, serve } from "initiative-app-sdk/server";

serve(createApp(app));
```

`createApp(app, options)` returns a web-standard `(Request) => Promise<Response>`
handler, so the same app runs on any runtime, or behind any framework, that
speaks `Request` and `Response`. `serve` runs it on `node:http`, on `PORT`
(default 8080).

| Route | |
|---|---|
| `GET /healthz`, `GET /readyz` | Answer once the process is up. |
| `GET /.well-known/jwks.json` | The app's public key. |
| `GET /.well-known/initiative-app.json` | The manifest document: the manifest with the app's id, uid and name. |
| `GET, POST /v1/endpoints` | What the app declares; Initiative's endpoint calls, on a context token. |
| `POST /v1/hooks/{name}` | Initiative's hook calls, on a lifecycle token for that hook. |
| a surface's path | The surface's handler. |

Every call's token is verified against the deployment's JWKS, which is cached
and refetched once for a key it does not know. Each kind carries its own `typ`
(`initiative-context+jwt` on endpoint and hook calls, `initiative-handoff+jwt` on
a page handoff), and each path takes only its own kind. Bodies are capped at 5 MiB. A
refusal answers `{ "error": code, "detail": sentence }`.

| Option | Default | |
|---|---|---|
| `baseUrl` | `INITIATIVE_BASE_URL` | Initiative's API as the app reaches it, such as `http://initiative:8173/api/v1`. |
| `key` | `INITIATIVE_APP_PRIVATE_KEY`, `INITIATIVE_APP_KEY_ID` | The app's key: PEM, PEM with literal `\n`, or base64 of the PEM, and the `kid` it is registered under (default: its RFC 7638 thumbprint). |
| `dataDir` | `INITIATIVE_APP_DATA_DIR`, else `data` | With no key given, one is generated on first start and kept here as `app-key.pem`. |
| `manifest` | `manifest.json` | The built manifest. |
| `context` | | Handed to every handler as `context`. |
| `fetch`, `now`, `log`, `env` | | For tests and other runtimes. |

**The app's key.** With no key given, the app generates an ES256 key the first
time it starts, keeps it, and serves its public half at
`/.well-known/jwks.json`. A self-hosted operator registers the app by that
JWKS, and nothing about the app changes. To bring your own key:

```sh
npx initiative-app keygen --alg ES256 --out ./secrets
```

`private-key.pem` (mode 0600) stays with the app; `jwks.json` is its public
half. To rotate, publish a JWKS holding both keys, switch the app to the new
one, then drop the old entry.

**Context.** Your own services reach handlers as `context`. Say what it holds
once:

```ts
declare module "initiative-app-sdk/manifest" {
  interface AppContext {
    tracker: TrackerClient;
  }
}

serve(createApp(app, { context: { tracker: new TrackerClient() } }));
```

## 5. Call Initiative

A handler's `client` already acts for its call. Outside a call, make one:

```ts
import { Initiative, loadPrivateKey } from "initiative-app-sdk/client";

const initiative = new Initiative({
  baseUrl: "https://initiative.example.com/api/v1",
  publicId: "acme.tracker",
  key: loadPrivateKey(pem, "app-1"),
});

for (const { installation, active } of await initiative.installations()) {
  if (!active) continue; // paused: keep what you hold for it
  const client = initiative.asInstallation(installation);
  await client.request("GET", "/projects/", { scope: "projects:read" });
}
```

- `asInstallation(installation, { initiative, scopes })` acts as the community,
  optionally narrowed to one initiative the app is placed in and fewer scopes.
- `asMember(installation, member, { purpose, initiative })` acts for one
  member, within what they consented to (`client.requestConsent(…)`);
  `ConsentRequiredError` says they have not.
- `client.request(method, path, { scope, body })` calls a community route (the
  path after `/c/{guild}`). It is not sent unless the token holds `scope`:
  `MissingScopeError` names the scope instead. Writing implies reading.
- `client.callApp(publicId, endpointId, params)` calls another app's public
  endpoint through Initiative. It needs `apps:<publicId>` among the app's
  scopes, granted by the community.
- The installation itself, on any installation token: `client.config()`,
  `client.connections()`, `client.connectionToken(ref)` for a usable vendor
  token, `client.reportConfigStatus({ state, detail })`, and
  `client.emitEvent({ eventType, payload, initiativeId })`.

The app authenticates with its key (`private_key_jwt`, RFC 7523). Tokens are
opaque; the client caches each until shortly before it expires, shares one
request between concurrent callers, and sends a call answered 401 once more on
a fresh token. A refusal raises `InitiativeApiError` with Initiative's
`detail`; the token endpoint's own refusal raises `InitiativeAuthError`.

## 6. Publish

Initiative installs apps from signed registries. A listing names the app, its
versions, the container image each runs (pinned by digest), the app's public
keys and the most it may ever be granted. Declare it in the definition:

```ts
listing: {
  publisher: "acme",
  summary: "Your tracker's tickets on a dashboard and in your automations.",
  description: "…",
  avatar: "assets/avatar.png",
  version: "1.2.0",
  minAppVersion: "0.72.0",
  releaseNotes: "…",
  image: "ghcr.io/acme/tracker@sha256:…",
  jwks: { keys: [/* the public half of the app's key */] },
},
```

```sh
npx initiative-app build --registry ../registry/sources
```

writes the app's registry source under `<publisher>/<uid>/`: `listing.json`,
this version's `<version>/manifest.json` and the avatar. It is written only
while `listing.version` is the package's own version: between releases the
package runs ahead of its listing, and a new version is listed at its release,
with its image's digest. The registry's CI checks and signs what is merged.

A self-hosted operator can also add an app that is in no registry, by
uploading its listing file under **Settings → Platform**.

## Validating by hand

```sh
npx initiative-app validate manifest.json   # a manifest, or a served manifest document
npx initiative-app schema                   # the JSON Schema it checks against
```

`validateManifest` runs the bundled JSON Schema, then the checks a schema
cannot express: features against the blocks present, ids that must name
something the manifest declares, connection and schedule rules, and every term
the contract does not declare (a deployment discards those without saying so).
The deployment also enforces byte-size caps.

## The contract

`manifest.contract.json` is the one hand-written statement of what a manifest
may say. `schemas/app-manifest.json` and `src/contract.ts` (its types) are
generated from it with `npm run generate`; `npm run check:generated` fails when
either is stale. Initiative vendors the contract from this repository's tags.

## Scopes

| Scope | Grants |
|---|---|
| `projects:read`, `projects:write` | Projects and what belongs to them: tasks, statuses, checklists. |
| `documents:read`, `documents:write` | Documents. |
| `queues:read`, `queues:write` | Queues, their items and commands. |
| `counter_groups:read`, `counter_groups:write` | Counter groups, their counters and commands. |
| `calendars:read`, `calendars:write` | Calendars, events and attendees. |
| `dashboards:read`, `dashboards:write` | Dashboards. |
| `posts:read`, `posts:write` | Posts, including pinning. |
| `galleries:read`, `galleries:write` | Galleries. |
| `wikis:read`, `wikis:write` | Wikis and their pages. |
| `comments:read`, `comments:write` | Comments on what the app can read. |
| `relationships:read`, `relationships:write` | Links between items the app can reach. |
| `tags:read`, `tags:write` | Reading, creating and applying tags. |
| `sharing:read`, `sharing:write` | Seeing who has access to something, and changing it where the app's own access allows it. |
| `members:read` | The roster, as references, display names and avatars. |
| `initiatives:read` | The initiatives the app is placed in. |
| `apps:<public id>` | Calling that app's public endpoints through Initiative. One per app. |

Writing implies reading. Within its scopes an app still sees only what is open
to the initiative, shared with the app, or created by it.

## Licence

MIT
