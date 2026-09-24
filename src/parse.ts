/**
 * Small checks written one character at a time rather than as patterns.
 *
 * Each check here decides whether a string may be used as an identifier or as
 * part of an address. They are written out longhand so that what they accept
 * reads step by step, each rule fails a specific test when it is wrong, and no
 * regular-expression engine is involved.
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

/**
 * Whether `value` is a well-formed `<publisher>.<slug>` public id.
 *
 * At least two labels, each starting with a lowercase letter or digit and
 * carrying only those plus `-` and `_`. No label may be empty, so `a.`, `.a`
 * and `a..b` are all refused.
 */
export function isPublicId(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const labels = value.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!isLowerAlphanumeric(label[0] ?? "")) return false;
    if (!every(label, isLabelBody)) return false;
  }
  return true;
}

/**
 * `value` with every trailing `/` removed, so a base URL joins to a path
 * without a doubled slash.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}
