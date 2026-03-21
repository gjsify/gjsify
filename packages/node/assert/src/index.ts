/**
 * Node.js assert module implementation for GJS.
 * Replaces the previous re-export from @gjsify/deno_std.
 */

import { AssertionError } from './assertion-error.js';
import { isDeepEqual, isDeepStrictEqual } from './deep-equal.js';

export { AssertionError };

// ---- Helpers ----

function innerFail(obj: {
  actual?: unknown;
  expected?: unknown;
  message?: string | Error;
  operator?: string;
  stackStartFn?: Function;
}): never {
  if (obj.message instanceof Error) throw obj.message;
  throw new AssertionError({
    actual: obj.actual,
    expected: obj.expected,
    message: obj.message as string | undefined,
    operator: obj.operator,
    stackStartFn: obj.stackStartFn,
  });
}

function isPromiseLike(val: unknown): val is PromiseLike<unknown> {
  return val !== null && typeof val === 'object' && typeof (val as any).then === 'function';
}

// ---- Core functions ----

function ok(value: unknown, message?: string | Error): void {
  if (!value) {
    innerFail({
      actual: value,
      expected: true,
      message,
      operator: '==',
      stackStartFn: ok,
    });
  }
}

function equal(actual: unknown, expected: unknown, message?: string | Error): void {
  // eslint-disable-next-line eqeqeq
  if (actual != expected) {
    innerFail({
      actual,
      expected,
      message,
      operator: '==',
      stackStartFn: equal,
    });
  }
}

function notEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  // eslint-disable-next-line eqeqeq
  if (actual == expected) {
    innerFail({
      actual,
      expected,
      message,
      operator: '!=',
      stackStartFn: notEqual,
    });
  }
}

function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!Object.is(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: 'strictEqual',
      stackStartFn: strictEqual,
    });
  }
}

function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (Object.is(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: 'notStrictEqual',
      stackStartFn: notStrictEqual,
    });
  }
}

function deepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!isDeepEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: 'deepEqual',
      stackStartFn: deepEqual,
    });
  }
}

function notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (isDeepEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: 'notDeepEqual',
      stackStartFn: notDeepEqual,
    });
  }
}

function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!isDeepStrictEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: 'deepStrictEqual',
      stackStartFn: deepStrictEqual,
    });
  }
}

function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (isDeepStrictEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: 'notDeepStrictEqual',
      stackStartFn: notDeepStrictEqual,
    });
  }
}

// ---- throws / doesNotThrow ----

type ErrorPredicate = RegExp | Function | ((err: unknown) => boolean) | object | Error;

