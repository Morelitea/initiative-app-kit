/**
 * `initiative-app-sdk/testing`: a declarative app's requests and mappings,
 * run against recorded vendor answers, with no server and no network.
 *
 * Each runner renders the requests the way Initiative makes them (method,
 * address with its query, headers, body), answers them from `responses` in
 * order, and maps the answers. It returns every request it rendered beside
 * what the run answered:
 *
 * - `{ result }`: the mapped answer;
 * - `{ unavailable, detail? }`: a code, from an `errors` rule, the defaults,
 *   the map itself, `range-too-large` from paging, or `mapping-failed` when an
 *   expression fails or a rendered address is not https on one of the app's
 *   hosts (`detail` says which);
 * - `{ transient: true }`: a passing failure, which Initiative answers as one
 *   to retry;
 * - `{ refused }`: an `after_connect` that refused the connection.
 *
 * A rendered request carries no credential: Initiative adds the one its
 * `connection` names, as the app's `auth` says. A predicate (`when`, `more`,
 * `refuse_when`) holds when JSONata's `$boolean` of its answer is true.
 *
 * A run fails, rather than answering, on a mistake in the test or the app: a
 * request with no recorded response left for it, a recorded response nothing
 * asked for, or a mapped answer that does not fit the declared returns.
 */

import type { ConnectionState, ErrorRule, StatusMatch, VendorRequest } from "./contract.js";
import { PLATFORM_CODES } from "./contract.js";
import type { AnyApp, ReturnSpec } from "./define.js";
import { evaluate, ExpressionError } from "./expression.js";

export { evaluate, ExpressionError, parseExpression } from "./expression.js";

/** One answer the vendor gave, as a test records it. Status 200 and no headers when left out. */
export interface RecordedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** One request as Initiative sends it, less the credential. */
export interface RenderedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  /** The connection whose credential Initiative would add. */
  connection?: string;
}

/** What a run made and what it answered. */
export type Run<T> = { requests: RenderedRequest[] } & (
  | { result: T }
  | { unavailable: string; detail?: string }
  | { transient: true }
  | { refused: string }
);

export interface Recorded {
  /** The vendor's answers, in the order the requests are made. */
  responses: RecordedResponse[];
  /** The time of the call: `now`, and what `$now()` and `$millis()` answer. Default: the present. */
  now?: Date | string | number;
}

/** An answer as an expression reads it, `response` or `steps.<name>`. */
interface Answer {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

type Answered = { unavailable: string; detail?: string } | { transient: true } | { refused: string };

/** A run's answer, thrown from wherever it is decided. */
class Outcome {
  constructor(readonly answer: Answered) {}
}

class Context {
  readonly requests: RenderedRequest[] = [];
  readonly now: string;
  private readonly clock: Date | string | number;
  private readonly responses: RecordedResponse[];

  constructor(
    readonly hosts: readonly string[],
    recorded: Recorded,
    /** The endpoint's own rules, and whether an answer outside 2xx fails the run. */
    readonly rules: readonly ErrorRule[] | null
  ) {
    this.clock = recorded.now ?? new Date();
    this.now = new Date(this.clock).toISOString();
    this.responses = [...recorded.responses];
  }

  async value(text: string, document: object, where: string): Promise<unknown> {
    try {
      return await evaluate(text, document, { now: this.clock });
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      throw new Outcome({ unavailable: "mapping-failed", detail: `${where}: ${error.message}` });
    }
  }

  async holds(text: string, document: object, where: string): Promise<boolean> {
    return (await evaluate("$boolean($)", await this.value(text, document, where))) === true;
  }

