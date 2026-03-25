// Node.js vm module for GJS — code evaluation facility
// Reference: Node.js lib/vm.js
// Reimplemented for GJS using eval() and Function constructor.
// True sandbox isolation is not possible without SpiderMonkey Realms.
//
// SECURITY NOTE: This module intentionally uses eval() and Function() to implement
// Node.js vm semantics. The vm module is by design a code evaluation facility —
// it executes arbitrary user-provided code strings. This matches Node.js behavior
// where vm.runInThisContext() wraps eval() and vm.compileFunction() wraps Function().
// This is NOT a security sandbox — same as Node.js's own documentation states.

const contextSymbol = Symbol('vm.context');

/**
 * Run code in the current V8/SpiderMonkey context.
 * Equivalent to eval() but matches Node.js vm.runInThisContext() API.
 */
export function runInThisContext(code: string, _options?: Record<string, unknown>): unknown {
  // eslint-disable-next-line no-eval
  return eval(code);
}

/**
 * Run code with a sandbox object providing global-like variables.
 * Uses Function constructor to inject sandbox properties as local variables.
 * NOTE: This is NOT a security sandbox — code can still access globalThis.
 * This matches Node.js vm module behavior which also does not provide true isolation.
 */
export function runInNewContext(code: string, context?: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
  const sandbox = context || {};
  const keys = Object.keys(sandbox);
  const values = keys.map(k => sandbox[k]);

  // Build a function that receives sandbox values as parameters
  // and evaluates the code with those names in scope.
  // This is the standard way to implement vm.runInNewContext without V8 internals.
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `return eval(${JSON.stringify(code)})`);
  return fn(...values);
}

/**
 * Run code in a previously created context.
 * Since we don't have real VM contexts, this delegates to runInNewContext.
 */
export function runInContext(code: string, context: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
  return runInNewContext(code, context);
}

/**
 * Create a "context" object. Marks it with a symbol so isContext() works.
 * In real Node.js, this creates a V8 Context. Here it just marks an object.
 */
export function createContext(context?: Record<string, unknown>): Record<string, unknown> {
  const ctx = context || {};
  Object.defineProperty(ctx, contextSymbol, { value: true, enumerable: false });
  return ctx;
}

/**
 * Check if an object was created by createContext().
 * Throws TypeError for non-object arguments, matching Node.js behavior.
 */
export function isContext(context: unknown): boolean {
  if (typeof context !== 'object' || context === null) {
    throw new TypeError(
      `The "object" argument must be of type object. Received ${context === null ? 'null' : `type ${typeof context}`}`
    );
  }
  return (context as Record<symbol, unknown>)[contextSymbol] === true;
}

/**
 * Compile a function from source code with optional parameters and context.
 * Matches Node.js vm.compileFunction() API surface.
 * eslint-disable-next-line no-new-func — intentional: vm module implements code evaluation
 */
export function compileFunction(
  code: string,
  params?: string[],
  _options?: { parsingContext?: Record<string, unknown>; contextExtensions?: object[] },
): Function {
  const paramNames = params || [];
  // eslint-disable-next-line no-new-func
  return new Function(...paramNames, code);
}

/**
 * Script class — compiles code for repeated execution.
 */
export class Script {
  private _code: string;

  constructor(code: string, _options?: Record<string, unknown>) {
    this._code = code;
  }

  runInThisContext(_options?: Record<string, unknown>): unknown {
    // eslint-disable-next-line no-eval
    return eval(this._code);
  }

  runInNewContext(context?: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
    return runInNewContext(this._code, context);
  }

  runInContext(context: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
    return runInNewContext(this._code, context);
  }

  createCachedData(): Uint8Array {
    // No real cached data in our implementation
    return new Uint8Array(0);
  }
}

export default {
  runInThisContext,
  runInNewContext,
  runInContext,
  createContext,
  isContext,
  compileFunction,
  Script,
};
