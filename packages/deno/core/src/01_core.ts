// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/core/01_core.js
"use strict";

import { primordials } from './00_primordials.js';
const {
  Error,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  Map,
  Array,
  ArrayPrototypeFill,
  ArrayPrototypePush,
  ArrayPrototypeMap,
  ErrorCaptureStackTrace,
  Promise,
  ObjectFromEntries,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeDelete,
  MapPrototypeSet,
  PromisePrototypeThen,
  PromisePrototypeFinally,
  StringPrototypeSlice,
  ObjectAssign,
  SymbolFor,
  setQueueMicrotask,
} = primordials;

import * as ops from './01__ops.js';

import type { OpCallTrace, UncaughtExceptionCallback } from './types/index.js';

const errorMap = {};
// Builtin v8 / JS errors
registerErrorClass("Error", Error);
registerErrorClass("RangeError", RangeError);
registerErrorClass("ReferenceError", ReferenceError);
registerErrorClass("SyntaxError", SyntaxError);
registerErrorClass("TypeError", TypeError);
registerErrorClass("URIError", URIError);

let nextPromiseId = 1;
export const promiseMap = new Map();
export const RING_SIZE = 4 * 1024;
export const NO_PROMISE = null; // Alias to null is faster than plain nulls
export const promiseRing = ArrayPrototypeFill(new Array(RING_SIZE), NO_PROMISE);
// TODO(bartlomieju): it future use `v8::Private` so it's not visible
// to users. Currently missing bindings.
export const promiseIdSymbol = SymbolFor("Deno.core.internalPromiseId");

let opCallTracingEnabled = false;

/**
 * A map containing traces for all ongoing async ops. The key is the op id.
 * Tracing only occurs when `Deno.core.enableOpCallTracing()` was previously
 * enabled.
 */
export const opCallTraces: Map<number, OpCallTrace> = new Map();

/**
 * Enables collection of stack traces of all async ops. This allows for
 * debugging of where a given async op was started. Deno CLI uses this for
 * improving error message in op sanitizer errors for `deno test`.
 *
 * **NOTE:** enabling tracing has a significant negative performance impact.
 * To get high level metrics on async ops with no added performance cost,
 * use `Deno.core.metrics()`.
 */
export function enableOpCallTracing() {
  opCallTracingEnabled = true;
}

export function isOpCallTracingEnabled() {
  return opCallTracingEnabled;
}

export function setPromise(promiseId: number) {
  const idx = promiseId % RING_SIZE;
  // Move old promise from ring to map
  const oldPromise = promiseRing[idx];
  if (oldPromise !== NO_PROMISE) {
    const oldPromiseId = promiseId - RING_SIZE;
    MapPrototypeSet(promiseMap, oldPromiseId, oldPromise);
  }
  // Set new promise
  return promiseRing[idx] = newPromise();
}

export function getPromise(promiseId: number) {
  // Check if out of ring bounds, fallback to map
  const outOfBounds = promiseId < nextPromiseId - RING_SIZE;
  if (outOfBounds) {
    const promise = MapPrototypeGet(promiseMap, promiseId);
    MapPrototypeDelete(promiseMap, promiseId);
    return promise;
  }
  // Otherwise take from ring
  const idx = promiseId % RING_SIZE;
  const promise = promiseRing[idx];
  promiseRing[idx] = NO_PROMISE;
  return promise;
}

export function newPromise<T = any>() {
  let resolve: (value: unknown) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  }) as Promise<T> & { resolve: (value: unknown) => void, reject: (reason?: any) => void };
  promise.resolve = resolve;
  promise.reject = reject;
  return promise;
}

export function hasPromise(promiseId: number) {
  // Check if out of ring bounds, fallback to map
  const outOfBounds = promiseId < nextPromiseId - RING_SIZE;
  if (outOfBounds) {
    return MapPrototypeHas(promiseMap, promiseId);
  }
  // Otherwise check it in ring
  const idx = promiseId % RING_SIZE;
  return promiseRing[idx] != NO_PROMISE;
}

export function opresolve() {
  for (let i = 0; i < arguments.length; i += 2) {
    const promiseId = arguments[i];
    const res = arguments[i + 1];
    const promise = getPromise(promiseId);
    promise.resolve(res);
  }
}

export function registerErrorClass(className: string, errorClass: any) {
  registerErrorBuilder(className, (msg: string) => new errorClass(msg));
}

