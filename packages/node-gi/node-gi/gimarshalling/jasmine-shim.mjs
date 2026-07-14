// SPDX-License-Identifier: MIT
// Minimal jasmine adapter over node:test + node:assert, sized for near-verbatim
// ports of GJS's installed-tests (refs/gjs/installed-tests/js/*.js, which run
// under jasmine via minijasmine). Only the surface those ports actually use is
// implemented — an unknown matcher throws a clear "not implemented in shim"
// error instead of silently passing.
//
// SKIP CONTRACT (strict, mirrors the tier-A conformance ledger): every skipped
// spec/section must carry a non-empty REASON string referencing a roadmap item
// (e.g. 'phase 2.1 BigInt-64-bit'), an upstream issue URL, or a FIDELITY-BUG
// note. The reason is REPORTED in the node:test output (`# SKIP <reason>`).
// A bare skip is impossible by construction:
//   • pending(reason)                 — throws unless reason is a non-empty string
//   • itSkip(reason, name, fn?)       — registers a skipped spec; fn is NEVER run
//   • describeSkip(reason, name, fn?) — registers a skipped suite (stub)
//   • xit(name, fn).pend(reason)      — jasmine's chained form; an xit whose
//     .pend() was not called by the end of its enclosing describe THROWS
//   • xdescribe                       — throws (use describeSkip with a reason)
import {
  after,
  afterEach as nodeAfterEach,
  before,
  beforeEach as nodeBeforeEach,
  describe as nodeDescribe,
  it as nodeIt,
} from 'node:test';
import { inspect } from 'node:util';

// ---- pending / skip machinery ------------------------------------------------

class PendingError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'PendingError';
    this.reason = reason;
  }
}

function validateReason(reason, api) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError(
      `${api}: a skip requires a non-empty reason string referencing a roadmap item ` +
        `(e.g. 'phase 2.1 BigInt-64-bit'), an upstream issue URL, or a 'FIDELITY-BUG: …' note`,
    );
  }
}

/** Mark the current spec pending (skipped) with a mandatory reason. */
export function pending(reason) {
  validateReason(reason, 'pending(reason)');
  throw new PendingError(reason);
}

// xit(...) entries whose .pend(reason) has not run yet; checked when the
// enclosing describe body finishes (jasmine suite bodies are synchronous).
const danglingXits = [];

/** jasmine describe. Also enforces that every xit inside chained .pend(reason). */
export function describe(name, fn) {
  nodeDescribe(name, () => {
    fn();
    const dangling = danglingXits.filter((e) => !e.pended);
    if (dangling.length > 0) {
      throw new Error(
        `xit('${dangling[0].name}') without .pend(reason) — a bare skip is forbidden; ` +
          `chain .pend('<roadmap reason>') or use itSkip(reason, name, fn)`,
      );
    }
  });
}

/** jasmine it. Supports pending(reason) inside the body (reported as a skip). */
export function it(name, fn) {
  if (typeof fn !== 'function') throw new TypeError(`it('${name}'): missing spec function`);
  if (fn.length > 0) {
    throw new TypeError(`it('${name}'): done-callback specs are not supported by the shim yet`);
  }
  nodeIt(name, (t) => {
    try {
      const result = fn();
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        return result.then(undefined, (error) => {
          if (error instanceof PendingError) return t.skip(error.reason);
          throw error;
        });
      }
      return result;
    } catch (error) {
      if (error instanceof PendingError) {
        t.skip(error.reason);
        return undefined;
      }
      throw error;
    }
  });
}

/**
 * Register a SKIPPED spec with a mandatory reason (reported as `# SKIP <reason>`).
 * The body is kept for the future un-skip but is NEVER executed — a skipped
 * section may crash the process if run (that can be exactly why it is skipped).
 */
export function itSkip(reason, name, fn) {
  validateReason(reason, `itSkip(…, '${name}')`);
  void fn; // documented: retained in the source for the un-skip, not executed
  nodeIt(name, { skip: reason }, () => {});
}

/**
 * Register a SKIPPED suite (stub) with a mandatory reason. Used to map
 * not-yet-ported upstream describe blocks so the port file covers the whole
 * upstream surface; later PRs replace the stub with the real port.
 */
export function describeSkip(reason, name, fn) {
  validateReason(reason, `describeSkip(…, '${name}')`);
  nodeDescribe(name, { skip: reason }, typeof fn === 'function' ? fn : () => {});
}

/** jasmine xit — valid only in the chained `xit(name, fn).pend(reason)` form. */
export function xit(name, fn) {
  const entry = { name, pended: false };
  danglingXits.push(entry);
  return {
    pend(reason) {
      entry.pended = true;
      itSkip(reason, name, fn);
      return this;
    },
  };
}

/** jasmine xdescribe carries no reason — forbidden here. */
export function xdescribe(name) {
  throw new Error(`xdescribe('${name}'): bare suite skips are forbidden — use describeSkip(reason, name, fn)`);
}

