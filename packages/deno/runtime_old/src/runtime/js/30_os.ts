// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/30_os.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as ops from '../../ops/index.js';
import type {
  Env,
} from '../../types/index.js';
import { Event, EventTarget } from '../../ext/web/02_event.js';
const {
  Error,
  SymbolFor,
} = primordials;

const windowDispatchEvent = EventTarget.prototype.dispatchEvent.bind(window);

/**
 * Returns an array containing the 1, 5, and 15 minute load averages. The
 * load average is a measure of CPU and IO utilization of the last one, five,
 * and 15 minute periods expressed as a fractional number.  Zero means there
 * is no load. On Windows, the three values are always the same and represent
 * the current load, not the 1, 5 and 15 minute load averages.
 *
 * ```ts
 * console.log(Deno.loadavg());  // e.g. [ 0.71, 0.44, 0.44 ]
 * ```
 *
 * Requires `allow-sys` permission.
 *
 * @tags allow-sys
 * @category Observability
 */
export function loadavg(): number[] {
  return ops.op_loadavg();
}

/**
 * Get the `hostname` of the machine the Deno process is running on.
 *
 * ```ts
 * console.log(Deno.hostname());
 * ```
 *
 * Requires `allow-sys` permission.
 *
 * @tags allow-sys
 * @category Runtime Environment
 */
export function hostname(): string {
  return ops.op_hostname();
}

/**
 * Returns the release version of the Operating System.
 *
 * ```ts
 * console.log(Deno.osRelease());
 * ```
 *
 * Requires `allow-sys` permission.
 * Under consideration to possibly move to Deno.build or Deno.versions and if
 * it should depend sys-info, which may not be desirable.
 *
 * @tags allow-sys
 * @category Runtime Environment
 */
export function osRelease(): string {
  return ops.op_os_release();
}

export function systemMemoryInfo() {
  return ops.op_system_memory_info();
}

export function networkInterfaces() {
  return ops.op_network_interfaces();
}

export function gid(): number {
  return ops.op_gid();
}

export function uid(): number {
  return ops.op_uid();
}

// This is an internal only method used by the test harness to override the
// behavior of exit when the exit sanitizer is enabled.
let exitHandler: null | ((code: number) => void) = null;

export function setExitHandler(fn: null | ((code: number) => void)) {
  exitHandler = fn;
}

/** Exit the Deno process with optional exit code.
 *
 * If no exit code is supplied then Deno will exit with return code of `0`.
 *
 * In worker contexts this is an alias to `self.close();`.
 *
 * ```ts
 * Deno.exit(5);
 * ```
 *
 * @category Runtime Environment
 */
export function exit(code: number) {
  // Set exit code first so unload event listeners can override it.
  if (typeof code === "number") {
    ops.op_set_exit_code(code);
  } else {
    code = 0;
  }

  // Dispatches `unload` only when it's not dispatched yet.
  if (!window[SymbolFor("isUnloadDispatched")]) {
    // Invokes the `unload` hooks before exiting
    // ref: https://github.com/denoland/deno/issues/3603
    windowDispatchEvent(new Event("unload"));
  }

  if (exitHandler) {
    exitHandler(code);
    return;
  }

  ops.op_exit();
  throw new Error("Code not reachable");
}

/** Set the value of an environment variable.
 *
 * ```ts
 * Deno.env.set("SOME_VAR", "Value");
 * Deno.env.get("SOME_VAR");  // outputs "Value"
 * ```
 *
 * Requires `allow-env` permission.
 *
 * @tags allow-env
 */
function setEnv(key: string, value: string): void {
  ops.op_set_env(key, value);
}

/** Retrieve the value of an environment variable.
 *
 * Returns `undefined` if the supplied environment variable is not defined.
 *
 * ```ts
 * console.log(Deno.env.get("HOME"));  // e.g. outputs "/home/alice"
 * console.log(Deno.env.get("MADE_UP_VAR"));  // outputs "undefined"
 * ```
 *
 * Requires `allow-env` permission.
 *
 * @tags allow-env
 */
function getEnv(key: string): string | undefined {
  return ops.op_get_env(key) ?? undefined;
}


/** Delete the value of an environment variable.
 *
 * ```ts
 * Deno.env.set("SOME_VAR", "Value");
 * Deno.env.delete("SOME_VAR");  // outputs "undefined"
 * ```
 *
 * Requires `allow-env` permission.
 *
 * @tags allow-env
 */
function deleteEnv(key: string): void {
  ops.op_delete_env(key);
}

export const env: Env = {
  get: getEnv,

  /** Returns a snapshot of the environment variables at invocation as a
   * simple object of keys and values.
   *
   * ```ts
   * Deno.env.set("TEST_VAR", "A");
   * const myEnv = Deno.env.toObject();
   * console.log(myEnv.SHELL);
   * Deno.env.set("TEST_VAR", "B");
   * console.log(myEnv.TEST_VAR);  // outputs "A"
   * ```
   *
   * Requires `allow-env` permission.
   *
   * @tags allow-env
   */
  toObject(): { [index: string]: string } {
    return ops.op_env();
  },
  set: setEnv,
  delete: deleteEnv,
};

/**
 * Returns the path to the current deno executable.
 *
 * ```ts
 * console.log(Deno.execPath());  // e.g. "/home/alice/.local/bin/deno"
 * ```
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category Runtime Environment
 */
export function execPath() {
  return ops.op_exec_path();
}
