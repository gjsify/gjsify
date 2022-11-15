// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/05_base64.js

// @ts-check
// <reference path="../../core/internal.d.ts" />
// <reference path="../webidl/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference lib="esnext" />

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as ops from '../../ops/index.js';
import * as webidl from '../webidl/00_webidl.js';
import { DOMException } from './01_dom_exception.js';
const { TypeError } = primordials;

/** Decodes a string of data which has been encoded using base-64 encoding.
 *
 * ```
 * console.log(atob("aGVsbG8gd29ybGQ=")); // outputs 'hello world'
 * ```
 *
 * @category Encoding API
 */
export function atob(data: string): string {
  const prefix = "Failed to execute 'atob'";
  webidl.requiredArguments(arguments.length, 1, { prefix });
  data = webidl.converters.DOMString(data, {
    prefix,
    context: "Argument 1",
  });
  try {
    return ops.op_base64_atob(data);
  } catch (e) {
    if (e instanceof TypeError) {
      throw new DOMException(
        "Failed to decode base64: invalid character",
        "InvalidCharacterError",
      );
    }
    throw e;
  }
}

/** Creates a base-64 ASCII encoded string from the input string.
 *
 * ```
 * console.log(btoa("hello world"));  // outputs "aGVsbG8gd29ybGQ="
 * ```
 *
 * @category Encoding API
 */
export function btoa(data: string): string {
  const prefix = "Failed to execute 'btoa'";
  webidl.requiredArguments(arguments.length, 1, { prefix });
  data = webidl.converters.DOMString(data, {
    prefix,
    context: "Argument 1",
  });
  try {
    return ops.op_base64_btoa(data);
  } catch (e) {
    if (e instanceof TypeError) {
      throw new DOMException(
        "The string to be encoded contains characters outside of the Latin1 range.",
        "InvalidCharacterError",
      );
    }
    throw e;
  }
}
