/**
 * The other direction across the same boundary: something asking your app to
 * act at your vendor.
 *
 * `./events.ts` is your app saying *this happened*. This is an automation
 * service saying *do this*, and the two are deliberately the same shape of
 * relationship — a delegate the operator granted `delegation` to, proving
 * itself with a token it signed, naming one guild.
 *
 * ## Why the write goes through the app
 *
 * The app is the only party holding the vendor's credential, and that is not an
 * accident of layering — it is the containment. An automation service that held
 * GitHub tokens would be a second place they can leak from and a second thing an
 * operator has to reason about when revoking. Keeping the credential on the app
 * means an organization's own grant is the whole of what any automation can do
 * at that vendor, visible in the organization's settings and revoked with the
 * button that already lives there.
 *
 * So a caller sends an operation id and parameters, and gets back what
 * happened. It never sees a token, never learns which account acted, and cannot
 * reach anything the app has not declared.
 *
 * ## Who the write is attributed to
 *
 * Two answers, and an app should prefer the first:
 *
 * - **The member.** A delegation token names the member it acts for by a
 *   pairwise subject — opaque to everyone, including you. It does not have to
 *   stay opaque: {@link InitiativeChannel.resolveDelegate} asks Initiative to
 *   turn it into one of *your own* connection refs, which is the same handle a
 *   context token would have handed you. You learn "this call is for the member
 *   you know as `ref-abc`" and nothing more, so the write runs on that member's
 *   own credential and the vendor's audit log names a person.
 * - **The installation.** When the member has connected no account, an app can
 *   still act as itself. That is a real answer and not a fallback to hide: the
 *   actor changed, so {@link InvokeOutcome.actor} says which one ran, and the
 *   caller can decide whether that is acceptable.
 *
 * Declaring which actors an operation permits is the app's business. What this
 * module fixes is that the answer is always reported.
 */

/** Discovery and invocation. `GET` lists; `POST` runs one. */
export const OPERATIONS_PATH = "/v1/operations";

/** Whose credential an operation ran on. */
export type ActorKind = "member" | "installation";

/** One thing an app can be asked to do, as it advertises it. */
export interface OperationDeclaration {
  /** `app.<public id>.<name>`, namespaced exactly as an event type is. */
  id: string;
  /**
   * Which credentials this operation will run on, best first.
   *
   * A caller reads this to know what it is asking for. An operation listing
   * only `member` refuses when the member has connected nothing, rather than
   * quietly acting as the app instead — which is the right choice for anything
   * whose whole meaning is *who* did it.
   */
  actors: ActorKind[];
  /** Parameter names this operation reads. Documentation, not a schema. */
  params: string[];
}

/** What a caller POSTs to {@link OPERATIONS_PATH}. */
export interface InvokeRequest {
  operation: string;
  guild_id: number;
  params: Record<string, unknown>;
}

/** What it gets back. */
export interface InvokeOutcome {
  operation: string;
  /**
   * Whose credential actually ran it.
   *
   * Always reported, including when it is the one the caller expected. An app
   * that acted as itself because the member had connected nothing has done
   * something different from what was asked, and saying so is the difference
   * between a fallback and a surprise.
   */
  actor: ActorKind;
  /** The vendor's own identifiers for whatever was created or changed. */
  result: Record<string, unknown>;
}

/** A rejected invocation, with the sentence to answer with. */
export interface InvokeProblem {
  ok: false;
  error: string;
}

export type ParsedInvoke =
  | { ok: true; request: InvokeRequest }
  | InvokeProblem;

/**
 * Check an invocation body against what your app declares, before running it.
 *
 * `declared` is your operation list. An id outside it is refused here rather
 * than falling through to a handler that does not exist — an app's operations
 * are a closed set by construction, and that is most of what makes this surface
 * safe to expose at all: a caller chooses among things you wrote, never
 * describes a request you then perform.
 *
 * What is deliberately **not** checked: whether the caller may act for
 * `guild_id`. That is the delegation token's job and belongs to the route,
 * because it decides whether to read the body at all.
 */
export function parseInvoke(
  body: unknown,
  declared: readonly OperationDeclaration[]
): ParsedInvoke {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "expected a json object" };
  }
  const raw = body as Partial<InvokeRequest>;

  if (typeof raw.operation !== "string" || !raw.operation) {
    return { ok: false, error: "operation is required" };
  }
  if (!declared.some((operation) => operation.id === raw.operation)) {
    return { ok: false, error: `this app does not offer '${raw.operation}'` };
  }
  if (!Number.isInteger(raw.guild_id)) {
    return { ok: false, error: "guild_id must be an integer" };
  }
  const params = raw.params ?? {};
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { ok: false, error: "params must be an object" };
  }
  return {
    ok: true,
    request: {
      operation: raw.operation,
      guild_id: raw.guild_id as number,
      params: params as Record<string, unknown>,
    },
  };
}

/**
 * Check that an operation list is namespaced under your service id.
 *
 * The same rule event types follow, and for the same reason: two apps offering
 * `create-issue` would be two different things under one name, and a caller
 * that resolved the wrong one would do the wrong thing successfully.
 */
export function operationProblems(
  publicId: string,
  declared: readonly OperationDeclaration[]
): string[] {
  const prefix = `app.${publicId}.`;
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const operation of declared) {
    if (!operation.id.startsWith(prefix) || operation.id.length === prefix.length) {
      problems.push(`'${operation.id}' is not namespaced under '${prefix}'`);
    }
    if (seen.has(operation.id)) {
      problems.push(`'${operation.id}' is declared twice`);
    }
    seen.add(operation.id);
    if (operation.actors.length === 0) {
      problems.push(`'${operation.id}' names no actor it could run as`);
    }
  }
  return problems;
}