  answer(request: RenderedRequest): Answer {
    const recorded = this.responses.shift();
    if (!recorded) throw new Error(`no recorded response is left for ${request.method} ${request.url}`);
    return {
      status: recorded.status ?? 200,
      headers: Object.fromEntries(Object.entries(recorded.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
      body: recorded.body === undefined ? undefined : JSON.parse(JSON.stringify(recorded.body)),
    };
  }

  async run<T>(work: () => Promise<{ result: T } | Answered>): Promise<Run<T>> {
    let answered: { result: T } | Answered;
    try {
      answered = await work();
    } catch (error) {
      if (!(error instanceof Outcome)) throw error;
      answered = error.answer;
    }
    if (this.responses.length) {
      throw new Error(`${this.responses.length} recorded response(s) were not asked for`);
    }
    return { requests: this.requests, ...answered };
  }
}

const matches = (status: StatusMatch, actual: number) =>
  typeof status === "number" ? status === actual : status[0] === String(actual)[0];

/** What an answer outside 2xx means when no rule says. */
function byDefault(status: number): Answered {
  if (status === 401 || status === 403) return { unavailable: "not-authorized" };
  if (status === 404) return { unavailable: "not-found" };
  if (status !== 429 && status >= 400 && status < 500) return { unavailable: "invalid" };
  return { transient: true };
}

function onHost(url: URL, hosts: readonly string[]): boolean {
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  return hosts.some((host) => {
    if (!host.startsWith("*.")) return url.hostname === host;
    const label = url.hostname.slice(0, -(host.length - 1));
    return url.hostname.endsWith(host.slice(1)) && label.length > 0 && !label.includes(".");
  });
}

/** The address a Link header gives as `rel="next"`, if any. */
function nextLink(header: string | undefined, base: string): string | undefined {
  for (const link of (header ?? "").split(",")) {
    const [, target, rest] = /^\s*<([^>]*)>(.*)$/.exec(link) ?? [];
    const rel = /;\s*rel="?([^";]*)"?/i.exec(rest ?? "")?.[1];
    if (target !== undefined && rel?.split(/\s+/).includes("next")) return new URL(target, base).toString();
  }
  return undefined;
}

const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

async function render(
  request: VendorRequest,
  document: object,
  context: Context,
  where: string,
  page: { number: number; url?: string; cursor?: unknown }
): Promise<RenderedRequest> {
  const address = page.url ?? (await context.value(request.url, document, `${where}/url`));
  let url: URL;
  try {
    url = new URL(String(address));
  } catch {
    throw new Outcome({ unavailable: "mapping-failed", detail: `${where}/url: ${text(address)} is not an address` });
  }
  if (page.url === undefined) {
    for (const [name, expression] of Object.entries(request.query ?? {})) {
      const value = await context.value(expression, document, `${where}/query/${name}`);
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one !== undefined && one !== null) url.searchParams.append(name, text(one));
      }
    }
  }
  const paging = request.paging;
  if (paging?.kind === "page_number") {
    url.searchParams.set(paging.page_param, String(page.number));
    if (paging.per_page_param) url.searchParams.set(paging.per_page_param, String(paging.per_page));
  }
  if (paging?.kind === "cursor" && paging.param && page.number > 1) url.searchParams.set(paging.param, text(page.cursor));
  if (!onHost(url, context.hosts)) {
    throw new Outcome({
      unavailable: "mapping-failed",
      detail: `${where}: ${url} is not https on one of the app's hosts (${context.hosts.join(", ")})`,
    });
  }

  const headers: Record<string, string> = {};
  for (const [name, expression] of Object.entries(request.headers ?? {})) {
    const value = await context.value(expression, document, `${where}/headers/${name}`);
    if (value !== undefined && value !== null) headers[name] = text(value);
  }
  let body = request.body === undefined ? undefined : await context.value(request.body, document, `${where}/body`);
  if (request.graphql) {
    let variables = request.graphql.variables
      ? await context.value(request.graphql.variables, document, `${where}/graphql/variables`)
      : undefined;
    if (paging?.kind === "cursor" && paging.variable && page.number > 1) {
      variables = { ...(variables as object), [paging.variable]: page.cursor };
    }
    body = { query: request.graphql.query, ...(variables === undefined ? {} : { variables }) };
  }
  return {
    method: request.method,
    url: url.toString(),
    headers,
    ...(body === undefined ? {} : { body }),
    ...(request.connection ? { connection: request.connection } : {}),
  };
}

/**
 * One request, every page of it, as `response` then reads it. Each answer is
 * held to the endpoint's rules and then the defaults, unless the context
 * judges none (a health check, whose states do).
 */