export function registerErrorBuilder(className: string, errorBuilder: (msg: string) => Error) {
  if (typeof errorMap[className] !== "undefined") {
    throw new TypeError(`Error class for "${className}" already registered`);
  }
  errorMap[className] = errorBuilder;
}

export function buildCustomError(className: string, message: string, code: number) {
  const error = errorMap[className]?.(message);
  // Strip buildCustomError() calls from stack trace
  if (typeof error == "object") {
    ErrorCaptureStackTrace(error, buildCustomError);
    if (code) {
      error.code = code;
    }
  }
  return error;
}

export function unwrapOpResult(res: Error & {$err_class_name?: string, code?: number}) {
  // .$err_class_name is a special key that should only exist on errors
  if (res?.$err_class_name) {
    const className = res.$err_class_name;
    const errorBuilder = errorMap[className];
    const err = errorBuilder ? errorBuilder(res.message) : new Error(
      `Unregistered error class: "${className}"\n  ${res.message}\n  Classes of errors returned from ops should be registered via Deno.core.registerErrorClass().`,
    );
    // Set .code if error was a known OS error, see error_codes.rs
    if (res.code) {
      err.code = res.code;
    }
    // Strip unwrapOpResult() and errorBuilder() calls from stack trace
    ErrorCaptureStackTrace(err, unwrapOpResult);
    throw err;
  }
  return res;
}

export function rollPromiseId() {
  return nextPromiseId++;
}

// Generate async op wrappers. See core/bindings.rs
export function initializeAsyncOps() {
  function genAsyncOp(op: any, name: string, args: string) {
    return new Function(
      "setPromise",
      "getPromise",
      "promiseIdSymbol",
      "rollPromiseId",
      "handleOpCallTracing",
      "op",
      "unwrapOpResult",
      "PromisePrototypeThen",
      `
      return function ${name}(${args}) {
        const id = rollPromiseId();
        let promise = PromisePrototypeThen(setPromise(id), unwrapOpResult);
        try {
          op(id, ${args});
        } catch (err) {
          // Cleanup the just-created promise
          getPromise(id);
          // Rethrow the error
          throw err;
        }
        handleOpCallTracing("${name}", id, promise);
        promise[promiseIdSymbol] = id;          
        return promise;
      }
    `,
    )(
      setPromise,
      getPromise,
      promiseIdSymbol,
      rollPromiseId,
      handleOpCallTracing,
      op,
      unwrapOpResult,
      PromisePrototypeThen,
    );
  }

  // { <name>: <argc>, ... }
  for (const ele of Object.entries(ops.asyncOpsInfo())) {
    if (!ele) continue;
    const [name, argc] = ele;
    const op = ops[name];
    const args = Array.from({ length: argc as number }, (_, i) => `arg${i}`).join(", ");
    ops[name] = genAsyncOp(op, name, args);
  }
}

export function handleOpCallTracing(opName: string, promiseId: number, p: Promise<any>) {
  if (opCallTracingEnabled) {
    const stack = StringPrototypeSlice(new Error().stack, 6);
    MapPrototypeSet(opCallTraces, promiseId, { opName, stack });
    p = PromisePrototypeFinally(
      p,
      () => MapPrototypeDelete(opCallTraces, promiseId),
    );
  }
}

/**
 * Call an op in Rust, and asynchronously receive the result.
 */
export async function opAsync(opName: string, ...args: any[]): Promise<any> {
  return ops[opName](...args);
}

/**
 * Mark following promise as "ref", ie. event loop won't exit
 * until all "ref" promises are resolved. All async ops are "ref" by default.
 */
export function refOp(promiseId: number) {
  if (!hasPromise(promiseId)) {
    return;
  }
  ops.op_ref_op(promiseId);
}

/**
 * Mark following promise as "unref", ie. event loop will exit
 * if there are only "unref" promises left.
 */
export function unrefOp(promiseId: number): void {
  if (!hasPromise(promiseId)) {
    return;
  }
  ops.op_unref_op(promiseId);
}

export const unrefOps = unrefOp;

/**
 * Retrieve a list of all open resources, in the form of a map that maps
 * resource id to the resource name.
 */
export function resources(): Record<string, string> {
  return { "0": "stdin", "1": "stdout", "2": "stderr" };
  // return ObjectFromEntries(ops.op_resources());
}

