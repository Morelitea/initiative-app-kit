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
  token, the connect return it hands your connect page, and its webhook
  signatures.
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

// Where the app is installed, what each community granted, where it is placed.
// An inactive installation is paused (switched off, or its community on hold):
// keep what you hold for it. One that is gone is no longer listed.
for (const { installation, scopes, initiatives, active } of await auth.listInstallations()) {
  if (!active) continue;
  const response = await auth.fetchAsInstallation(installation, guildPath("/projects/"));
  console.log(installation, scopes, initiatives, await response.json());
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
// The values a community admin supplied, and those your app wrote back for
// each member, decrypted. Keep them in memory and fetch again when you need
// them.
const config = await auth.installationConfig(installation);
config.connections.admin;          // { admin_token: "…" }
config.memberConnections;          // [{ connectionRef, values, … }]

// Which member connections are live, with no values.
const connections = await auth.installationConnections(installation);

// A vendor flow finished: store what it produced against the handle your
// connect page was given. `null` clears a value.
await auth.writeConnection(installation, connectionRef, {
  values: { access_token: "…" },
  accountLabel: "@alice",
});

// Whether the configuration you were handed works, shown to the community's
// admins.
await auth.reportConfigStatus(installation, { state: "invalid", detail: "missing_scope" });

// A third-party event, under your own namespace, for Initiative to deliver.
await auth.emitEvent(installation, {
  eventType: "app.acme.tracker.issue_opened",
  payload: { number: 12 },
});

// Another app's token named a member by its subject: find your own handle
// for them.
const mine = await auth.resolveConnection(installation, {
  delegate: "acme.automations",
  subject: "uapp_…",
});
```

A refusal raises `InitiativeApiError` with Initiative's `detail` code.

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

Initiative calls your declared endpoints at `POST /v1/endpoints` with a context
token, sends members to your surfaces with a handoff token, and sends them to
your connect page with a connect return. All three are RS256 JWTs from the
deployment's JWKS, with `iss` `initiative` and `aud`
`initiative-app:<your public id>`.

```ts
import {
  JwksCache,
  bearerToken,
  parseInvoke,
  verifyConnectReturn,
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

// A member opening one of your surfaces.
const handoff = await verifyHandoffToken(tokenFromTheFrame, verify);
// handoff.sub (the member), handoff.surface_id, handoff.initiative_id

// A member arriving at your connect page: ?connection_ref=…&guild_ref=…&return_token=…
const back = await verifyConnectReturn(query.return_token, verify);
// back.connection_ref, back.guild_ref, back.return_url
```

A handoff token and a connect return are each for one use: record the `jti`
until `exp` and refuse it a second time. When the vendor flow ends, send the
member to the connect return's `return_url` with an `outcome` parameter added:
`connected`, `refused`, `expired`, `not_recorded` or `awaiting_approval`.
Follow it only from a token that verified, and check its `connection_ref`
against the flow you are finishing. A connect return lives five minutes, so
verify it when the member arrives and keep `return_url` with the flow.

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