export const beforeEach = nodeBeforeEach;
export const afterEach = nodeAfterEach;
export const beforeAll = before;
export const afterAll = after;

// ---- expect + matchers ---------------------------------------------------------

const ASYMMETRIC = Symbol('jasmine.asymmetric');

function isAsymmetric(value) {
  return value !== null && typeof value === 'object' && value[ASYMMETRIC] === true;
}

// jasmine.util-equals subset: asymmetric matchers, Object.is for primitives
// (NaN equals NaN), elementwise arrays/typed arrays, own-enumerable-key objects.
function equals(a, b) {
  if (isAsymmetric(b)) return b.matches(a);
  if (isAsymmetric(a)) return a.matches(b);
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b; // +0 vs -0
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => equals(v, b[i]));
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equals(a[k], b[k]));
}

function show(value) {
  return inspect(value, { depth: 4, maxArrayLength: 16, breakLength: 120 });
}

function makeMatchers(actual, negated) {
  // Uniform pass/fail gate honouring `.not` negation.
  const check = (pass, description) => {
    if (pass !== !negated) {
      throw new Error(`Expected ${show(actual)}${negated ? ' not' : ''} ${description}`);
    }
  };

  const matchers = {
    toBe(expected) {
      check(actual === expected, `to be ${show(expected)}`);
    },
    toEqual(expected) {
      check(equals(actual, expected), `to equal ${show(expected)}`);
    },
    toThrow() {
      if (arguments.length > 0) {
        throw new Error('jasmine-shim: toThrow(expected) with an argument is not implemented in shim');
      }
      if (typeof actual !== 'function') throw new TypeError('toThrow: expect(...) needs a function');
      let threw = false;
      let thrown;
      try {
        actual();
      } catch (error) {
        // pending() inside the probed function must still skip the spec.
        if (error instanceof PendingError) throw error;
        threw = true;
        thrown = error;
      }
      if (negated && threw) {
        throw new Error(`Expected function not to throw, but it threw ${show(thrown?.message ?? thrown)}`);
      }
      if (!negated && !threw) {
        throw new Error('Expected function to throw, but it did not');
      }
    },
    toBeTruthy() {
      check(Boolean(actual), 'to be truthy');
    },
    toBeFalsy() {
      check(!actual, 'to be falsy');
    },
    toBeTrue() {
      check(actual === true, 'to be true');
    },
    toBeFalse() {
      check(actual === false, 'to be false');
    },
    toBeNull() {
      check(actual === null, 'to be null');
    },
    toBeUndefined() {
      check(actual === undefined, 'to be undefined');
    },
    toBeDefined() {
      check(actual !== undefined, 'to be defined');
    },
    toBeNaN() {
      check(typeof actual === 'number' && Number.isNaN(actual), 'to be NaN');
    },
    toBeCloseTo(expected, precision = 2) {
      // jasmine's formula: |expected - actual| < 10^-precision / 2
      const pass =
        typeof actual === 'number' && Math.abs(expected - actual) < Math.pow(10, -precision) / 2;
      check(pass, `to be close to ${show(expected)} (precision ${precision})`);
    },
  };

  if (!negated) {
    Object.defineProperty(matchers, 'not', {
      get: () => makeMatchers(actual, true),
      enumerable: false,
    });
  }

  return new Proxy(matchers, {
    get(target, prop, receiver) {
      if (prop in target || typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (/^to[A-Z]/.test(prop) || prop === 'withContext') {
        throw new Error(
          `jasmine-shim: matcher '${prop}' not implemented in shim — add it to gimarshalling/jasmine-shim.mjs`,
        );
      }
      return undefined;
    },
  });
}

/** jasmine expect(actual) — matchers per makeMatchers; `.not` negates. */
export function expect(actual) {
  return makeMatchers(actual, false);
}

// ---- jasmine.* asymmetric matchers ----------------------------------------------

function anyMatches(expected, value) {
  if (expected === String) return typeof value === 'string' || value instanceof String;
  if (expected === Number) return typeof value === 'number' || value instanceof Number;
  if (expected === Boolean) return typeof value === 'boolean' || value instanceof Boolean;
  if (expected === Symbol) return typeof value === 'symbol';
  if (expected === BigInt) return typeof value === 'bigint';
  if (expected === Function) return typeof value === 'function';
  if (expected === Object) return value !== null && typeof value === 'object';
  return value instanceof expected;
}

export const jasmine = {
  any(expected) {
    return {
      [ASYMMETRIC]: true,
      matches: (value) => anyMatches(expected, value),
      [inspect.custom]: () => `jasmine.any(${expected?.name ?? String(expected)})`,
    };
  },
  objectContaining(sample) {
    return {
      [ASYMMETRIC]: true,
      matches: (value) =>
        value !== null &&
        typeof value === 'object' &&
        Object.keys(sample).every((key) => equals(value[key], sample[key])),
      [inspect.custom]: () => `jasmine.objectContaining(${show(sample)})`,
    };
  },
};
