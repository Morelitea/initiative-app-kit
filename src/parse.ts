/**
 * Checks that read a value one character at a time, and never with a pattern.
 *
 * There is nothing here a regular expression could not express, and that is the
 * point. Every check in this package that decides whether a *caller-supplied*
 * string may be used — as a path segment, as an identifier, as an address to
 * connect to — is written out longhand instead, for three reasons:
 *
 * - **A pattern is read as one token and is wrong in the small.** `[a-z0-9._-]`
 *   silently admits a leading dot and a doubled one; `.*\.local` matches
 *   `evil.localhost.attacker.com` under a careless anchor. These are one
 *   character of difference from correct and read identically at a glance.
 * - **What a pattern rejects cannot be tested by reading it.** A loop with
 *   named steps fails a specific assertion when it is wrong; a pattern fails
 *   whichever inputs somebody happened to think of.
 * - **The engine has its own behaviour.** Alternation and nested quantifiers
 *   over attacker-supplied input have super-linear cases, and the ones that do
 *   are not obvious from looking. Nothing here can, because there is no engine.
 *
 * Where a real primitive exists it is used rather than reimplemented — network
 * addresses go through `node:net`, which parses them properly and rejects the
 * alternate encodings a textual check misses.
 */

/** Lowercase letters and digits: the first character of an identifier label. */
function isLowerAlphanumeric(character: string): boolean {
  return (
    (character >= "a" && character <= "z") || (character >= "0" && character <= "9")
  );
}

/** Everything a label may carry after its first character. */
function isLabelBody(character: string): boolean {
  return isLowerAlphanumeric(character) || character === "-" || character === "_";
}

/** Whether every character of `value` passes `allowed`. Empty is false. */
function every(value: string, allowed: (character: string) => boolean): boolean {
  if (!value) return false;
  for (const character of value) {
    if (!allowed(character)) return false;
  }
  return true;
}

/** Whether `value` is one or more decimal digits and nothing else. */
export function isDigits(value: string): boolean {
  return every(value, (character) => character >= "0" && character <= "9");
}

/**
 * Whether `value` is a well-formed `<publisher>.<slug>` public id.
 *
 * At least two labels, each starting with a lowercase letter or digit and
 * carrying only those plus `-` and `_`. Written out because this value reaches
 * two places where being wrong matters: it selects which published key set a
 * signature is checked against, and it becomes a path segment in the URL that
 * fetches it.
 *
 * An empty label is the case a pattern gets wrong most often, and it is the one
 * that matters: `..`, a leading dot and a trailing dot all produce one, and a
 * path segment built from any of them is not the segment it looks like.
 */
export function isPublicId(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const labels = value.split(".");
  // Two labels minimum — `<publisher>.<slug>` — and no empty ones anywhere,
  // which `split` reports as an empty string rather than by omitting them.
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!isLowerAlphanumeric(label[0] ?? "")) return false;
    if (!every(label, isLabelBody)) return false;
  }
  return true;
}

/**
 * `value` with every trailing `/` removed.
 *
 * Its own function because getting it wrong is invisible: a base URL keeping one
 * produces a doubled slash in a signed path, the signature covers the path, and
 * the platform refuses the call with nothing on either side saying which half
 * was wrong.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}
