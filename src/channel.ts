/**
 * The other direction: your app calling Initiative.
 *
 * Everything else in this package is about calls arriving — a context token to
 * verify, a challenge to answer, a manifest a deployment reads. This is the
 * half where your app is the caller, and it is the half most likely to be got
 * subtly wrong by hand, because the signature covers the *exact* path and the
 * *exact* bytes. A trailing slash, a re-serialized body, a query string built
 * after signing: each of those verifies fine locally and is refused by the
 * platform, with nothing on either side saying which one it was.
 *
 * So the paths live here, once, and the bytes signed are the bytes sent.
 *
 * Four things an app does through this channel. Telling anybody that something
 * happened at your vendor is not one of them — that is `./events.ts`, and it
 * does not go through Initiative at all.
 *
 * - **Reconcile.** {@link InitiativeChannel.installs} is the source of truth for
 *   which guilds have your app. Poll it at boot; you have no other way to learn
 *   about an install that happened while you were down.
 * - **Pull configuration.** {@link InitiativeChannel.config} is the custody
 *   channel — the one call that returns stored plaintext, and only for installs
 *   of your own app. Hold what it returns in memory, not on disk: revoking on
 *   the platform side means the next pull stops returning it, and that only
 *   protects anybody if you did not keep a copy.
 * - **Write back what a vendor flow produced.**
 *   {@link InitiativeChannel.writeConnection} puts a member's credential into
 *   the platform's custody. First connect and a 03:00 refresh are the same call.
 * - **Resolve a delegate's subject.** {@link InitiativeChannel.resolveDelegate}
 *   turns the opaque subject on a delegation token into one of your own
 *   connection refs, so an operation an automation asked for can run on the
 *   member's own credential rather than on the app's. See `./operations.ts`.
 *
 * The base URL here is the **server-to-server** address — where your container
 * reaches Initiative — which in a cluster is the internal Service and not the
 * public ingress. It is the same address you verify context tokens against, and
 * it is not the address a browser uses for your app.
 */

import { stripTrailingSlashes } from "./parse.js";
import { signedHeaders } from "./signing.js";

/** Every route in this file hangs off here. */
export const CHANNEL_BASE = "/api/v1/app-service";

/** Refused by the platform, with what it said. */
export class ChannelError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`initiative channel refused the call: ${status} ${detail}`);
    this.name = "ChannelError";
    this.status = status;
    this.detail = detail;
  }
}

/** One guild that has your app installed. */
export interface InstallSummary {
  install_id: number;
  guild_id: number;
  listing_uid: string;
  listing_version: string;
  name: string;
  enabled: boolean;
  config_state: string;
  config_state_detail: string | null;
  needs_config: boolean;
}

/** One member's stored values, addressed by the handle you know them by. */
export interface MemberConfig {
  connection_id: string;
  connection_ref: string;
  status: string;
  values: Record<string, unknown>;
}

/**
 * One install's configuration, decrypted.
 *
 * `connections` holds the guild-wide values an admin typed, keyed by connection
 * id. `member_connections` holds what you wrote back for each member.
 */
export interface InstallConfig {
  guild_id: number;
  install_id: number;
  listing_uid: string;
  listing_version: string;
  enabled: boolean;
  config_state: string;
  config_state_detail: string | null;
  needs_config: boolean;
  connections: Record<string, Record<string, unknown>>;
  member_connections: MemberConfig[];
}

/** One member's connection as you reconcile it — status, never a value. */
export interface ConnectionStatus {
  connection_id: string;
  connection_ref: string;
  status: string;
  blocked: boolean;
  account_label: string | null;
  created_at: string;
  updated_at: string;
}

/** What you write back after a vendor flow. */
export interface ConnectionWrite {
  /**
   * Only fields the pinned manifest marked `managed`. A key sent as `null`
   * clears it; a key left out is untouched, so a refresh carrying one rotated
   * token does not disturb the rest.
   */
  values?: Record<string, unknown>;
  /** `pending` while a flow is in progress; otherwise the stored values decide. */
  status?: "pending" | "connected";
  /** The vendor account the member connected as, e.g. `@alice`. Display only. */
  account_label?: string;
}

/** Your verdict on the configuration you were handed. */
export interface StatusReport {
  state: "ok" | "invalid";
  /** A short code shown beside an `invalid` state, e.g. `missing_scope`. */
  detail?: string;
}

export interface StatusRead {
  guild_id: number;
  install_id: number;
  config_state: string;
  config_state_detail: string | null;
}

