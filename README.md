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

## Sign a call to Initiative

Every request your app makes carries a signature over the method, path,
timestamp, nonce, and a digest of the body. Sign the exact bytes you send —
re-serializing an object after signing will not verify.

```ts
import { signedHeaders } from "initiative-app-kit";

const body = new TextEncoder().encode(JSON.stringify({ type: "app.acme.tracker.ping" }));

const response = await fetch(`${initiativeBaseUrl}/api/v1/app-channel/events`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...signedHeaders({
      publicId: "acme.tracker",
      secret: process.env.INITIATIVE_APP_SECRET!,
      method: "POST",
      path: "/api/v1/app-channel/events",
      body,
    }),
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

## Check your manifest

Your manifest is served unauthenticated at `/.well-known/initiative-app.json`.
Check it before a deployment does:

```bash
npx initiative-app validate manifest.json
npx initiative-app schema > app-manifest.schema.json
```

Or in code:

```ts
import { validateManifest } from "initiative-app-kit";

const problems = validateManifest(manifest);
if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.message}`).join("\n"));
```

### What validation does and does not promise

The bundled schema is **generated from the platform's own validator
vocabulary**, so the enums, caps and character sets are the deployment's, not a
second reading of them. On top of it, `validateManifest` checks the features
cross-check and every id reference.

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
