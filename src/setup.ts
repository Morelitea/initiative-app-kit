/**
 * The switch that lets an app register itself with its vendor.
 *
 * Every integration has a first step nobody enjoys: a form at the vendor, a
 * dozen fields that have to match the code exactly, and four secrets copied
 * back by hand. Most vendors will take that registration as a document instead
 * — GitHub, Slack and Discord all do — and the app already knows every value,
 * because the same constants are what it runs on.
 *
 * What it cannot know is whether the person asking is entitled to create one.
 * That is this: one shared secret, set on the workload by whoever deployed it,
 * naming the one window in which an unregistered app will do the one thing an
 * unregistered app is for.
 *
 * The name lives here rather than in each app so an operator learns it once,
 * however many integrations they run. What is registered, and how, is the
 * app's own business — this says only who may ask.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The one variable an operator sets to open the window. */
export const SETUP_TOKEN_ENV = "INITIATIVE_APP_SETUP_TOKEN";

type Env = Record<string, string | undefined>;

/**
 * The token this deployment was given, or `null` for one that was given none.
 *
 * `null` means the window is shut, which is the resting state: an app that has
 * finished registering should have the variable removed, and one that never
 * needed it never has it.
 */
export function setupToken(env: Env = process.env): string | null {
  const offered = (env[SETUP_TOKEN_ENV] ?? "").trim();
  return offered.length > 0 ? offered : null;
}

/**
 * Whether this request may reach the setup surface.
 *
 * Compared in constant time, and refused outright when the deployment set no
 * token — an absent token is not an empty one, and an app that treated it as
 * one would offer registration to anybody the moment an operator forgot.
 */
export function permitsSetup(offered: unknown, env: Env = process.env): boolean {
  const expected = setupToken(env);
  if (expected === null) return false;
  if (typeof offered !== "string" || offered.length === 0) return false;

  // Same length before comparing, because `timingSafeEqual` throws otherwise —
  // and the length of a secret is not worth leaking through an exception.
  const a = Buffer.from(offered, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A value the setup surface can hand out and recognise on the way back.
 *
 * A vendor's registration flow is a round trip through the browser, and what
 * comes back has to be tied to what went out. Signed with the setup token
 * rather than stored, so it survives a restart, needs no table, and cannot be
 * minted by anybody who does not already hold the token.
 */
export function signSetupState(value: string, env: Env = process.env): string | null {
  const secret = setupToken(env);
  if (secret === null) return null;
  return createHmac("sha256", secret).update(value, "utf-8").digest("hex");
}

/** Whether a state came back as it went out. */
export function verifySetupState(
  value: string,
  signature: unknown,
  env: Env = process.env
): boolean {
  const expected = signSetupState(value, env);
  if (expected === null || typeof signature !== "string") return false;
  return permitsSetupCompare(signature, expected);
}

function permitsSetupCompare(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
