# initiative-app-kit

The protocol half of writing an app for [Initiative](https://github.com/Morelitea/initiative).

An app has to get one thing exactly right: the boundary. Proving who it is when
it calls in, checking who is calling when Initiative calls out, telling an
automation service what happened at its vendor, and describing itself in a way a
deployment will accept. That is what this package is. Everything above it — your
vendor's API, your storage, your framework — is yours, and the kit takes no view
on it.

## Start from the reference app

**[initiative-github](https://github.com/Morelitea/initiative-github)** is a
real, public, working app that exercises the widest slice of the protocol:
per-member connections, guild-scoped ones, endpoints answered per caller,
widgets over that data, an embedded page, and emitted events — while holding no
write credential anywhere. Clone it and replace the vendor half.

There is deliberately no template repo. A template is a copy nobody runs, and
the copy nobody runs is the one that quietly stops matching the protocol. A
shipped app cannot drift, because it has to keep working — so the example is an
app rather than a skeleton.

## Install

```bash
npm install initiative-app-kit
```

## Call Initiative

`InitiativeChannel` is the outbound half that Initiative is a party to —
reconciling your installs, pulling their configuration, and writing back what a
vendor flow produced. Construct one at boot and keep it; it holds your secret
and no state.

Telling anybody that something happened at *your vendor* is not on this
channel — see [Produce events](#produce-events-for-it-to-hear), which does not
go through Initiative at all.

```ts
import { InitiativeChannel } from "initiative-app-kit";

const initiative = new InitiativeChannel({
  publicId: "acme.tracker",
  secret: process.env.INITIATIVE_APP_SECRET!,
  // Server-to-server: in a cluster this is the internal Service, not the
  // public ingress. It is not the address a browser uses for your app.
  baseUrl: process.env.INITIATIVE_BASE_URL!,
});

for (const install of await initiative.installs()) {
  const config = await initiative.config(install.guild_id);
  remember(install.install_id, config.connections.workspace);
}

await initiative.writeConnection(guildId, connectionRef, {
  values: { access_token: token },
  status: "connected",
  account_label: "@alice",
});
```

A refused call throws `ChannelError`, carrying the platform's own code:

```ts
try {
  await initiative.config(guildId);
} catch (error) {
  if (error instanceof ChannelError && error.status === 404) {
    // This guild no longer has your app. Reconcile rather than retry.
  }
}
```

### Signing by hand

`signedHeaders` is underneath it, for a route the channel does not cover.
Whatever you build with it, sign the **exact request you send** — the path, the
query string and the bytes. Serialize the body once and use that one value
twice; pass the query separately from the path, and append nothing to the URL
afterwards. Each of those produces a signature over something you did not send,
which verifies locally and is refused by the platform with nothing to say why.

The signed material is, newline-joined:

```
METHOD \n path \n query \n timestamp \n nonce \n sha256(body)
```

`query` is the query string without its `?`, `""` when there is none, and is
signed verbatim — neither side sorts or re-encodes it.

```ts
import { signedHeaders } from "initiative-app-kit";

const path = "/api/v1/app-service/events";
const body = new TextEncoder().encode(JSON.stringify({ guild_id: 1, event_type: type }));

await fetch(`${initiativeBaseUrl}${path}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...signedHeaders({ publicId, secret, method: "POST", path, query: "", body }),
  },
  body,
});
```

## Verify a call from Initiative

Initiative signs its calls to you with the same secret. The nonce comes back for
you to spend: replay protection needs storage with a lifetime, which belongs to
your app rather than to a stateless helper.

```ts
import { verifyRequest } from "initiative-app-kit";

const result = verifyRequest({
  secret: process.env.INITIATIVE_APP_SECRET!,
  method: req.method,
  path: req.path,
  query: req.url.split("?")[1] ?? "",  // raw, before your router parsed it
  body: rawBody,                       // the bytes, before your JSON parser touched them
  headers: req.headers,
});

if (!result.ok) return res.status(401).json({ reason: result.reason });
if (await alreadySeen(result.nonce)) return res.status(401).end();
await remember(result.nonce, 300);
```

## Verify a context token

When Initiative calls one of your endpoints, it presents a short-lived
context token naming one guild, one install and one endpoint.

**It carries no person.** No `sub`, no email, no name. Where a call needs a
member's own credential at your vendor, the token carries `connection_refs` —
opaque handles you stored yourself — so you select the right credential while
learning nothing about whose it is, and the same person is uncorrelated across
apps.

**Its audience is you.** Always pass your own `publicId`: verification without
the audience check is the one mistake that makes the claim meaningless.

```ts
import { JwksCache, bearerToken, verifyContextToken } from "initiative-app-kit";

