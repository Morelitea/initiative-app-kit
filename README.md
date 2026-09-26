# initiative-app-kit

The toolkit for apps that act in an [Initiative](https://github.com/Morelitea/initiative)
community: container and hosted apps that read and write a community's
content, answer Initiative's calls, and receive its webhooks.

- **Keys** — generate the key your app signs with, and the JWKS your
  deployment's operator registers.
- **Tokens** — installation tokens (the app acting as the community), narrowed
  to one initiative or a subset of scopes, and member tokens (the app acting for
  one member, with their consent).
- **Verification** — Initiative's per-call context token, its page handoff
  token, and its webhook signatures.
- **Connections** — Initiative runs your vendor's OAuth flow; your app answers
  two hooks and asks for an access token when it needs one.
- **Your installation** — the configuration a community gave your app, your
  members' connections, and the events your app sends back.
- **Manifests** — validate your manifest offline, against the same contract a
  deployment reads.

Node 20 or later. One runtime dependency (`ajv`); everything cryptographic uses
`node:crypto`. Examples are coming.

```sh
npm install initiative-app-kit
```

## 1. Make a key and register it

```sh
npx initiative-app keygen --alg ES256 --out ./secrets
# wrote secrets/private-key.pem (keep it secret)
# wrote secrets/jwks.json (give it to your deployment's operator)
# kid: 3q2L…
```

`--alg` is `RS256` (default) or `ES256`. `--kid` sets the key id; by default it
is the key's RFC 7638 thumbprint. `private-key.pem` is written with mode `0600`
and stays with your app. `jwks.json` holds only the public key: your
deployment's operator registers it against your app's public id, together with
the uid of your app's catalog listing.

Instead of handing the operator the file, you can publish it at an https
address on your app's own origin, such as
`https://tracker.example.com/.well-known/jwks.json`, and have the operator
register that address. Initiative reads it again about once a minute.

To rotate, generate a second key, publish (or have the operator register) a
JWKS holding both entries, switch your app to the new key, then drop the old
entry.

The same from code:

```ts
import { generateAppKeys, loadPrivateKey } from "initiative-app-kit";

const { privateKeyPem, jwks, kid } = generateAppKeys({ alg: "RS256" });
const signing = loadPrivateKey(privateKeyPem, kid); // { key, kid, alg }
```

## 2. Ask for scopes in your manifest

```json
{
  "app_kind": "service",
  "service": {
    "public_id": "acme.tracker",
    "scopes": ["projects:read", "projects:write", "comments:write", "members:read"]
  },
  "features": []
}
```

The community grants some or all of these when it installs your app, and places
the app in the initiatives it may act in. A token never carries more than was
granted. Writing implies reading.

## 3. Get an installation token

```ts
import { InitiativeAuth, guildPath } from "initiative-app-kit";
import { readFileSync } from "node:fs";

const auth = new InitiativeAuth({
  baseUrl: "https://initiative.example.com/api/v1",
  clientId: "acme.tracker", // your app's public id
  privateKey: readFileSync("secrets/private-key.pem", "utf-8"),
  kid: process.env.INITIATIVE_KEY_ID!,
});

// Where the app is installed, a page at a time, followed to the end. What each
// community granted is in the token issued for it. An inactive installation is
// paused (switched off, or its community on hold): keep what you hold for it.
// One that is gone is no longer listed.
for (const { installation, active } of await auth.listInstallations()) {
  if (!active) continue;
  const response = await auth.fetchAsInstallation(installation, guildPath("/projects/"));
  console.log(installation, await response.json());
}

// Or take the token and call Initiative yourself.
const { token, scopes, expiresAt } = await auth.installationToken({ installation: "gapp_…" });
```

`InitiativeAuth` authenticates with `private_key_jwt` (RFC 7523): each request
to `POST {baseUrl}/app-platform/oauth/token` carries a JWT your key signed,
addressed to that exact URL, living 60 seconds. Tokens are cached until 30
seconds before they expire, and concurrent callers share one request.

**Tokens are opaque.** Never decode one. The token response tells you how long
it lives and which scopes it holds.

**The community in the path.** Community routes are addressed `/c/{guild}/…`.
With an app token Initiative takes the community from the token and does not
read that segment, so the kit always writes `0` there: `guildPath("/projects/")`
is `/c/0/projects/`. Use `guildPath` for every community route.

A 401 from `fetchAsInstallation` drops the cached token, so the next call gets a
fresh one.

## Narrowing to one initiative

Something a person sets up inside one initiative should run only there. Ask for
a token narrowed to it, and optionally to fewer scopes:

```ts
await auth.fetchAsInstallation(installation, guildPath("/projects/"), {}, {
  initiativeId: 42,           // resource=urn:initiative:initiative:42 (RFC 8707)
  scopes: ["projects:read"],  // scope=projects:read (RFC 6749 §3.3)
});
```

Initiative issues a narrowed token only while your app is placed in that
initiative, and the token reaches that initiative's content and nothing
community-wide.

## Your installation's configuration

An installation token also reaches the installation itself: what the community
configured for your app, and the accounts members connected to it. These calls
take any installation token, narrowed or not, and name no community — the
installation is the token's.

```ts
// The values a community admin supplied, and the managed values your
// after_connect hook returned for each connection, decrypted. Keep them in
// memory and fetch again when you need them. Vendor tokens are not in here:
// ask for one with connectionToken.
const config = await auth.installationConfig(installation);
config.connections.admin;          // { admin_token: "…" }
config.connectionRefs.workspace;   // the community connection's handle
config.memberConnections;          // [{ connectionRef, values, … }]

// Which member connections are live, with no values.
const connections = await auth.installationConnections(installation);

// A usable vendor access token for one connection, by the handle a context
// token's connection_refs gave you. Initiative refreshes it, or mints it for
// a jwt_bearer connection.
const { accessToken, expiresAt } = await auth.connectionToken(installation, connectionRef);

// Whether the configuration you were handed works, shown to the community's
// admins.
await auth.reportConfigStatus(installation, { state: "invalid", detail: "missing_scope" });

// One of your declared events, under your own namespace, for Initiative to
// keep and deliver. The payload is at most 8 KiB; name the initiative the
// event is about, when it is about one.
await auth.emitEvent(installation, {
  eventType: "app.acme.tracker.issue_opened",
  payload: { number: 12 },
  initiativeId: 3,
});
```

A subscriber hears it when it holds `apps:<your public id>`, and Initiative
retries each delivery until the subscriber accepts it.

A refusal raises `InitiativeApiError` with Initiative's `detail` code.

## Calling another app

An app calls another app through Initiative, never directly. Ask for
`apps:<its public id>` in your manifest's scopes, and the community decides at
install whether your app may use it:

```json
"scopes": ["projects:read", "apps:acme.github"]
```

```ts
import { appScope } from "initiative-app-kit";

appScope("acme.github"); // "apps:acme.github"

// As the community, on your installation token.
const outcome = await auth.callApp(installation, "acme.github", "app.acme.github.open_issue", {
  title: "Broken build",
});
outcome.result; // what the other app answered

// As a member, on a member token: the other app acts for that member.
await auth.callApp(installation, "acme.github", "app.acme.github.comment", { body: "Done" }, {
  member: "uapp_…",
  purpose: "node-7",
  initiativeId: 42, // optional: the other app must be placed there too
});
```

Initiative checks that the community granted the scope, that the other app is
installed and switched on there, that the endpoint is public and takes that
actor, and, for a call confined to an initiative, that the other app is placed
in it. A refusal raises `InitiativeApiError` with `detail` set to
`insufficient_scope`, `target_not_installed`, `endpoint_not_public`,
`actor_not_supported` or `target_not_placed`. The member's reference is never
passed on: Initiative hands the other app its own reference for them.

A read may be answered from Initiative's cache. A write is sent once and never
retried by Initiative.

To be callable yourself, mark an endpoint `public` and say which actors it
takes:

```json
{
  "id": "app.acme.github.open_issue",
  "direction": "write",
  "public": true,
  "actors": ["installation", "member"]
}
```

A `write` endpoint is reachable only this way. The call reaches you like any
other, with the caller named in the context token (below).

## Acting for a member

Some work should be done as a person, not as the app. The member consents on
Initiative's own screen, for a purpose you name:

```ts
import { ConsentRequiredError } from "initiative-app-kit";

await auth.requestConsent({
  installation,
  member: "uapp_…",        // the member's reference for your installation
  purpose: "node-7",       // your own id for what they are consenting to
  label: "Comment on linked issues as you",
  initiativeId: 42,        // optional: bind the consent to one initiative
  access: "read_write",    // or "read"; the member may grant less
});

try {
  const { token } = await auth.memberToken({
    installation,
    member: "uapp_…",
    purpose: "node-7",
    initiativeId: 42,
  });
} catch (error) {
  if (error instanceof ConsentRequiredError) {
    // No live consent for this member and purpose: ask again, or mark the work
    // as needing consent.
  } else throw error;
}
```

A member token uses the JWT-bearer grant (RFC 7523 §2.1): one assertion your
key signs, with the member as `sub`, the installation, and the purpose. It
reaches what the member can reach, within your scopes, in the initiatives where
the app is placed, and never anything administrative. It stops working when the
member leaves or withdraws consent. Leave out `purpose` for consent to the whole
app.

Member references come from Initiative: the handoff token's `sub`, the member
roster (`members:read`), and webhook envelopes.

## Verifying Initiative's calls

Initiative calls your declared endpoints at `POST /v1/endpoints` and your hooks
at `POST /v1/hooks/{name}`, each with a context token, and sends members to
your surfaces with a handoff token. Both are RS256 JWTs from the deployment's
JWKS, with `iss` `initiative` and `aud` `initiative-app:<your public id>`.

```ts
import {
  JwksCache,
  bearerToken,
  parseInvoke,
  verifyContextToken,
  verifyHandoffToken,
} from "initiative-app-kit";

const jwks = new JwksCache();
const verify = { publicId: "acme.tracker", baseUrl: "https://initiative.example.com", jwks };

// An endpoint call.
const claims = await verifyContextToken(bearerToken(req.headers)!, verify);
const call = parseInvoke(req.body, manifest.endpoints ?? [], claims);
if (!call.ok) return res.status(400).json({ error: call.error });
// claims.guild_ref, claims.app_install_id, claims.connection_refs
// From another app, also: claims.act.sub (that app), claims.actor
// ("installation" or "member"), claims.member (your own reference for the
// member) and claims.initiative_id (when the caller was confined to one).
// connection_refs then holds only the member's connections on a member call,
// and only the community's on an installation call.

// A member opening one of your surfaces.
const handoff = await verifyHandoffToken(tokenFromTheFrame, verify);
// handoff.sub (the member), handoff.surface_id, handoff.initiative_id
```

A handoff token is for one use: record the `jti` until `exp` and refuse it a
second time.

## Connections Initiative runs

Initiative is the OAuth client for your vendor. It sends the person to the
vendor, takes the code back, exchanges it, stores the tokens, refreshes them,
and revokes them when the connection ends. Your app never holds the vendor
client's secret or a refresh token.

Declare what the operator supplies for the vendor client in a `vendor` block,
and how each connection is established in its `flow`:

```json
{
  "vendor": {
    "label": { "en": "GitHub App" },
    "fields": [
      { "key": "client_id", "type": "string", "required": true, "label": { "en": "Client id" } },
      { "key": "client_secret", "type": "secret", "required": true, "label": { "en": "Client secret" } }
    ]
  },
  "connections": [
    {
      "id": "account",
      "scope": "interactive",
      "label": { "en": "Your GitHub account" },
      "fields": [{ "key": "login", "type": "string", "label": { "en": "Login" }, "managed": true }],
      "flow": {
        "type": "oauth2",
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "client_id": "{vendor.client_id}",
        "client_secret": "{vendor.client_secret}",
        "pkce": true,
        "after_connect": true,
        "revoke": "hook"
      }
    }
  ]
}
```

- The operator enters the vendor values once per deployment, and registers two
  addresses with the vendor: `{deployment}/api/v1/app-connections/callback` and
  `{deployment}/api/v1/app-connections/setup`. Your app is not live there until
  every required vendor value is set.
- A URL or client value may name a vendor value as `{vendor.<key>}` and one of
  the connection's own fields as `{<key>}`.
- `install_url` makes a static connection installation-style: the vendor's
  install page first, then one authorization trip so your `after_connect` hook
  can check who installed it.
- `revoke` is `rfc7009` (Initiative posts to `revoke_url`), `hook` (your revoke
  hook is called with the tokens), or absent (the tokens are deleted).
- A static connection may declare a `token` of type `jwt_bearer` instead of
  keeping the flow's tokens: Initiative signs a JWT with a vendor key and
  exchanges it at `exchange_url`, caching the answer until shortly before it
  expires.
- With a flow, a connection's fields are only the managed values your
  `after_connect` hook returns.

### Answering the hooks

```ts
import { handleHook } from "initiative-app-kit";

// POST /v1/hooks/:name
const response = await handleHook(
  { path: req.path, headers: req.headers, body: req.body },
  {
    async after_connect(call, claims) {
      // call.connection, call.actor, call.access_token, call.params
      const login = await lookUpTheAccount(call.access_token);
      return { values: { login }, account_label: `@${login}` }; // or { refuse: true }
    },
    async revoke(call) {
      await endTheGrant(call.access_token, call.refresh_token);
    },
  },
  verify
);
res.status(response.status).json(response.body);
```

`handleHook` verifies the lifecycle token for the hook the path names, checks
the body, and shapes the answer. A hook that fails while a connection is being
made reads to the person as "not recorded".

When your app needs to call the vendor, it asks Initiative for the token:
`auth.connectionToken(installation, connectionRef)`.

## Your vendor's webhooks

Initiative receives your vendor's webhooks for you, at one address per app on
each deployment: `{deployment}/api/v1/app-hooks/<your public id>`. Declare how a
delivery is checked and routed:

```json
"webhooks": {
  "verify": { "scheme": "hmac_sha256", "header": "X-Hub-Signature-256",
              "prefix": "sha256=", "encoding": "hex",
              "secret": "{vendor.webhook_secret}" },
  "dedup": "X-GitHub-Delivery",
  "route": { "path": "installation.id", "connection": "workspace",
             "field": "installation_id" }
}
```

- `scheme` is `hmac_sha256` or `hmac_sha1`, over the raw body; `encoding` is
  `hex` or `base64`. The secret is one vendor value.
- `route` names a value in the JSON body, and the field of a static connection
  it is matched against, as each community's connect stored it. One vendor
  installation may belong to several communities, and each gets the delivery.
- A delivery whose `dedup` id a community has already accepted is not
  forwarded to it again.

Each delivery reaches your `webhook` hook once per community, on that
installation's lifecycle token, as
`{ connection, headers, body }`: the vendor's `x-` headers, lowercased, and the
body exactly as it arrived.

```ts
await handleHook(request, {
  async webhook(call, claims) {
    const payload = JSON.parse(call.body);
    if (call.headers["x-github-event"] === "issues" && payload.action === "opened") {
      await auth.emitEvent(claims.guild_ref, {
        eventType: "app.acme.github.issue_opened",
        payload: { number: payload.issue.number },
      });
    }
  },
}, verify);
```

Answer 2xx once the delivery is handled. Anything else has the vendor send it
again, and only the communities that have not accepted it are retried.

## Schedules

For work that runs on a clock, declare an interval and Initiative calls you,
once for each community that installed the app. Your app keeps no timer and
needs no public address.

```json
"schedules": [
  { "id": "check-installation", "every": "15m" }
]
```

- `every` is a whole number of minutes (`m`) or hours (`h`), from `5m` to
  `24h`.
- At most 8 schedules, each with its own id.

A due schedule reaches your `schedule` hook on that installation's lifecycle
token, as `{ schedule, since }`: its id, and when it last succeeded for that
installation (ISO 8601), or `null` the first time.

```ts
await handleHook(request, {
  async schedule(call, claims) {
    if (call.schedule === "check-installation") {
      const { access_token } = await auth.connectionToken(claims.guild_ref, workspaceRef);
      await checkTheInstallation(access_token, call.since);
    }
  },
}, verify);
```

Answer 2xx and the next call comes one interval later, give or take a little.
Anything else is tried again later, waiting longer after each failure, up to
ten intervals. An installation that is switched off is not called.

## Verifying webhooks

Each webhook subscription has its own secret. A delivery is signed with
HMAC-SHA256 over `timestamp + "." + body`:

```ts
import { verifyWebhook } from "initiative-app-kit";

const result = verifyWebhook({ secret, body: rawBody, headers: req.headers });
if (!result.ok) return res.status(401).end(); // result.reason says why
// result.eventId: the same on every retry of one event; drop repeats.
```

Pass the body exactly as it arrived. The timestamp must be within 300 seconds of
now (`toleranceSeconds` to change it).

## Validating a manifest

```sh
npx initiative-app validate manifest.json   # a manifest, a served document, or a listing
npx initiative-app schema                   # the JSON Schema it checks against
npx initiative-app uid                      # mint a catalog uid
```

```ts
import { validateManifest } from "initiative-app-kit";

const problems = validateManifest(manifest); // [] when it passes
```

`validateManifest` runs the bundled JSON Schema, then the checks a schema
cannot express: features against the blocks present, ids that must name
something the manifest declares, and every term the contract does not declare
(a deployment discards those without saying so). The deployment also enforces
byte-size caps.

Who may open a surface is chosen in the community, per initiative and role.
The manifest's only say is `admin_only` on a surface that only the community's
admins should open:

```json
{ "id": "settings", "path": "/settings", "name": { "en": "Settings" }, "admin_only": true }
```

`manifest.contract.json` is the source of the vocabulary; `schemas/app-manifest.json`
and `src/contract.ts` are generated from it with `npm run generate`.

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
| `sharing:read`, `sharing:write` | Seeing who has access to something, and changing it (sharing, and handing ownership on) where the app's own access allows it. |
| `members:read` | The roster, as references, display names and avatars. |
| `initiatives:read` | The initiatives the app is placed in. |
| `apps:<public id>` | Calling that app's public endpoints through Initiative. One per app. |

Writing implies reading. Within its scopes an app still sees only what is open
to the initiative, shared with the app, or created by it.

## Errors

| Class | When |
|---|---|
| `InitiativeAuthError` | The token endpoint refused: `error` is the RFC 6749 code (`invalid_client`, `invalid_grant`, `invalid_scope`, …), with `errorDescription` and `status`. |
| `ConsentRequiredError` | A member token with no live consent. A subclass of `InitiativeAuthError`. |
| `InitiativeApiError` | Another call to Initiative answered with an error; `status` and `detail`. |
| `ContextTokenError` | A context or handoff token did not verify. |

## Licence

MIT