export function metrics() {
  const [aggregate, perOps] = ops.op_metrics();
  //@ts-ignore
  aggregate.ops = ObjectFromEntries(ArrayPrototypeMap(
    ops.op_op_names(),
    (opName: string, opId: number) => [opName, perOps[opId]],
  ));
  return aggregate;
}

let reportExceptionCallback: undefined | ((error?: unknown) => void) = undefined;

// Used to report errors thrown from functions passed to `queueMicrotask()`.
// The callback will be passed the thrown error. For example, you can use this
// to dispatch an error event to the global scope.
// In other words, set the implementation for
// https://html.spec.whatwg.org/multipage/webappapis.html#report-the-exception
export function setReportExceptionCallback(cb: (error?: unknown) => void) {
  if (typeof cb != "function") {
    throw new TypeError("expected a function");
  }
  reportExceptionCallback = cb;
}

export function queueMicrotask(cb?: () => void) {
  if (typeof cb != "function") {
    throw new TypeError("expected a function");
  }
  return ops.op_queue_microtask(() => {
    try {
      cb();
    } catch (error) {
      if (reportExceptionCallback) {
        reportExceptionCallback(error);
      } else {
        throw error;
      }
    }
  });
}

// Some "extensions" rely on "BadResource" and "Interrupted" errors in the
// JS code (eg. "deno_net") so they are provided in "Deno.core" but later
// reexported on "Deno.errors"
export class BadResource extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BadResource";
  }
}
export const BadResourcePrototype = BadResource.prototype;

export class Interrupted extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "Interrupted";
  }
}
export const InterruptedPrototype = Interrupted.prototype;

export const promiseHooks = {
  init: [],
  before: [],
  after: [],
  resolve: [],
  hasBeenSet: false,
};

/**
 * Adds a callback for the given Promise event. If this function is called
 * multiple times, the callbacks are called in the order they were added.
 * - `init_hook` is called when a new promise is created. When a new promise
 *   is created as part of the chain in the case of `Promise.then` or in the
 *   intermediate promises created by `Promise.{race, all}`/`AsyncFunctionAwait`,
 *   we pass the parent promise otherwise we pass undefined.
 * - `before_hook` is called at the beginning of the promise reaction.
 * - `after_hook` is called at the end of the promise reaction.
 * - `resolve_hook` is called at the beginning of resolve or reject function.
 */
export function setPromiseHooks(
  init?: (
    promise: Promise<unknown>,
    parentPromise?: Promise<unknown>,
  ) => void,
  before?: (promise: Promise<unknown>) => void,
  after?: (promise: Promise<unknown>) => void,
  resolve?: (promise: Promise<unknown>) => void,
): void {
  if (init) ArrayPrototypePush(promiseHooks.init, init);
  if (before) ArrayPrototypePush(promiseHooks.before, before);
  if (after) ArrayPrototypePush(promiseHooks.after, after);
  if (resolve) ArrayPrototypePush(promiseHooks.resolve, resolve);

  if (!promiseHooks.hasBeenSet) {
    promiseHooks.hasBeenSet = true;

    ops.op_set_promise_hooks((promise, parentPromise) => {
      for (let i = 0; i < promiseHooks.init.length; ++i) {
        promiseHooks.init[i](promise, parentPromise);
      }
    }, (promise) => {
      for (let i = 0; i < promiseHooks.before.length; ++i) {
        promiseHooks.before[i](promise);
      }
    }, (promise) => {
      for (let i = 0; i < promiseHooks.after.length; ++i) {
        promiseHooks.after[i](promise);
      }
    }, (promise) => {
      for (let i = 0; i < promiseHooks.resolve.length; ++i) {
        promiseHooks.resolve[i](promise);
      }
    });
  }
}

/**
 * Close the resource with the specified op id. Throws `BadResource` error
 * if resource doesn't exist in resource table.
 */
export const close = (rid: number): void => ops.op_close(rid);

/**
 * Try close the resource with the specified op id; if resource with given
 * id doesn't exist do nothing.
 */
export const tryClose = (rid: number): void => ops.op_try_close(rid);

/**
 * Read from a (stream) resource that implements read()
 */
export const read = (rid: number, buffer: Uint8Array): Promise<number> => ops.op_read(rid, buffer);
export const readAll = (rid: number) => ops.op_read_all(rid);

/**
 * Write to a (stream) resource that implements write()
 */
