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
| `initiative-app-sdk/testing` | A declarative app's requests and maps, run against recorded vendor answers |
| bin `initiative-app` | `init`, `build`, `pack`, `dev`, `validate`, `keygen`, `uid`, `schema` |

Node 20 or later. Two runtime dependencies, `ajv` and `jsonata`; everything
cryptographic uses `node:crypto`. `initiative-app build` bundles widgets with
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
- `revoke` runs when a connection whose flow says `revoke: "hook"` ends. A
  flow can instead have Initiative end the grant itself: `rfc7009` posts to
  `revoke_url`, and `github_grant` sends GitHub's "Delete an app authorization"
  (`DELETE` with the client's credentials and the access token) to it.
- `webhook` runs once per community for each vendor delivery Initiative
  received, checked and routed; `headers` are the vendor's `x-` headers,
  lowercased, and `body` is exactly what the vendor sent.
- Each schedule's `run` is called once per community each interval, with
  `since`: when it last succeeded there, or null the first time.

A hook that throws is answered 500: a connection is then not recorded, and a
delivery or a schedule is tried again.

### The vendor's own setup

`vendor.fields` are the values an operator gives once per deployment for the
vendor's client. When the vendor can create that client itself, `vendor.setup`
says how, and Initiative runs it from the operator's browser and writes what
the vendor answers into those fields. One kind exists, `github_app_manifest`
(GitHub's app manifest flow):

```ts
vendor: {
  fields: [
    { key: "app_id", type: "string", required: true, label: { en: "App id" } },
    { key: "private_key", type: "secret", required: true, label: { en: "Private key" } },
    // …
  ],
  setup: {
    kind: "github_app_manifest",
    app: {
      name: "Acme Tracker",
      url: "https://tracker.acme.example",
      default_permissions: { issues: "write", metadata: "read" },
      default_events: ["issues"],
    },
    values: { app_id: "id", private_key: "pem" /* , … */ },
  },
},
```

- `app` is what GitHub is asked to create: its name, its homepage (https),
  whether any account may install it (`public`, default false), and its
  permissions and events by GitHub's names. Initiative fills in the callback,
  setup, webhook and redirect URLs itself, so `app` names none.
- `values` maps each of your vendor field keys to one field of GitHub's answer:
  `id`, `slug`, `client_id`, `client_secret`, `pem` or `webhook_secret`. Each
  key must be a vendor field, each answer is written at most once, and
  `client_secret`, `pem` and `webhook_secret` go to `secret` fields.

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
`/.well-known/jwks.json`. The deployment running it registers that JWKS with
Initiative, beside where the app runs, in its `APP_SERVICES_CONFIG` entry or
under **Settings → Platform → Integrations → App services**. At every start
the app logs each key it serves:

```text
app key fingerprint: <thumbprint> (kid <kid>)
```

The fingerprint is the key's RFC 7638 SHA-256 thumbprint, base64url without
padding, the value Initiative shows when the operator connects the app, so the
two can be compared. `jwkThumbprint` from `initiative-app-sdk/client` computes
it for a JWKS entry. To bring your own key:

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
  const { items } = await client.api.listProjects({ query: { initiative_id: 12 } });
}
```

- `asInstallation(installation, { initiative, scopes })` acts as the community,
  optionally narrowed to one initiative the app is placed in and fewer scopes.
- `asMember(installation, member, { purpose, initiative })` acts for one
  member, within what they consented to (`client.requestConsent(…)`);
  `ConsentRequiredError` says they have not.
- `client.api` has a typed method for every route Initiative's app API
  describes, named after the route's operation id in camel case. A call takes
  its arguments by where they go, and answers the route's typed response:

  ```ts
  const task = await client.api.updateTask({ path: { task_id: 7 }, body: { title: "Ship it" } });
  await client.api.archiveEntity({ path: { entity_type: "document", entity_id: 3 } });
  ```

  No call is sent unless the token holds the scope it needs: the route's own,
  the one its argument picks (`archiveEntity` on a `document` needs
  `documents:write`), or, where Initiative checks each item, at least one of
  them. `MissingScopeError` names the scope instead. Writing implies reading.

  `client.api` follows Initiative's app API: when Initiative renames or moves a
  route, the method changes with it in the SDK release built from that
  Initiative release, without a major version. The rest of the SDK follows
  semantic versioning.
  `AppApiSchemas["TaskRead"]` names a schema's type.
- `client.request(method, path, { scope, body })` calls a community route (the
  path after `/c/{guild}`) by hand, with the same scope check.
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
versions, the container image each runs (pinned by digest) and the most it may
ever be granted. It names no keys: each deployment runs its own copy of the
image and registers the key that copy signs with. Declare it in the definition:

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
  compose: {
    service: `tracker:
  image: \${IMAGE}
  environment:
    INITIATIVE_URL: \${INITIATIVE_URL}
  volumes: [tracker-keys:/data]`,
    baseUrl: "http://tracker:8080",
  },
},
```

`compose` is optional: the Docker Compose service an operator copies to run
your image beside Initiative, which Initiative shows on the app's settings
page. `service` is the fragment, YAML text of at most 4096 characters, with two
placeholders Initiative fills: `${IMAGE}` (`image`, pinned by its digest) and
`${INITIATIVE_URL}` (the deployment's public address). Any other `${…}` fails
the build, so a misspelt placeholder cannot ship. `baseUrl` is where the
service answers on the Compose network, an http or https URL of at most 512
characters; Initiative pre-fills the deployment's base URL with it.

```sh
npx initiative-app build --registry ../registry/sources
```

writes the app's registry source under `<publisher>/<uid>/`: `listing.json`,
this version's `<version>/manifest.json` and the avatar. It is written only
while `listing.version` is the package's own version: between releases the
package runs ahead of its listing, and a new version is listed at its release,
with its image's digest. The registry's CI checks and signs what is merged.

A self-hosted deployment can also publish an app that is in no registry, from
its listing file: see [A private app](#a-private-app).

## Declarative integrations

An app that only calls a vendor's API and reshapes the answer needs no
container. Name the `hosts` it calls and give each endpoint a `request` and a
`map` in place of a handler: Initiative makes the call with the connection's
credential, and maps the answer itself. The app has no `service` block, no
image and nothing to run, and its listing registers it as `declarative`.

```ts
// src/app.ts
import { defineApp, defineEndpoint } from "initiative-app-sdk/manifest";

export const openIssues = defineEndpoint({
  direction: "read",
  label: { en: "Open issues" },
  params: { repo: { type: "string", label: { en: "Repository" }, required: true } },
  requires: { all_of: ["account"] },
  returns: { titles: { type: "string", list: true }, total: "int" },
  request: {
    method: "GET",
    url: '"https://api.tracker.example/repos/" & params.repo & "/issues"',
    query: { state: '"open"' },
    connection: "account",
  },
  map: '{"titles": response.body.title[], "total": $count(response.body)}',
});

export default defineApp({
  publicId: "acme.tracker",
  uid: "K7M2QX8N4TVB9C",
  name: "Acme Tracker",
  hosts: ["api.tracker.example"],
  connections: {
    account: {
      scope: "interactive",
      label: { en: "Your account" },
      fields: [],
      flow: {
        type: "oauth2",
        authorize_url: "https://tracker.example/oauth/authorize",
        token_url: "https://tracker.example/oauth/token",
        client_id: "{vendor.client_id}",
      },
    },
  },
  vendor: { fields: [{ key: "client_id", type: "string", required: true, label: { en: "Client id" } }] },
  endpoints: { "open-issues": openIssues },
  listing: { publisher: "acme", summary: "Your tracker's issues.", avatar: "assets/avatar.png", version: "1.0.0" },
});
```

```ts
// test/open-issues.test.ts
import { expect, it } from "vitest";
import { runEndpoint } from "initiative-app-sdk/testing";
import app from "../src/app.js";
import issues from "./fixtures/issues.json" with { type: "json" };

it("lists a repository's open issues", async () => {
  const run = await runEndpoint(app, "open-issues", {
    params: { repo: "acme/web" },
    now: "2026-10-01T12:00:00Z",
    responses: [{ status: 200, body: issues }],
  });
  expect(run.requests).toEqual([
    {
      method: "GET",
      url: "https://api.tracker.example/repos/acme/web/issues?state=open",
      headers: {},
      connection: "account",
    },
  ]);
  expect(run).toMatchObject({ result: { titles: ["Broken build"], total: 1 } });
});
```

- **Every expression is [JSONata](https://jsonata.org)**, standard, with no
  functions added: the URL, each query parameter and header, the body or a
  GraphQL request's `variables`, and the map. An expression reads `params`,
  `connection` (the non-secret fields of the connection its request names),
  `connections` (on an endpoint, each connection its `requires` names that the
  call has, by id: `connections.workspace.owner`), `now`, and once a call has
  been answered `response` (`status`, `headers`, `body`). `build` parses
  every one and fails with its place in the manifest when one does not parse.
- **Each evaluation is bounded** by the contract's `CAPS.expressionTimeMs`,
  `CAPS.expressionDepth` and `CAPS.expressionOutputBytes`; past one, or on an
  error, the call answers `unavailable: mapping-failed`. `evaluate` from
  `initiative-app-sdk/testing` runs an expression within the same bounds.
- **Credentials never enter an expression.** Initiative adds the one the
  request's `connection` names, as `auth` says: `Authorization: Bearer
  <token>` unless `auth: { header, prefix }` says otherwise. Every address
  must be https on one of `hosts`, exact or with one leading `*.` label. A
  request or step on an `interactive` connection names it in the endpoint's
  `requires` too, or `build` fails. A call made as a member carries a
  `static` connection's credential only when `requires` names it, and is
  refused otherwise.
- **`steps`** in place of `request` makes up to three calls in order; each
  reads the earlier ones as `steps.<name>`, and so does the map.
- **`paging`** on a request reads more pages before the map runs:
  `page_number`, `link_header` or `cursor`, each with `max_pages` (at most 10)
  and `on_limit`, `truncate` or `refuse`.
- **Errors.** 401 and 403 answer `unavailable: not-authorized`, 404
  `not-found`, other 4xx `invalid`, and 429, 3xx and 5xx are transient.
  `errors` rows match a status (`404` or `"4xx"`) and an optional `when`, such
  as a GraphQL error inside a 200, to a code the endpoint declares in
  `unavailable`, or to `transient`. A map may answer
  `{"unavailable": "<code>"}` itself.
- **Connections** take a declarative `after_connect` (a request, a map to
  `{values, account_label}`, and `refuse_when` with its `code`) and a
  `health` check run on an interval. **Webhooks** take `events`, each mapping
  a delivery to one of the app's emissions, and `status` rows that set a
  connection's state; a delivery may be routed by a `header` instead of a
  body `path`.
- **One app is one kind.** A declarative app has no handlers, hooks,
  schedules or surfaces, and asks for no scopes; a container app uses none of
  these terms. `validateManifest` and `build` refuse a mix.

`runEndpoint`, `runAfterConnect`, `runHealth` and `runWebhook` render each
request as Initiative sends it, less the credential, answer it from the
recorded `responses` in order, and return the requests beside the result or
the code the run answered. `runEndpoint` takes each connection's fields by id
in `connections`; it has no actor, so it does not refuse a call the way
Initiative would for who is making it. A run fails when a request has no recorded answer
left, when an answer is left over, or when the map's answer does not fit the
declared returns.

## A private app

A deployment's owner can publish an app of their own, which then sits on that
deployment's shelf beside the registry's. Start one from the example, a
declarative app with one read and one widget:

```sh
npx initiative-app-sdk init my-app      # copies examples/minimal, with a uid of its own
cd my-app && npm install && npm test
```

```sh
npx initiative-app pack                 # writes <publicId>-<version>.json
```

`pack` builds the app as `build` does, checks it the same way, and writes its
**listing file**: what the catalogue shows, this version's manifest, and the
app's registration. The deployment publishes it as it is, from
`POST /api/v1/marketplace/local/upload` (the file as `{"manifest": …}`) or from
its catalog directory (`MARKETPLACE_EXTRA_CATALOG_DIR`). The listing's picture
is named by its digest, so upload it beside the file, to
`POST /api/v1/marketplace/local/media`; PNG, JPEG, GIF and WebP are kept, and
any other picture leaves the deployment's default mark. Both routes take the
owner's session or personal API key. A container app packs too, and is live
once its service is registered on the deployment.

```sh
npx initiative-app dev --initiative https://initiative.example.com --api-key ppk_…
```

`dev` packs a declarative app and uploads it, with its picture, to your
deployment, then again a moment after each change in the directory holding
`src/app.ts`. The key may be given as `INITIATIVE_API_KEY` instead. It prints
each upload and the deployment's answer:

```text
uploaded example.gitlab-issues 1.0.0-dev.3f9a2c1b (uid ZNV2THEZGPHXXG): 201 {"uid":"ZNV2THEZGPHXXG","public_id":"example.gitlab-issues","version":"1.0.0-dev.3f9a2c1b"}
watching src for changes
```

A deployment publishes each version once, so each upload is versioned
`<listing version>-dev.<digest>`. A community that installed the app moves to
it from its Update button, or on its own if it follows updates. The app is
offered once the vendor values its manifest requires are set under the
deployment's app services.

## Validating by hand

```sh
npx initiative-app validate manifest.json   # a manifest, or a served manifest document
npx initiative-app schema                   # the JSON Schema it checks against
```

`validateManifest` runs the bundled JSON Schema, then the checks a schema
cannot express: features against the blocks present, ids that must name
something the manifest declares, connection, vendor setup and schedule rules,
and every term the contract does not declare (a deployment discards those
without saying so). The deployment also enforces byte-size caps.

## The contract

`manifest.contract.json` is the one hand-written statement of what a manifest
may say. `schemas/app-manifest.json` and `src/contract.ts` (its types) are
generated from it with `npm run generate`; `npm run check:generated` fails when
either is stale. Initiative vendors the contract from this repository's tags.

`src/app-api.generated.ts`, behind `client.api`, is generated from Initiative's
app API description, read from Initiative itself and not stored here. Its
header names the Initiative it came from. Regenerate it from a checkout, a
release or a running deployment, with the same emitter as the contract's types:

```sh
npm run generate:app-api -- --checkout ../initiative   # runs its export with uv
npm run generate:app-api -- --release v0.75.0
npm run generate:app-api -- --url https://initiative.example.com
```

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
| `initiatives:moderate` | Acting as a moderator in an initiative it is placed in: everything there, within the app's other scopes. Only on a token that asks for it (`level=moderator`) and is narrowed to that initiative. |
| `guild:admin` | Acting with a guild admin's standing across the community, within the app's other scopes. Only on a token that asks for it (`level=guild_admin`) and is not narrowed to an initiative. |
| `apps:<public id>` | Calling that app's public endpoints through Initiative. One per app. |

Writing implies reading. Within its scopes an app still sees only what is open
to the initiative, shared with the app, or created by it — unless a token asks
for one of the two standings above. Those are never on a token by default: ask
for one with `asInstallation(installation, { initiative, level: "moderator" })`
or `asInstallation(installation, { level: "guild_admin" })`, and Initiative
refuses it unless the community granted the matching scope. A member token
takes no `level`.

## Licence

MIT