export interface ChannelOptions {
  /** Your service id — the `service.public_id` in your manifest. */
  publicId: string;
  /** The shared secret your registration was wired with. */
  secret: string;
  /** Server-to-server: where your container reaches Initiative. */
  baseUrl: string;
  /** Injectable so a test can answer without a network. */
  fetch?: typeof globalThis.fetch;
  /** Injectable so a test can pin the moment it signed at. */
  now?: () => number;
}

/**
 * A signed client for the app-service channel.
 *
 * Stateless and cheap — construct one at boot and keep it. It holds your
 * secret and nothing else, so there is no cache in it to go stale.
 */
export class InitiativeChannel {
  private readonly publicId: string;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly now?: () => number;

  constructor(options: ChannelOptions) {
    this.publicId = options.publicId;
    this.secret = options.secret;
    // Trailing slash stripped once, here: `new URL(path, base)` would otherwise
    // produce a path that differs from the one signed.
    this.baseUrl = stripTrailingSlashes(options.baseUrl);
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.now = options.now;
  }

  /** Which guilds have your app, at which pinned version. */
  async installs(): Promise<InstallSummary[]> {
    const body = await this.call<{ items: InstallSummary[] }>(
      "GET",
      `${CHANNEL_BASE}/installs`
    );
    return body.items;
  }

  /** One install's decrypted configuration. The custody channel. */
  config(guildId: number): Promise<InstallConfig> {
    return this.call<InstallConfig>(
      "GET",
      `${CHANNEL_BASE}/installs/${guildId}/config`
    );
  }

  /** Which members are connected, by reference and status alone. */
  async connections(guildId: number): Promise<ConnectionStatus[]> {
    const body = await this.call<{ items: ConnectionStatus[] }>(
      "GET",
      `${CHANNEL_BASE}/installs/${guildId}/connections`
    );
    return body.items;
  }

  /** Store what a vendor flow produced for one member. */
  writeConnection(
    guildId: number,
    connectionRef: string,
    write: ConnectionWrite
  ): Promise<ConnectionStatus> {
    return this.call<ConnectionStatus>(
      "PUT",
      // The reference is minted by the platform from a URL-safe alphabet, so it
      // needs no escaping — encoded anyway, because a path that differs from
      // the one signed is refused with nothing to say which half was wrong.
      `${CHANNEL_BASE}/installs/${guildId}/connections/${encodeURIComponent(connectionRef)}`,
      write
    );
  }

  /**
   * Turn a delegate's pairwise subject into one of *your* connection refs.
   *
   * The one call that makes a delegated write attributable to a person. A
   * delegation token names the member it acts for by a subject minted for the
   * *delegate*, which means nothing in your namespace — this asks Initiative to
   * resolve it to the handle you already know that member by.
   *
   * You learn no more than a context token would have told you: an opaque ref,
   * and whether it is connected. Not a name, not an email, not a user id, and
   * nothing that correlates with what another app knows about the same person.
   *
   * `null` when the subject resolves to nobody, when that member has no
   * connection with you, or when the deployment is older than this route — all
   * of which mean the same thing at the call site: there is no member
   * credential to run this on, so act as the installation or refuse.
   */
  async resolveDelegate(
    guildId: number,
    delegate: string,
    subject: string
  ): Promise<ConnectionStatus | null> {
    const query = new URLSearchParams({ delegate, subject });
    try {
      return await this.call<ConnectionStatus>(
        "GET",
        `${CHANNEL_BASE}/installs/${guildId}/connections/resolve?${query}`
      );
    } catch (error) {
      // A 404 is the ordinary answer here — no such member, no connection, or
      // no such route — and none of them is a failure the caller can act on
      // differently. Anything else is a real fault and is worth raising.
      if (error instanceof ChannelError && error.status === 404) return null;
      throw error;
    }
  }

  /** Report whether the configuration you were handed actually works. */
  reportStatus(guildId: number, report: StatusReport): Promise<StatusRead> {
    return this.call<StatusRead>(
      "POST",
      `${CHANNEL_BASE}/installs/${guildId}/status`,
      report
    );
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Serialized once. Signing one string and sending another is the failure
    // this ordering exists to make impossible.
    const bytes =
      body === undefined
        ? new Uint8Array()
        : new TextEncoder().encode(JSON.stringify(body));

    const headers: Record<string, string> = signedHeaders({
      publicId: this.publicId,
      secret: this.secret,
      method,
      path,
      body: bytes,
      now: this.now,
    });
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : bytes,
    });

    if (!response.ok) {
      throw new ChannelError(response.status, await readDetail(response));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** The platform's own error code, or the status text if it sent something else. */
async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // A proxy in front of the platform may answer HTML; the status is the whole
    // of what is known then.
  }
  return response.statusText || "unknown";
}
