// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/40_fs_events.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
const { BadResourcePrototype, InterruptedPrototype } = core;

const {
  ArrayIsArray,
  ObjectPrototypeIsPrototypeOf,
  PromiseResolve,
  SymbolAsyncIterator,
} = primordials;

import type {
  FsEvent,
} from '../../types/index.js'

class FsWatcher /*implements AsyncIterable<FsEvent>*/ {
  #rid: number = 0;

  constructor(paths: string[], options: { recursive: boolean }) {
    const { recursive } = options;
    this.#rid = ops.op_fs_events_open({ recursive, paths });
  }

  /** The resource id. */
  get rid(): number {
    return this.#rid;
  }

  async next() {
    try {
      const value = await core.opAsync("op_fs_events_poll", this.rid);
      return value
        ? { value, done: false }
        : { value: undefined, done: true };
    } catch (error) {
      if (ObjectPrototypeIsPrototypeOf(BadResourcePrototype, error)) {
        return { value: undefined, done: true };
      } else if (
        ObjectPrototypeIsPrototypeOf(InterruptedPrototype, error)
      ) {
        return { value: undefined, done: true };
      }
      throw error;
    }
  }

  // TODO(kt3k): This is deprecated. Will be removed in v2.0.
  // See https://github.com/denoland/deno/issues/10577 for details
  /**
   * Stops watching the file system and closes the watcher resource.
   *
   * @deprecated Will be removed in the future.
   */
  return(value?: any): Promise<IteratorResult<FsEvent>> {
    core.close(this.rid);
    return PromiseResolve({ value, done: true });
  }

  /** Stops watching the file system and closes the watcher resource. */
  close(): void {
    core.close(this.rid);
  }

  [SymbolAsyncIterator]() {
    return this;
  }
}

/** Watch for file system events against one or more `paths`, which can be
 * files or directories. These paths must exist already. One user action (e.g.
 * `touch test.file`) can generate multiple file system events. Likewise,
 * one user action can result in multiple file paths in one event (e.g. `mv
 * old_name.txt new_name.txt`).
 *
 * The recursive option is `true` by default and, for directories, will watch
 * the specified directory and all sub directories.
 *
 * Note that the exact ordering of the events can vary between operating
 * systems.
 *
 * ```ts
 * const watcher = Deno.watchFs("/");
 * for await (const event of watcher) {
 *    console.log(">>>> event", event);
 *    // { kind: "create", paths: [ "/foo.txt" ] }
 * }
 * ```
 *
 * Call `watcher.close()` to stop watching.
 *
 * ```ts
 * const watcher = Deno.watchFs("/");
 *
 * setTimeout(() => {
 *   watcher.close();
 * }, 5000);
 *
 * for await (const event of watcher) {
 *    console.log(">>>> event", event);
 * }
 * ```
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function watchFs(
  paths: string | string[],
  options = { recursive: true },
) {
  return new FsWatcher(ArrayIsArray(paths) ? paths : [paths], options);
}

export const fsEvents = {
  watchFs,
};

export default fsEvents;