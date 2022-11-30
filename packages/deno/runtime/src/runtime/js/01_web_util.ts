// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/01_web_util.js
"use strict";

import { primordials } from '../../core/00_primordials.js';

const { TypeError, Symbol } = primordials;
export const illegalConstructorKey = Symbol("illegalConstructorKey");

export function requiredArguments(
  name: string,
  length: number,
  required: number,
) {
  if (length < required) {
    const errMsg = `${name} requires at least ${required} argument${
      required === 1 ? "" : "s"
    }, but only ${length} present`;
    throw new TypeError(errMsg);
  }
}

