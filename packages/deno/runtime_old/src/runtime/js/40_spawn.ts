// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/40_spawn.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import { pathFromURL } from './06_util.js';
import { illegalConstructorKey } from './01_web_util.js';
import { add, remove } from '../../ext/web/03_abort_signal.js';

import type { SpawnOptions, ChildStatus, SpawnOutput, Signal, AbortSignal } from '../../types/index.js';

const {
  ArrayPrototypeMap,
  ObjectEntries,
  String,
  TypeError,
  Uint8Array,
  PromisePrototypeThen,
  SafePromiseAll,
  SymbolFor,
} = primordials;
import {
  readableStreamForRidUnrefable,
  readableStreamForRidUnrefableRef,
  readableStreamForRidUnrefableUnref,
  writableStreamForRid,
  ReadableStream,
} from '../../ext/web/06_streams.js';

const promiseIdSymbol = SymbolFor("Deno.core.internalPromiseId");

function spawnChildInner(command: string | URL, apiName: string, {
  args = [],
  cwd = undefined,
  clearEnv = false,
  env = {},
  uid = undefined,
  gid = undefined,
  stdin = "null",
  stdout = "piped",
  stderr = "piped",
  signal = undefined,
  windowsRawArguments = false,
}: SpawnOptions = {}) {
  const child = ops.op_spawn_child({
    cmd: pathFromURL(command),
    args: ArrayPrototypeMap(args, String) as string[],
    cwd: pathFromURL(cwd),
    clearEnv,
    env: ObjectEntries(env),
    uid,
    gid,
    stdin,
    stdout,
    stderr,
    windowsRawArguments,
  }, apiName);
  return new Child(illegalConstructorKey, {
    ...child,
    signal,
  });
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * Spawns a child process.
 *
 * If any stdio options are not set to `"piped"`, accessing the corresponding
 * field on the `Child` or its `SpawnOutput` will throw a `TypeError`.
 *
 * If `stdin` is set to `"piped"`, the `stdin` {@linkcode WritableStream}
 * needs to be closed manually.
 *
 * ```ts
 * const child = Deno.spawnChild(Deno.execPath(), {
 *   args: [
 *     "eval",
 *     "console.log('Hello World')",
 *   ],
 *   stdin: "piped",
 * });
 *
 * // open a file and pipe the subprocess output to it.
 * child.stdout.pipeTo(Deno.openSync("output").writable);
 *
 * // manually close stdin
 * child.stdin.close();
 * const status = await child.status;
 * ```
 *
 * @category Sub Process
 */
export function spawnChild(command: string | URL, options: SpawnOptions = {}) {
  return spawnChildInner(command, "Deno.spawnChild()", options);
}

async function collectOutput(readableStream: ReadableStream) {
  if (!(readableStream instanceof ReadableStream)) {
    return null;
  }

  const bufs = [];
  let size = 0;
  // @ts-ignore
  for await (const chunk of readableStream) {
    bufs.push(chunk);
    size += chunk.byteLength;
  }

  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of bufs) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return buffer;
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * The interface for handling a child process returned from
 * {@linkcode Deno.spawnChild}.
 *
 * @category Sub Process
 */
export class Child {
  #rid: number;
  #waitPromiseId;
  #unrefed = false;

  #pid: number;
  get pid() {
    return this.#pid;
  }

  #stdin = null;
  get stdin(): WritableStream<Uint8Array> {
    if (this.#stdin == null) {
      throw new TypeError("stdin is not piped");
    }
    return this.#stdin;
  }

  #stdoutPromiseId;
  #stdoutRid: number;
  #stdout: ReadableStream<Uint8Array> | null = null;
  get stdout(): ReadableStream<Uint8Array> {
    if (this.#stdout == null) {
      throw new TypeError("stdout is not piped");
    }
    return this.#stdout;
  }

  #stderrPromiseId;
  #stderrRid: number;
  #stderr: ReadableStream<Uint8Array> | null = null;
  get stderr(): ReadableStream<Uint8Array> {
    if (this.#stderr == null) {
      throw new TypeError("stderr is not piped");
    }
    return this.#stderr;
  }

  constructor(key: symbol | null = null, {
    signal,
    rid,
    pid,
    stdinRid,
    stdoutRid,
    stderrRid,
  }: {
    signal: AbortSignal;
    rid: number;
    pid: number;
    stdinRid: number,
    stdoutRid: number,
    stderrRid: number,
  } | null = null) {
    if (key !== illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }

    this.#rid = rid;
    this.#pid = pid;

    if (stdinRid !== null) {
      this.#stdin = writableStreamForRid(stdinRid);
    }

    if (stdoutRid !== null) {
      this.#stdoutRid = stdoutRid;
      this.#stdout = readableStreamForRidUnrefable(stdoutRid);
    }

    if (stderrRid !== null) {
      this.#stderrRid = stderrRid;
      this.#stderr = readableStreamForRidUnrefable(stderrRid);
    }

    const onAbort = () => this.kill("SIGTERM");
    signal?.[add](onAbort);

    const waitPromise = core.opAsync("op_spawn_wait", this.#rid);
    this.#waitPromiseId = waitPromise[promiseIdSymbol];
    this.#status = PromisePrototypeThen(waitPromise, (res) => {
      this.#rid = null;
      signal?.[remove](onAbort);
      return res;
    }) as Promise<ChildStatus>;
  }

  #status: Promise<ChildStatus>;

  /** Get the status of the child. */
  get status(): Promise<ChildStatus> {
    return this.#status;
  }

  /** Waits for the child to exit completely, returning all its output and
   * status. */
  async output(): Promise<SpawnOutput> {
    if (this.#stdout?.locked) {
      throw new TypeError(
        "Can't collect output because stdout is locked",
      );
    }
    if (this.#stderr?.locked) {
      throw new TypeError(
        "Can't collect output because stderr is locked",
      );
    }

    const [status, _stdout, _stderr] = await SafePromiseAll([
      this.#status,
      collectOutput(this.#stdout),
      collectOutput(this.#stderr),
    ]) as [ ChildStatus, Uint8Array, Uint8Array ];

    return {
      success: status.success,
      code: status.code,
      signal: status.signal,
      get stdout() {
        if (_stdout == null) {
          throw new TypeError("stdout is not piped");
        }
        return _stdout;
      },
      get stderr() {
        if (_stderr == null) {
          throw new TypeError("stderr is not piped");
        }
        return _stderr;
      },
    };
  }

  /** Kills the process with given {@linkcode Deno.Signal}. Defaults to
   * `"SIGTERM"`. */
  kill(signo: Signal = "SIGTERM"): void {
    if (this.#rid === null) {
      throw new TypeError("Child process has already terminated.");
    }
    ops.op_kill(this.#pid, signo, "Deno.Child.kill()");
  }

  /** Ensure that the status of the child process prevents the Deno process
   * from exiting. */
  ref(): void {
    this.#unrefed = false;
    core.refOp(this.#waitPromiseId);
    if (this.#stdout) readableStreamForRidUnrefableRef(this.#stdout);
    if (this.#stderr) readableStreamForRidUnrefableRef(this.#stderr);
  }

  /** Ensure that the status of the child process does not block the Deno
   * process from exiting. */
  unref(): void {
    this.#unrefed = true;
    core.unrefOp(this.#waitPromiseId);
    if (this.#stdout) readableStreamForRidUnrefableUnref(this.#stdout);
    if (this.#stderr) readableStreamForRidUnrefableUnref(this.#stderr);
  }
}

export function spawn(command, options) {
  if (options?.stdin === "piped") {
    throw new TypeError(
      "Piped stdin is not supported for this function, use 'Deno.spawnChild()' instead",
    );
  }
  return spawnChildInner(command, "Deno.spawn()", options).output();
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * Synchronously executes a subprocess, waiting for it to finish and
 * collecting all of its output.
 *
 * Will throw an error if `stdin: "piped"` is passed.
 *
 * If options `stdout` or `stderr` are not set to `"piped"`, accessing the
 * corresponding field on `SpawnOutput` will throw a `TypeError`.
 *
 * ```ts
 * const { code, stdout, stderr } = Deno.spawnSync(Deno.execPath(), {
 *   args: [
 *     "eval",
 *       "console.log('hello'); console.error('world')",
 *   ],
 * });
 * console.assert(code === 0);
 * console.assert("hello\n" === new TextDecoder().decode(stdout));
 * console.assert("world\n" === new TextDecoder().decode(stderr));
 * ```
 *
 * @category Sub Process
 */
export function spawnSync(command: string | URL, {
  args = [],
  cwd = undefined,
  clearEnv = false,
  env = {},
  uid = undefined,
  gid = undefined,
  stdin = "null",
  stdout = "piped",
  stderr = "piped",
  windowsRawArguments = false,
}: SpawnOptions = {}): SpawnOutput {
  if (stdin === "piped") {
    throw new TypeError(
      "Piped stdin is not supported for this function, use 'Deno.spawnChild()' instead",
    );
  }
  const result = ops.op_spawn_sync({
    cmd: pathFromURL(command),
    args: ArrayPrototypeMap(args, String),
    cwd: pathFromURL(cwd),
    clearEnv,
    env: ObjectEntries(env),
    uid,
    gid,
    stdin,
    stdout,
    stderr,
    windowsRawArguments,
  });
  return {
    success: result.status.success,
    code: result.status.code,
    signal: result.status.signal,
    get stdout() {
      if (result.stdout == null) {
        throw new TypeError("stdout is not piped");
      }
      return result.stdout;
    },
    get stderr() {
      if (result.stderr == null) {
        throw new TypeError("stderr is not piped");
      }
      return result.stderr;
    },
  };
}

