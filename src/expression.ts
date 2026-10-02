/**
 * JSONata, as Initiative evaluates a declarative app's expressions.
 *
 * Standard JSONata, the reference implementation, with no functions added.
 * Every evaluation is bounded by three of the contract's caps, which
 * Initiative reads from the same contract: `expressionTimeMs`,
 * `expressionDepth` (levels of nesting, function calls included) and
 * `expressionOutputBytes` (the answer, as JSON). Passing one is a failure,
 * as an expression that raises an error is.
 */

import jsonata from "jsonata";

import { CAPS } from "./contract.js";

/** An expression that does not parse, failed, or passed one of its bounds. */
export class ExpressionError extends Error {
  /** Where in the expression, in characters, when the failure names a place. */
  readonly position: number | undefined;

  constructor(message: string, position?: number) {
    super(message);
    this.name = "ExpressionError";
    this.position = position;
  }
}

function failure(error: unknown): ExpressionError {
  const { message, position } = (error ?? {}) as { message?: unknown; position?: unknown };
  return new ExpressionError(
    typeof message === "string" ? message : String(error),
    typeof position === "number" ? position : undefined
  );
}

/** An expression's syntax tree. Throws {@link ExpressionError} when it does not parse. */
export function parseExpression(text: string): jsonata.ExprNode {
  try {
    return jsonata(text).ast();
  } catch (error) {
    throw failure(error);
  }
}

/** `$now()` and `$millis()` answering one instant, as every expression of one call sees it. */
async function clock(millis: number): Promise<Record<string, unknown>> {
  return {
    now: await jsonata(`function($picture, $timezone) { $fromMillis(${millis}, $picture, $timezone) }`).evaluate({}),
    millis: await jsonata(`function() { ${millis} }`).evaluate({}),
  };
}

/**
 * Evaluate one expression over `input`, within the contract's bounds. The
 * answer comes back as plain JSON, or undefined when the expression answers
 * nothing. `now` fixes what `$now()` and `$millis()` answer; absent, they
 * answer the moment of evaluation.
 */
export async function evaluate(
  text: string,
  input: unknown,
  options: { now?: Date | string | number } = {}
): Promise<unknown> {
  let answer: unknown;
  try {
    const expression = jsonata(text, { timeout: CAPS.expressionTimeMs, stack: CAPS.expressionDepth });
    const bindings = options.now === undefined ? undefined : await clock(new Date(options.now).getTime());
    answer = await expression.evaluate(input, bindings);
  } catch (error) {
    throw failure(error);
  }
  const json = answer === undefined ? undefined : JSON.stringify(answer);
  if (json === undefined) return undefined;
  if (Buffer.byteLength(json, "utf-8") > CAPS.expressionOutputBytes) {
    throw new ExpressionError(`the answer is over ${CAPS.expressionOutputBytes} bytes`);
  }
  return JSON.parse(json);
}