async function perform(request: VendorRequest, document: object, context: Context, where: string): Promise<Answer> {
  const paging = request.paging;
  const items: unknown[] = [];
  const page: { number: number; url?: string; cursor?: unknown } = { number: 1 };
  for (;;) {
    const rendered = await render(request, document, context, where, page);
    context.requests.push(rendered);
    const answer = context.answer(rendered);
    if (context.rules) {
      const read = { ...document, response: answer };
      for (const [index, rule] of context.rules.entries()) {
        if (!matches(rule.status, answer.status)) continue;
        if (rule.when !== undefined && !(await context.holds(rule.when, read, `errors/${index}/when`))) continue;
        throw new Outcome(rule.code === "transient" ? { transient: true } : { unavailable: rule.code });
      }
      if (answer.status < 200 || answer.status > 299) throw new Outcome(byDefault(answer.status));
    }
    if (!paging) return answer;

    const read = { ...document, response: answer };
    const got = paging.items === undefined ? answer.body : await context.value(paging.items, read, `${where}/paging/items`);
    if (Array.isArray(got)) items.push(...got);
    else if (got !== undefined) items.push(got);
    let more: boolean;
    if (paging.kind === "page_number") {
      more = (Array.isArray(got) ? got.length : got === undefined ? 0 : 1) >= paging.per_page;
    } else if (paging.kind === "link_header") {
      page.url = nextLink(answer.headers.link, rendered.url);
      more = page.url !== undefined;
    } else {
      more = await context.holds(paging.more, read, `${where}/paging/more`);
      page.cursor = await context.value(paging.next, read, `${where}/paging/next`);
    }
    if (more && page.number === paging.max_pages && paging.on_limit === "refuse") {
      throw new Outcome({ unavailable: "range-too-large" });
    }
    if (!more || page.number === paging.max_pages) return { ...answer, body: items };
    page.number += 1;
  }
}

/** Holds a mapped answer to the declared returns: declared names, of their declared types. */
function fits(answer: unknown, returns: Record<string, ReturnSpec> | undefined, where: string): Record<string, unknown> {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    throw new Error(`${where} answered ${text(answer)}, which is not an object of the declared returns`);
  }
  for (const [key, value] of Object.entries(answer)) {
    const spec = returns?.[key];
    if (spec === undefined) throw new Error(`${where} answered '${key}', which is not a declared return`);
    if (value === null) continue;
    const { type, list } = typeof spec === "string" ? { type: spec, list: false } : spec;
    if (list && !Array.isArray(value)) {
      throw new Error(
        `${where} answered '${key}' as ${text(value)}, and it is declared a list ` +
          "(a JSONata path matching one item answers it alone: end the path with [] to keep a list)"
      );
    }
    for (const one of list ? (value as unknown[]) : [value]) {
      const ok =
        type === "int" ? Number.isInteger(one) : type === "bool" ? typeof one === "boolean" : typeof one === "string";
      if (!ok) throw new Error(`${where} answered '${key}' as ${text(one)}, which is not ${type}`);
    }
  }
  return answer as Record<string, unknown>;
}

/**
 * One declarative endpoint: its request or steps rendered from `params`, the
 * `connections`' non-secret fields (keyed by connection id) and `now`, answered
 * from `responses`, and its map held to the declared returns.
 */
export async function runEndpoint(
  app: AnyApp,
  name: string,
  call: Recorded & {
    params?: Record<string, unknown>;
    connections?: Record<string, Record<string, unknown>>;
  }
): Promise<Run<Record<string, unknown>>> {
  const endpoint = app.endpoints?.[name];
  if (!endpoint || !("map" in endpoint)) throw new TypeError(`'${name}' is not a declarative endpoint of this app`);
  const context = new Context(app.hosts ?? [], call, endpoint.errors ?? []);
  return context.run<Record<string, unknown>>(async () => {
    const base = { params: call.params ?? {}, now: context.now };
    const steps = endpoint.steps ?? [{ name: "", request: endpoint.request! }];
    const answers: Record<string, Answer> = {};
    let read: object = base;
    for (const [index, step] of steps.entries()) {
      read = {
        ...base,
        connection: call.connections?.[step.request.connection ?? ""] ?? {},
        ...(endpoint.steps ? { steps: { ...answers } } : {}),
      };
      const where = endpoint.steps ? `steps/${index}/request` : "request";
      const response = await perform(step.request, read, context, where);
      if (endpoint.steps) answers[step.name] = response;
      read = { ...read, ...(endpoint.steps ? { steps: { ...answers } } : {}), response };
    }
    const answer = await context.value(endpoint.map, read, "map");
    if (answer && typeof answer === "object" && "unavailable" in answer) {
      const code = (answer as { unavailable: unknown }).unavailable;
      if (typeof code !== "string" || ![...(endpoint.unavailable ?? []), ...PLATFORM_CODES].includes(code)) {
        throw new Error(`map answered unavailable ${text(code)}, which is not one of this endpoint's codes`);
      }
      return { unavailable: code };
    }
    return { result: fits(answer, endpoint.returns, "map") };
  });
}