const jwks = new JwksCache();

const claims = await verifyContextToken(bearerToken(req.headers)!, {
  publicId: "acme.tracker",
  baseUrl: initiativeBaseUrl,
  jwks,
});

// claims.guild_id, claims.app_install_id, claims.scope, claims.endpoint_id,
// claims.connection_refs?.["account"]
```

## Verify a call from an automation service

Initiative is not the only thing that calls an app. An **automation service**
— a delegate the operator granted `delegation` to — connects directly, to ask
to be told when something happens at your vendor. It proves itself with a token
it signed, against a key the deployment publishes for it.

Two things are different from a context token and both matter:

**The caller names itself.** A delegate's keys are published per delegate, at
an address that names one, so a verifier has to know which before it can fetch
anything. The caller sends its own public id in `X-Initiative-App`. That is a
*selector* — it decides which key set is fetched — and the signature is what
decides whether the name was true.

**The audience is your app, not Initiative.** A token for Initiative does not
verify here and one for you does not verify there. Neither side depends on the
other's discipline for that.

```ts
import {
  JwksCache,
  bearerToken,
  delegateHeader,
  verifyDelegationToken,
} from "initiative-app-kit";

// One cache serves both documents — they are keyed separately.
const jwks = new JwksCache();

const claims = await verifyDelegationToken(bearerToken(req.headers)!, {
  publicId: "acme.tracker",
  delegate: delegateHeader(req.headers)!,
  baseUrl: initiativeBaseUrl,
  jwks,
});

// claims.signer.publicId — which delegate, decided by the signature
// claims.guildId        — the one guild this call is about
// claims.jti            — one-shot: record it and refuse a repeat
```

`jti` comes back rather than being enforced here, because replay protection
needs storage with a lifetime and that belongs to your app. Spend it with an
insert whose primary key is the check, not with a read followed by a write.

## Produce events for it to hear

An app holds its vendor's webhook connection, so it is the thing that knows
when something happened there. It produces **directly** to whoever subscribed;
Initiative is not in the path.

> The obvious design is to post the event to Initiative and let it fan out.
> That cannot work: the vocabulary a webhook subscription may name is derived
> from Initiative's own content tables, so nothing can name
> `app.<id>.<event>` and the dispatcher matches nothing.

What has to be identical across every app is the *outbound* half, so a consumer
has one receiver rather than one per vendor. That is what this module fixes —
the envelope (field for field, Initiative's own), the headers, the HMAC, and a
deterministic `event_id` so a retry is recognizable as one. Your app supplies
the storage and decides what its vendor's deliveries mean.

```ts
import { Emitter, parseSubscribe, mintSubscriptionSecret } from "initiative-app-kit";

const emitter = new Emitter({
  publicId: "acme.tracker",
  store: { matching: (guildId, endpoint) => /* your rows */ },
});

// When your vendor's webhook fires, and after you have verified *its* signature:
await emitter.publish({
  guildId,
  appInstallId,                          // names the install as the resource
  endpoint: "app.acme.tracker.ticket-opened",
  payload: { project: "widgets", ticket: 42 },
  deliveryKey: vendorDeliveryId,         // the vendor's own id for the occurrence
});
```

`deliveryKey` is the vendor's id, not one you mint. That is what makes the
dedup hold end to end: a vendor re-sending a delivery it thinks failed produces
the `event_id` the receiver already recorded.

A subscriber creates and deletes one at `SUBSCRIPTIONS_PATH`, and
`parseSubscribe` checks a body against your manifest before you store it — it
takes your whole endpoint list and accepts only the `emit` entries, so a
subscription to something that answers instead is refused rather than stored
inert. Authorize those with a delegation token, above.

## Answer the registration handshake

An operator wiring your app up posts a challenge to `POST /v1/handshake`. Both
ends prove they hold the same secret; neither sends it.

```ts
import { answerChallenge } from "initiative-app-kit";

app.post("/v1/handshake", (req, res) =>
  res.json({ signature: answerChallenge(secret, req.body.challenge) })
);
```

## Register your app at its vendor, once

Most apps integrating a vendor need a registration there that cannot be shared —
a GitHub App's private key, a Shopify custom app. Each deployment needs its own,
and the way to create one without a twenty-field form is to let the app post a
filled-in registration and show the operator the credentials once.

That is a route which creates a vendor account and prints its secrets, so
`SetupGate` is the switch: on while an operator needs it, gone afterwards.

```ts
import { SETUP_TOKEN_VAR, SetupGate } from "initiative-app-kit";

