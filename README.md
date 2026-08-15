# initiative-app-kit

The protocol half of writing an app for [Initiative](https://github.com/Morelitea/initiative).

An app has to get one thing exactly right: the boundary. Proving who it is when
it calls in, checking who is calling when Initiative calls out, and describing
itself in a way a deployment will accept. That is what this package is.
Everything above it — your vendor's API, your storage, your framework — is
yours, and the kit takes no view on it.

## Start from the reference app

**[initiative-github](https://github.com/Morelitea/initiative-github)** is a
real, public, working app that exercises the widest slice of the protocol:
per-member connections, guild-scoped ones, data sources answered per caller,
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

`InitiativeChannel` is the whole outbound half — reconciling your installs,
pulling their configuration, writing back what a vendor flow produced, and
emitting events. Construct one at boot and keep it; it holds your secret and no
state.

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

await initiative.emitEvent(guildId, "app.acme.tracker.thing-happened", {
  thing_id: 12,
});
```

A refused call throws `ChannelError`, carrying the platform's own code:

```ts
try {
  await initiative.emitEvent(guildId, type, payload);
} catch (error) {
  if (error instanceof ChannelError && error.status === 404) {
    // This guild no longer has your app. Reconcile rather than retry.
  }
}
```

### Signing by hand

`signedHeaders` is underneath it, for a route the channel does not cover.
Whatever you build with it, sign the **exact bytes you send** — serialize once
and use that one value twice. Re-serializing an object after signing produces a
signature over different bytes, which verifies locally and is refused by the
platform with nothing to say why.

```ts
import { signedHeaders } from "initiative-app-kit";

const path = "/api/v1/app-service/events";
const body = new TextEncoder().encode(JSON.stringify({ guild_id: 1, event_type: type }));

await fetch(`${initiativeBaseUrl}${path}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...signedHeaders({ publicId, secret, method: "POST", path, body }),
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
  body: rawBody,        // the bytes, before your JSON parser touched them
  headers: req.headers,
});

if (!result.ok) return res.status(401).json({ reason: result.reason });
if (await alreadySeen(result.nonce)) return res.status(401).end();
await remember(result.nonce, 300);
```

## Verify a context token

When Initiative calls a data source or an action, it presents a short-lived
context token naming one guild, one install and one scope.

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

// claims.guild_id, claims.app_install_id, claims.scope, claims.source_id,
// claims.connection_refs?.["account"]
```

## Answer the registration handshake

An operator wiring your app up posts a challenge to `POST /v1/handshake`. Both
ends prove they hold the same secret; neither sends it.

```ts
import { answerChallenge } from "initiative-app-kit";

app.post("/v1/handshake", (req, res) =>
  res.json({ signature: answerChallenge(secret, req.body.challenge) })
);
```

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

## Check your manifest

Check it before a deployment does:

```bash
npx initiative-app validate manifest.json     # takes either shape
npx initiative-app schema > app-manifest.schema.json
```

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
reference (a widget's data sources, a `requires` term's connection, an event's
service prefix). The schema is **generated from the platform's own validator
vocabulary**, so the enums, caps and character sets are the deployment's rather
than a second reading of them.

One part of the cross-check is easy to get subtly wrong, so it is worth naming:
**an empty block is no block.** The platform's normalizer drops empty blocks
*before* it checks, so `"automation": {}` reads as a feature declared over
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