/** A declarative `after_connect`: its request made with the flow's `params`, mapped, and refused when it says. */
export async function runAfterConnect(
  app: AnyApp,
  connection: string,
  call: Recorded & { params?: Record<string, string> }
): Promise<Run<{ values?: Record<string, unknown>; account_label?: string }>> {
  const after = app.connections?.[connection]?.flow?.after_connect;
  if (typeof after !== "object") throw new TypeError(`'${connection}' has no declarative after_connect`);
  const context = new Context(app.hosts ?? [], call, []);
  return context.run<{ values?: Record<string, unknown>; account_label?: string }>(async () => {
    const document = { params: call.params ?? {}, now: context.now };
    const response = await perform(after.request, document, context, "after_connect/request");
    const result = await context.value(after.map, { ...document, response }, "after_connect/map");
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(`after_connect/map answered ${text(result)}, which is not {values, account_label}`);
    }
    if (after.refuse_when && (await context.holds(after.refuse_when, { ...document, response, result }, "refuse_when"))) {
      return { refused: after.code ?? "" };
    }
    return { result: result as { values?: Record<string, unknown>; account_label?: string } };
  });
}

/** A connection's health check: its request made with the connection's non-secret `fields`, and the state it reads. */
export async function runHealth(
  app: AnyApp,
  connection: string,
  call: Recorded & { fields?: Record<string, unknown> }
): Promise<Run<ConnectionState>> {
  const health = app.connections?.[connection]?.health;
  if (!health) throw new TypeError(`'${connection}' declares no health check`);
  const context = new Context(app.hosts ?? [], call, null);
  return context.run(async () => {
    const document = { params: {}, connection: call.fields ?? {}, now: context.now };
    const response = await perform(health.request, document, context, "health/request");
    for (const [index, row] of health.states.entries()) {
      if (row.status !== undefined && !matches(row.status, response.status)) continue;
      if (row.when !== undefined && !(await context.holds(row.when, { ...document, response }, `states/${index}/when`))) continue;
      return { result: row.state };
    }
    return { result: response.status >= 200 && response.status <= 299 ? "ok" : "unavailable" };
  });
}

/** What one delivery emits, and the connection state it sets. */
export interface WebhookRun {
  event?: { emit: string; payload: Record<string, unknown> };
  status?: { connection: string; state: ConnectionState };
}

/**
 * One webhook delivery, as a declarative app maps it: the event the first
 * matching `events` row emits (by the emit endpoint's key, its payload held to
 * that endpoint's returns), and the state the first matching `status` row
 * sets. A delivery nothing matches answers neither. An expression that fails
 * throws {@link ExpressionError}.
 */
export async function runWebhook(
  app: AnyApp,
  delivery: {
    headers?: Record<string, string>;
    payload: unknown;
    /** The routed connection's non-secret fields. */
    connection?: Record<string, unknown>;
    now?: Date | string | number;
  }
): Promise<WebhookRun> {
  const clock = delivery.now ?? new Date();
  const document = {
    headers: Object.fromEntries(Object.entries(delivery.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
    payload: delivery.payload,
    connection: delivery.connection ?? {},
    now: new Date(clock).toISOString(),
  };
  const holds = async (expression: string) =>
    (await evaluate("$boolean($)", await evaluate(expression, document, { now: clock }))) === true;
  const out: WebhookRun = {};
  for (const row of app.webhooks?.events ?? []) {
    if (!(await holds(row.when))) continue;
    const payload = await evaluate(row.map, document, { now: clock });
    out.event = { emit: row.emit, payload: fits(payload, app.endpoints?.[row.emit]?.returns, `the ${row.emit} event`) };
    break;
  }
  for (const row of app.webhooks?.status ?? []) {
    if (await holds(row.when)) {
      out.status = { connection: row.connection, state: row.state };
      break;
    }
  }
  return out;
}
