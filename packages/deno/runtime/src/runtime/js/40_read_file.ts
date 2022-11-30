// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/tree/main/runtime/js
"use strict";

import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import { pathFromURL } from './06_util.js';
import * as abortSignal from '../../ext/web/03_abort_signal.js';

export function readFileSync(path) {
  return ops.op_readfile_sync(pathFromURL(path));
}

export async function readFile(path, options) {
  let cancelRid;
  let abortHandler;
  if (options?.signal) {
    options.signal.throwIfAborted();
    cancelRid = ops.op_cancel_handle();
    abortHandler = () => core.tryClose(cancelRid);
    options.signal[abortSignal.add](abortHandler);
  }

  try {
    const read = await core.opAsync(
      "op_readfile_async",
      pathFromURL(path),
      cancelRid,
    );
    return read;
  } finally {
    if (options?.signal) {
      options.signal[abortSignal.remove](abortHandler);

      // always throw the abort error when aborted
      options.signal.throwIfAborted();
    }
  }
}

export function readTextFileSync(path) {
  return ops.op_readfile_text_sync(pathFromURL(path));
}

export async function readTextFile(path, options) {
  let cancelRid;
  let abortHandler;
  if (options?.signal) {
    options.signal.throwIfAborted();
    cancelRid = ops.op_cancel_handle();
    abortHandler = () => core.tryClose(cancelRid);
    options.signal[abortSignal.add](abortHandler);
  }

  try {
    const read = await core.opAsync(
      "op_readfile_text_async",
      pathFromURL(path),
      cancelRid,
    );
    return read;
  } finally {
    if (options?.signal) {
      options.signal[abortSignal.remove](abortHandler);

      // always throw the abort error when aborted
      options.signal.throwIfAborted();
    }
  }
}