const gate = new SetupGate({ tokens: process.env[SETUP_TOKEN_VAR] });

// The outbound leg. 404 with no token — not 403, which would tell an
// unauthenticated caller which deployments are worth coming back to.
app.get("/setup/vendor/register", (req, res) => {
  const token = gate.authorize(req.query.token);
  if (!token) return res.status(404).end();
  res.send(yourFormThatPosts(gate.mintState(token)));
});

// The return leg, which the vendor reaches with a code and a state and no
// token — so the state has to carry the authority itself.
app.get("/setup/vendor/registered", (req, res) => {
  if (!gate.verifyState(req.query.state)) return res.status(404).end();
  // …exchange req.query.code, show the credentials once, store nothing.
});
```

`INITIATIVE_APP_SETUP_TOKEN` holds **one or more** tokens, comma or space
separated. A state is signed by whichever token opened its flow, so letting a
second operator in — or replacing a token — ends exactly the flows that token
authorized and leaves the rest running.

Nothing is persisted, deliberately: writing the vendor's credentials to a
database would be more convenient and would cost the promise that they are read
once at boot and that a running deployment's identity cannot be changed by
reaching a URL.

## Serve your manifest

Two things are called "the manifest", and only one of them is what a registrar
fetches. `Manifest` is what your app **declares** — its capabilities, and what
the schema describes. The **document** at `/.well-known/initiative-app.json`
carries that as `definition`, alongside the identity a registration is matched
by. A `Manifest` served bare validates cleanly and is refused at registration,
with nothing on either side saying why.

`appDocument` builds the right thing:

```ts
import { appDocument } from "initiative-app-kit";

// Serialize once and serve the same bytes every time: a deployment hashes what
// it fetches and re-checks it hourly, so a rendering that differs run to run
// flips the registration back to needing re-verification for no reason.
const document = JSON.stringify(appDocument(manifest, { uid: "K7M2QX8N4TVB9C" }));

app.get("/.well-known/initiative-app.json", (_req, res) =>
  res.type("application/json").send(document)
);
```

```jsonc
{
  "protocol_version": 1,
  "public_id": "acme.tracker",   // matched against the operator's registration
  "kind": "app",
  "uid": "K7M2QX8N4TVB9C",       // the catalog id — see below
  "definition": { /* your Manifest */ }
}
```

The **`uid` is the catalog id**: publisher-assigned, immutable, never reused. It
is what ties a verified registration to its listing, so without one the
registration verifies but names nothing — and an install marked mandatory is
skipped as "has not verified yet", which reads as a verification problem rather
than a missing id.

Put nothing per-request or per-release in the document. No app version, no
timestamp, no host — the manifest declares capabilities, and where your app
lives comes from the registration.

Mint a uid once and write it into your source as a constant:

```bash
npx initiative-app uid      # K7M2QX8N4TVB9C
```

## Publish a listing

**Serving a manifest does not make your app installable.** The document above is
what a *registrar* fetches to verify a container an operator has already decided
to run. A **listing** is what a *guild admin* browses and installs. Nothing
derives one from the other, so an app that ships no listing is registered, live,
healthy — and cannot be added by anybody.

A listing is a JSON file. An operator points `MARKETPLACE_EXTRA_CATALOG_DIR` at
a directory, drops it in, and it is in their marketplace. No fork, no pull
request, no release of Initiative. Removing the file withdraws the listing;
guilds that installed it keep what they have.

Build it from the document you already serve, so the identity and the
capabilities are read rather than restated:

```ts
import { appDocument, appListing } from "initiative-app-kit";

const document = appDocument(manifest, { uid: LISTING_UID });

const listing = appListing(document, {
  name: "Tracker",
  publisher: "Acme",
  description: "Track the things.",           // one line, in the grid
  long_description: "…",                       // markdown, on the page
  version: process.env.npm_package_version!,   // yours, not Initiative's
  release_notes: "### Fixed\n\n- …",
});
```

Write that to `catalog/acme.tracker.json` and hand it to an operator. Two rules
worth knowing before you do:

- **A published version is immutable.** `uid` + `version` has to name the same
  content on every deployment. Correcting a listing's content means publishing a
  new version — though its name, blurb and artwork stay editable without one.
- **Artwork is same-origin.** A listing page loads nothing from your host, so
  paths start with `/` and a registry mirrors third-party artwork locally.

### Ship a dashboard alongside your app

An app that declares widgets leaves a guild to arrange them. A **companion
listing** is a second entry in the same marketplace, published by you, that
ships a ready-made arrangement of your own widgets — install the app, install
the dashboard, and there is something to look at.

It carries no code. It is a layout naming widget types your app's pinned
definition already declares, and the only thing tying the two together is your
uid:

```ts
import { appWidgetType, dashboardListing } from "initiative-app-kit";