export const write = (rid: number, buffer: Uint8Array): Promise<number> => ops.op_write(rid, buffer);

/**
 * Write to a (stream) resource that implements write()
 */
export const writeAll = (rid: number, buffer: Uint8Array): Promise<void> => ops.op_write_all(rid, buffer);

/**
 * Shutdown a resource
 */
export const shutdown = (rid: number): Promise<void> => ops.op_shutdown(rid);

/**
 * Print a message to stdout or stderr
 */
export const print = (msg: string, isErr?: boolean) => ops.op_print(msg, isErr);

/** Set a value telling the runtime if there are "next ticks" scheduled */
export const setHasNextTickScheduled = (value: boolean): void => {

}

/**
 * Set a callback that will be called after resolving ops and "next ticks".
 */
export const setMacrotaskCallback = (fn: () => boolean): void => ops.op_set_macrotask_callback(fn);

/**
 * Set a callback that will be called after resolving ops and before resolving
 * macrotasks.
 */
export const setNextTickCallback = (
  fn: () => void,
): void => ops.op_set_next_tick_callback(fn);

export const runMicrotasks = () => ops.op_run_microtasks();
export const hasTickScheduled = () => ops.op_has_tick_scheduled();
export const setHasTickScheduled = (bool: boolean) => ops.op_set_has_tick_scheduled(bool);
export const evalContext = (
  source,
  specifier,
) => ops.op_eval_context(source, specifier);
export const createHostObject = () => ops.op_create_host_object();

/** Encode a string to its Uint8Array representation. */
export const encode = (text: string) => ops.op_encode(text);

export const decode = (buffer: Uint8Array) => ops.op_decode(buffer);

export const serialize = (
  value,
  options?,
  errorCallback?,
) => ops.op_serialize(value, options, errorCallback);
export const deserialize = (buffer, options?) => ops.op_deserialize(buffer, options);
export const getPromiseDetails = (promise: Promise<any>) => ops.op_get_promise_details(promise);
export const getProxyDetails = (proxy) => ops.op_get_proxy_details(proxy);
export const isProxy = (value) => ops.op_is_proxy(value);
export const memoryUsage = () => ops.op_memory_usage();

/**
 * Set a callback that will be called when the WebAssembly streaming APIs
 * (`WebAssembly.compileStreaming` and `WebAssembly.instantiateStreaming`)
 * are called in order to feed the source's bytes to the wasm compiler.
 * The callback is called with the source argument passed to the streaming
 * APIs and an rid to use with the wasm streaming ops.
 *
 * The callback should eventually invoke the following ops:
 *   - `op_wasm_streaming_feed`. Feeds bytes from the wasm resource to the
 *     compiler. Takes the rid and a `Uint8Array`.
 *   - `op_wasm_streaming_abort`. Aborts the wasm compilation. Takes the rid
 *     and an exception. Invalidates the resource.
 *   - `op_wasm_streaming_set_url`. Sets a source URL for the wasm module.
 *     Takes the rid and a string.
 *   - To indicate the end of the resource, use `Deno.core.close()` with the
 *     rid.
 */
export const setWasmStreamingCallback = (
  fn: (source: any, rid: number) => void,
): void => ops.op_set_wasm_streaming_callback(fn);


export const abortWasmStreaming = (
  rid: number,
  error,
) => ops.op_abort_wasm_streaming(rid, error);
export const destructureError = (error: Error) => ops.op_destructure_error(error);
export const opNames = () => ops.op_op_names();
export const eventLoopHasMoreWork = () => ops.op_event_loop_has_more_work();

/**
 * Set a callback that will be called when a promise without a .catch
 * handler is rejected. Returns the old handler or undefined.
 */
export const setPromiseRejectCallback = (fn: UncaughtExceptionCallback) => ops.op_set_promise_reject_callback(fn);

/**
 * Set a callback that will be called when an exception isn't caught
 * by any try/catch handlers. Currently only invoked when the callback
 * to setPromiseRejectCallback() throws an exception but that is expected
 * to change in the future. Returns the old handler or undefined.
 */
export const setUncaughtExceptionCallback = (
  cb: UncaughtExceptionCallback,
): undefined | UncaughtExceptionCallback => {
  console.warn("Not implemented: core.setUncaughtExceptionCallback");
  return undefined;
}

export const byteLength = (str: string) => ops.op_str_byte_length(str);