function getActual(fn: () => unknown): unknown {
  const NO_EXCEPTION = Symbol('NO_EXCEPTION');
  try {
    fn();
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION;
}

async function getActualAsync(fn: (() => Promise<unknown>) | Promise<unknown>): Promise<unknown> {
  const NO_EXCEPTION = Symbol('NO_EXCEPTION');
  try {
    if (typeof fn === 'function') {
      const result = fn();
      if (isPromiseLike(result)) {
        await result;
      }
    } else {
      await fn;
    }
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION;
}

function expectedException(
  actual: unknown,
  expected: ErrorPredicate,
  message: string | Error | undefined,
  fn: Function,
): boolean {
  if (expected === undefined) return true;

  // RegExp validation
  if (expected instanceof RegExp) {
    const str = String(actual);
    if (expected.test(str)) return true;
    throw new AssertionError({
      actual,
      expected,
      message: message as string | undefined,
      operator: fn.name,
      stackStartFn: fn,
    });
  }

  // Validation function
  if (typeof expected === 'function') {
    // Error class constructor
    if (expected.prototype !== undefined && actual instanceof (expected as any)) {
      return true;
    }
    // Error class but not instance
    if (Error.isPrototypeOf(expected as Function)) {
      return false;
    }
    // Validator function
    const result = (expected as Function).call({}, actual);
    if (result !== true) {
      throw new AssertionError({
        actual,
        expected,
        message: message as string | undefined,
        operator: fn.name,
        stackStartFn: fn,
      });
    }
    return true;
  }

  // Object validation (check properties)
  if (typeof expected === 'object' && expected !== null) {
    const keys = Object.keys(expected);
    for (const key of keys) {
      const expectedObj = expected as Record<string, unknown>;
      const actualObj = actual as Record<string, unknown>;
      if (typeof actualObj[key] === 'string' && expectedObj[key] instanceof RegExp) {
        if (!(expectedObj[key] as RegExp).test(actualObj[key] as string)) {
          throw new AssertionError({
            actual,
            expected,
            message: message as string | undefined,
            operator: fn.name,
            stackStartFn: fn,
          });
        }
      } else if (!isDeepStrictEqual(actualObj[key], expectedObj[key])) {
        throw new AssertionError({
          actual,
          expected,
          message: message as string | undefined,
          operator: fn.name,
          stackStartFn: fn,
        });
      }
    }
    return true;
  }

  return true;
}

function throws(
  fn: () => unknown,
  errorOrMessage?: ErrorPredicate | string,
  message?: string | Error,
): void {
  if (typeof fn !== 'function') {
    throw new TypeError('The "fn" argument must be of type function.');
  }

  let expected: ErrorPredicate | undefined;
  if (typeof errorOrMessage === 'string') {
    message = errorOrMessage;
    expected = undefined;
  } else {
    expected = errorOrMessage;
  }

  const actual = getActual(fn);
  if (typeof actual === 'symbol') {
    // NO_EXCEPTION sentinel
    innerFail({
      actual: undefined,
      expected,
      message: message || 'Missing expected exception.',
      operator: 'throws',
      stackStartFn: throws,
    });
  }

  if (expected !== undefined) {
    expectedException(actual, expected, message, throws);
  }
}

function doesNotThrow(
  fn: () => unknown,
  errorOrMessage?: ErrorPredicate | string,
  message?: string | Error,
): void {
  if (typeof fn !== 'function') {
    throw new TypeError('The "fn" argument must be of type function.');
  }

  let expected: ErrorPredicate | undefined;
  if (typeof errorOrMessage === 'string') {
    message = errorOrMessage;
    expected = undefined;
  } else {
    expected = errorOrMessage;
  }

  const actual = getActual(fn);
  if (typeof actual === 'symbol') {
    // NO_EXCEPTION — good
    return;
  }

  // If an expected error type was given, only re-throw if it matches
  if (expected !== undefined && typeof expected === 'function' && expected.prototype !== undefined && actual instanceof expected) {
    innerFail({
      actual,
      expected,
      message: message || `Got unwanted exception.\n${actual && (actual as Error).message ? (actual as Error).message : ''}`,
      operator: 'doesNotThrow',
      stackStartFn: doesNotThrow,
    });
  }

  if (expected === undefined || (typeof expected === 'function' && expected.prototype !== undefined && actual instanceof expected)) {
    innerFail({
      actual,
      expected,
      message: message || `Got unwanted exception.\n${actual && (actual as Error).message ? (actual as Error).message : ''}`,
      operator: 'doesNotThrow',
      stackStartFn: doesNotThrow,
    });
  }

  throw actual;
}

async function rejects(
  asyncFn: (() => Promise<unknown>) | Promise<unknown>,
  errorOrMessage?: ErrorPredicate | string,
  message?: string | Error,
): Promise<void> {
  let expected: ErrorPredicate | undefined;
  if (typeof errorOrMessage === 'string') {
    message = errorOrMessage;
    expected = undefined;
  } else {
    expected = errorOrMessage;
  }

  const actual = await getActualAsync(asyncFn);
  if (typeof actual === 'symbol') {
    innerFail({
      actual: undefined,
      expected,
      message: message || 'Missing expected rejection.',
      operator: 'rejects',
      stackStartFn: rejects,
    });
  }

  if (expected !== undefined) {
    expectedException(actual, expected, message, rejects);
  }
}

async function doesNotReject(
  asyncFn: (() => Promise<unknown>) | Promise<unknown>,
  errorOrMessage?: ErrorPredicate | string,
  message?: string | Error,
): Promise<void> {
  let expected: ErrorPredicate | undefined;
  if (typeof errorOrMessage === 'string') {
    message = errorOrMessage;
    expected = undefined;
  } else {
    expected = errorOrMessage;
  }

  const actual = await getActualAsync(asyncFn);
  if (typeof actual !== 'symbol') {
    innerFail({
      actual,
      expected,
      message: message || `Got unwanted rejection.\n${actual && (actual as Error).message ? (actual as Error).message : ''}`,
      operator: 'doesNotReject',
      stackStartFn: doesNotReject,
    });
  }
}

// ---- fail ----

function fail(message?: string | Error): never;
function fail(actual: unknown, expected: unknown, message?: string | Error, operator?: string, stackStartFn?: Function): never;
function fail(
  actualOrMessage?: unknown,
  expected?: unknown,
  message?: string | Error,
  operator?: string,
  stackStartFn?: Function,
): never {
  // Single-argument form: fail(message)
  if (arguments.length === 0 || arguments.length === 1) {
    const msg = arguments.length === 0
      ? 'Failed'
      : (typeof actualOrMessage === 'string' ? actualOrMessage : undefined);
    if (actualOrMessage instanceof Error) throw actualOrMessage;
    throw new AssertionError({
      message: msg || 'Failed',
      operator: 'fail',
      stackStartFn: fail,
    });
  }

  // Legacy multi-argument form
  throw new AssertionError({
    actual: actualOrMessage,
    expected,
    message: message as string | undefined,
    operator: operator || 'fail',
    stackStartFn: stackStartFn || fail,
  });
}

// ---- ifError ----

function ifError(value: unknown): void {
  if (value !== null && value !== undefined) {
    let message = 'ifError got unwanted exception: ';
    if (typeof value === 'object' && typeof (value as Error).message === 'string') {
      if ((value as Error).message.length === 0 && (value as Error).constructor) {
        message += (value as Error).constructor.name;
      } else {
        message += (value as Error).message;
      }
    } else {
      message += String(value);
    }

    const err = new AssertionError({
      actual: value,
      expected: null,
      message,
      operator: 'ifError',
      stackStartFn: ifError,
    });

    // Attach original error info
    const origStack = value instanceof Error ? value.stack : undefined;
    if (origStack) {
      (err as any).origStack = origStack;
    }

    throw err;
  }
}

// ---- match / doesNotMatch ----

function match(actual: string, expected: RegExp, message?: string | Error): void {
  if (typeof actual !== 'string') {
    throw new TypeError('The "actual" argument must be of type string.');
  }
  if (!(expected instanceof RegExp)) {
    throw new TypeError('The "expected" argument must be an instance of RegExp.');
  }
  if (!expected.test(actual)) {
    innerFail({
      actual,
      expected,
      message: message || `The input did not match the regular expression ${expected}. Input:\n\n'${actual}'\n`,
      operator: 'match',
      stackStartFn: match,
    });
  }
}

function doesNotMatch(actual: string, expected: RegExp, message?: string | Error): void {
  if (typeof actual !== 'string') {
    throw new TypeError('The "actual" argument must be of type string.');
  }
  if (!(expected instanceof RegExp)) {
    throw new TypeError('The "expected" argument must be an instance of RegExp.');
  }
  if (expected.test(actual)) {
    innerFail({
      actual,
      expected,
      message: message || `The input was expected to not match the regular expression ${expected}. Input:\n\n'${actual}'\n`,
      operator: 'doesNotMatch',
      stackStartFn: doesNotMatch,
    });
  }
}

// ---- strict namespace ----

const strict = Object.assign(
  function strict(value: unknown, message?: string | Error) { ok(value, message); },
  {
    AssertionError,
    ok,
    equal: strictEqual,
    notEqual: notStrictEqual,
    deepEqual: deepStrictEqual,
    notDeepEqual: notDeepStrictEqual,
    deepStrictEqual,
    notDeepStrictEqual,
    strictEqual,
    notStrictEqual,
    throws,
    doesNotThrow,
    rejects,
    doesNotReject,
    fail,
    ifError,
    match,
    doesNotMatch,
    strict: undefined as any,
  },
);
strict.strict = strict;

// ---- Default export: assert function with all methods ----

const assert = Object.assign(
  function assert(value: unknown, message?: string | Error) { ok(value, message); },
  {
    AssertionError,
    ok,
    equal,
    notEqual,
    strictEqual,
    notStrictEqual,
    deepEqual,
    notDeepEqual,
    deepStrictEqual,
    notDeepStrictEqual,
    throws,
    doesNotThrow,
    rejects,
    doesNotReject,
    fail,
    ifError,
    match,
    doesNotMatch,
    strict,
  },
);

// Named exports
export {
  ok,
  equal,
  notEqual,
  strictEqual,
  notStrictEqual,
  deepEqual,
  notDeepEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  throws,
  doesNotThrow,
  rejects,
  doesNotReject,
  fail,
  ifError,
  match,
  doesNotMatch,
  strict,
};

export default assert;