const overview = dashboardListing(listing, {
  uid: DASHBOARD_UID,                       // its own — a separate install
  public_id: "acme.tracker-overview",
  meta: { ...meta, name: "Tracker overview" },
  layout: { columns: 12 },
  widgets: [
    {
      id: "open",
      type: appWidgetType(LISTING_UID, "open-items"),   // one of yours
      title: "Open items",
      grid: { x: 0, y: 0, w: 4, h: 3 },
      binding: { endpoint_id: "app.acme.tracker.open-items" },  // app_uid filled in
    },
  ],
});
```

`dashboardListing` takes the app listing so `binding.app_uid` comes from it
rather than being typed twice. That matters because the platform refuses a
binding whose uid disagrees with the widget type's: a widget is your app's
module and its endpoints are your app's, so a definition cannot point one app's
widget at another app's data.

## Check your manifest

Check it before a deployment does:

```bash
npx initiative-app validate manifest.json     # manifest, document or listing
npx initiative-app schema > app-manifest.schema.json
npx initiative-app uid                        # mint a catalog uid
```

`validate` takes whichever of the three shapes you hand it and says which it
read, so a file that is fine *as a manifest* but was meant to be a listing does
not pass silently.

Or in code — `validateDocument` for the bytes you serve, `validateManifest` for
what goes inside:

```ts
import { validateDocument } from "initiative-app-kit";

const problems = validateDocument(appDocument(manifest, { uid }));
if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.message}`).join("\n"));
```

### What validation does and does not promise

`validateManifest` runs the bundled schema first, then adds the two rules JSON
Schema cannot express: the features cross-check in both directions, and every id
reference (a widget's endpoints, a `requires` term's connection, an
endpoint's service prefix). The schema is **generated from the platform's own validator
vocabulary**, so the enums, caps and character sets are the deployment's rather
than a second reading of them.

One part of the cross-check is easy to get subtly wrong, so it is worth naming:
**an empty block is no block.** The platform's normalizer drops empty blocks
*before* it checks, so `"endpoints": []` reads as a feature declared over
nothing and is refused. A validator that tested only for the key's presence
would pass a manifest that registration turns away — this one tests that the
block carries something.

Structural problems short-circuit. A manifest whose shape is wrong would
otherwise produce cascading nonsense from checks that assume the shape held.

A clean result is necessary, not sufficient. The platform additionally enforces
UTF-8 byte-size caps and two conditional rules — `connect_path` belongs to an
interactive connection, and `initiative_manager` visibility only to a surface
that renders in an initiative — which are checked on publish. Every problem
reported here is a definite refusal; an empty list is a strong signal rather
than a guarantee.

The schema is also deliberately permissive where the platform *accepts* rather
than refuses: an out-of-range cache TTL is clamped, an over-long localized
string is truncated, and an unrecognized property is dropped. A validator that
rejected those would tell you a working manifest is broken, and the last one is
what lets an app targeting a newer platform keep validating against an older
copy of the schema.

## Where the schema comes from

`schemas/app-manifest.json` is **not in this repository**. It is generated in
the Initiative repository from the validator's own vocabulary, and fetched here
at build time from the revision pinned in [`SCHEMA_REF`](SCHEMA_REF).

That is deliberate. A document kept in two repositories drifts, and a CI check
that notices is still drift — just supervised. What is versioned here is a
*ref*, which is the ordinary way one project depends on another: moving to a
newer contract is one line, and the diff a reviewer reads is the version rather
than a re-pasted document.

The published package does carry the file, because `initiative-app validate`
works offline. `prepare` fetches it before the build, so an install from a git
URL gets it too, and an install of the published tarball does not re-fetch
anything.

```bash
npm run schema              # fetch it (no-op if present)
node scripts/fetch-schema.mjs --force   # refetch after changing SCHEMA_REF
```

## Keeping the two in step

The kit's CI runs its conformance checks against the reference app, so the
example and the SDK are verified against each other rather than drifting apart.
Sample code lives in the app rather than here — one place, and it is the place
that has to keep working.

## Development

```bash
npm install
npm test
npm run build
```

The signing tests run against vectors in `test/vectors.json` produced by the
platform's own implementation — not by a second reading of the spec, which is
the only way they can fail for the right reason.

## License

MIT
