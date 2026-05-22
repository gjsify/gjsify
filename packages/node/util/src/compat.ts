// Node-compat utilities: promisify / callbackify / deprecate / debuglog /
// inherits / isDeepStrictEqual / toUSVString / aborted.
//
// Reference: Node.js lib/util.js.
// Original: see index.ts pre-split. Grouped here because each helper is
// individually small (<60 LoC) and they share the "thin Node-API shim"
// character — none need a dedicated file.

// ---- promisify / callbackify ----

const kCustomPromisify = Symbol.for('nodejs.util.promisify.custom');

export function promisify<T extends (...args: unknown[]) => void>(fn: T): (...args: unknown[]) => Promise<unknown> {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  // Check for custom promisify
  const custom = (fn as unknown as Record<symbol, unknown>)[kCustomPromisify];
  if (typeof custom === 'function') return custom as (...args: unknown[]) => Promise<unknown>;

  function promisified(this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err: Error | null, ...values: unknown[]) => {
        if (err) {
          reject(err);
        } else if (values.length <= 1) {
          resolve(values[0]);
        } else {
          resolve(values);
        }
      });
    });
  }

  Object.setPrototypeOf(promisified, Object.getPrototypeOf(fn));
  Object.defineProperty(promisified, kCustomPromisify, { value: promisified });
  return promisified;
}

promisify.custom = kCustomPromisify;

export function callbackify<T>(fn: () => Promise<T>): (callback: (err: Error | null, result?: T) => void) => void;
export function callbackify<T>(fn: (...args: unknown[]) => Promise<T>): (...args: unknown[]) => void;
export function callbackify(fn: (...args: unknown[]) => Promise<unknown>): (...args: unknown[]) => void {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  return function (this: unknown, ...args: unknown[]) {
    const callback = args.pop();
    if (typeof callback !== 'function') {
      throw new TypeError('The last argument must be of type Function');
    }
    fn.apply(this, args).then(
      (result: unknown) => Promise.resolve().then(() => callback(null, result)),
      (err: Error) => Promise.resolve().then(() => callback(err || new Error()))
    );
  };
}

// ---- deprecate ----

export function deprecate<T extends (...args: unknown[]) => unknown>(fn: T, msg: string, code?: string): T {
  let warned = false;
  function deprecated(this: unknown, ...args: unknown[]): unknown {
    if (!warned) {
      warned = true;
      const warning = code ? `[${code}] ${msg}` : msg;
      console.warn(`DeprecationWarning: ${warning}`);
    }
    return fn.apply(this, args);
  }
  Object.setPrototypeOf(deprecated, fn);
  return deprecated as unknown as T;
}

// ---- debuglog ----

export function debuglog(section: string): (...args: unknown[]) => void {
  let debug: ((...args: unknown[]) => void) | undefined;

  return (...args: unknown[]) => {
    if (debug === undefined) {
      const nodeDebug = typeof globalThis.process?.env?.NODE_DEBUG === 'string'
        ? globalThis.process.env.NODE_DEBUG
        : '';
      const regex = new RegExp(`\\b${section}\\b`, 'i');
      if (regex.test(nodeDebug)) {
        const pid = typeof globalThis.process?.pid === 'number' ? globalThis.process.pid : 0;
        debug = (...a: unknown[]) => {
          console.error(`${section.toUpperCase()} ${pid}:`, ...a);
        };
      } else {
        debug = () => {};
      }
    }
    debug(...args);
  };
}

// ---- inherits ----

interface ErrnoBrand { code?: string }

export function inherits(ctor: Function, superCtor: Function): void {
  if (ctor === undefined || ctor === null) {
    const err = new TypeError('The "ctor" argument must be of type Function. Received ' + String(ctor));
    (err as TypeError & ErrnoBrand).code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
  if (superCtor === undefined || superCtor === null) {
    const err = new TypeError('The "superCtor" argument must be of type Function. Received ' + String(superCtor));
    (err as TypeError & ErrnoBrand).code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
  if (superCtor.prototype === undefined) {
    const err = new TypeError('The "superCtor.prototype" property must not be undefined');
    (err as TypeError & ErrnoBrand).code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
  Object.defineProperty(ctor, 'super_', { value: superCtor, writable: true, configurable: true });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

// ---- isDeepStrictEqual ----

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  if (Array.isArray(aObj) && Array.isArray(bObj)) {
    if (aObj.length !== bObj.length) return false;
    for (let i = 0; i < aObj.length; i++) {
      if (!isDeepStrictEqual(aObj[i], bObj[i])) return false;
    }
    return true;
  }

  if (Array.isArray(aObj) !== Array.isArray(bObj)) return false;

  if (aObj instanceof Date && bObj instanceof Date) {
    return aObj.getTime() === bObj.getTime();
  }

  if (aObj instanceof RegExp && bObj instanceof RegExp) {
    return aObj.source === bObj.source && aObj.flags === bObj.flags;
  }

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!isDeepStrictEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

// ---- toUSVString ----

export function toUSVString(string: string): string {
  if (typeof (string as unknown as { toWellFormed?: () => string }).toWellFormed === 'function') {
    return (string as unknown as { toWellFormed: () => string }).toWellFormed();
  }
  // Fallback
  return string.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

// ---- aborted ----

/**
 * Returns a Promise that resolves once `signal` aborts. The optional
 * `resource` argument is accepted for Node compatibility — Node uses it
 * for experimental "resource cleanup" tracking; we ignore it (no-op),
 * which matches the observable behavior of `util.aborted()` for the
 * documented use case.
 *
 * Reference: https://nodejs.org/api/util.html#utilabortedsignal-resource
 *
 * @param signal An `AbortSignal` to wait on.
 * @param resource Any non-null object — accepted for Node parity.
 */
export function aborted(signal: AbortSignal, resource: object): Promise<void> {
  // Match Node's behaviour: validation errors come back as a rejected
  // Promise (not a synchronous throw). Mirrors Node's `aborted` impl,
  // which dispatches through a webidl-validated `AbortSignal` cast and
  // produces a rejected Promise on bad input.
  if (signal == null || typeof (signal as AbortSignal).aborted !== 'boolean') {
    return Promise.reject(
      new TypeError('The "signal" argument must be an instance of AbortSignal'),
    );
  }
  if (resource == null || typeof resource !== 'object') {
    return Promise.reject(
      new TypeError('The "resource" argument must be an non-null object'),
    );
  }
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
