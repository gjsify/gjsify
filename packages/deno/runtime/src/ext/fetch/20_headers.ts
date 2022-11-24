// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/20_headers.js

// @ts-check
// <reference path="../webidl/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="../web/06_streams_types.d.ts" />
// <reference path="./lib.deno_fetch.d.ts" />
// <reference lib="esnext" />

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as webidl from '../webidl/00_webidl.js';
import {
  HTTP_TAB_OR_SPACE_PREFIX_RE,
  HTTP_TAB_OR_SPACE_SUFFIX_RE,
  HTTP_TOKEN_CODE_POINT_RE,
  byteLowerCase,
  collectSequenceOfCodepoints,
  collectHttpQuotedString,
  httpTrim,
} from '../web/00_infra.js';
const {
  ArrayIsArray,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSort,
  ArrayPrototypeJoin,
  ArrayPrototypeSplice,
  ArrayPrototypeFilter,
  ObjectPrototypeHasOwnProperty,
  ObjectEntries,
  RegExpPrototypeTest,
  SafeArrayIterator,
  Symbol,
  SymbolFor,
  SymbolIterator,
  StringPrototypeReplaceAll,
  TypeError,
} = primordials;

import type { DomIterable } from './lib.deno_fetch';

const _headerList = Symbol("header list");
const _iterableHeaders = Symbol("iterable headers");
const _guard = Symbol("guard");

export type Header = [string, string];
export type HeaderList = Header[];

function normalizeHeaderValue(potentialValue: string): string {
  return httpTrim(potentialValue);
}

export function fillHeaders(headers: Headers, object: HeadersInit) {
  if (ArrayIsArray(object)) {
    // @ts-ignore
    for (const header of object) {
      if (header.length !== 2) {
        throw new TypeError(
          `Invalid header. Length must be 2, but is ${header.length}`,
        );
      }
      appendHeader(headers, header[0], header[1]);
    }
  } else {
    for (const key in object) {
      if (!ObjectPrototypeHasOwnProperty(object, key)) {
        continue;
      }
      appendHeader(headers, key, object[key]);
    }
  }
}

// Regex matching illegal chars in a header value
// deno-lint-ignore no-control-regex
const ILLEGAL_VALUE_CHARS = /[\x00\x0A\x0D]/;

/**
 * https://fetch.spec.whatwg.org/#concept-headers-append
 * @param {Headers} headers
 * @param {string} name
 * @param {string} value
 */
function appendHeader(headers: Headers, name: string, value: string) {
  // 1.
  value = normalizeHeaderValue(value);

  // 2.
  if (!RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, name)) {
    throw new TypeError("Header name is not valid.");
  }
  if (RegExpPrototypeTest(ILLEGAL_VALUE_CHARS, value)) {
    throw new TypeError("Header value is not valid.");
  }

  // 3.
  if (headers[_guard] == "immutable") {
    throw new TypeError("Headers are immutable.");
  }

  // 7.
  const list = headers[_headerList];
  const lowercaseName = byteLowerCase(name);
  for (let i = 0; i < list.length; i++) {
    if (byteLowerCase(list[i][0]) === lowercaseName) {
      name = list[i][0];
      break;
    }
  }
  ArrayPrototypePush(list, [name, value]);
}

/**
 * https://fetch.spec.whatwg.org/#concept-header-list-get
 */
export function getHeader(list: HeaderList, name: string) {
  const lowercaseName = byteLowerCase(name);
  const entries = ArrayPrototypeMap(
    ArrayPrototypeFilter(
      list,
      (entry) => byteLowerCase(entry[0]) === lowercaseName,
    ),
    (entry) => entry[1],
  );
  if (entries.length === 0) {
    return null;
  } else {
    return ArrayPrototypeJoin(entries, "\x2C\x20");
  }
}

/**
 * https://fetch.spec.whatwg.org/#concept-header-list-get-decode-split
 */
export function getDecodeSplitHeader(list: HeaderList, name: string): string[] | null {
  const initialValue = getHeader(list, name);
  if (initialValue === null) return null;
  const input = initialValue;
  let position = 0;
  const values = [];
  let value = "";
  while (position < initialValue.length) {
    // 7.1. collect up to " or ,
    const res = collectSequenceOfCodepoints(
      initialValue,
      position,
      (c) => c !== "\u0022" && c !== "\u002C",
    );
    value += res.result;
    position = res.position;

    if (position < initialValue.length) {
      if (input[position] === "\u0022") {
        const res = collectHttpQuotedString(input, position, false);
        value += res.result;
        position = res.position;
        if (position < initialValue.length) {
          continue;
        }
      } else {
        if (input[position] !== "\u002C") throw new TypeError("Unreachable");
        position += 1;
      }
    }

    value = StringPrototypeReplaceAll(value, HTTP_TAB_OR_SPACE_PREFIX_RE, "" as any);
    value = StringPrototypeReplaceAll(value, HTTP_TAB_OR_SPACE_SUFFIX_RE, "" as any);

    ArrayPrototypePush(values, value);
    value = "";
  }
  return values;
}

export interface Headers extends DomIterable<string, string> {
  /** Returns an iterator allowing to go through all key/value pairs
   * contained in this Headers object. The both the key and value of each pairs
   * are ByteString objects.
   */
  entries(): IterableIterator<[string, string]>;
  /** Returns an iterator allowing to go through all values contained in
   * this Headers object. The values are ByteString objects.
   */
  values(): IterableIterator<string>;
  forEach(
    callbackfn: (value: string, key: string, parent: this) => void,
    thisArg?: any,
  ): void;
  /** The Symbol.iterator well-known symbol specifies the default
  * iterator for this Headers object
  */
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

/** This Fetch API export interface allows you to perform various actions on HTTP
 * request and response headers. These actions include retrieving, setting,
 * adding to, and removing. A Headers object has an associated header list,
 * which is initially empty and consists of zero or more name and value pairs.
 * You can add to this using methods like append() (see Examples). In all
 * methods of this export interface, header names are matched by case-insensitive byte
 * sequence.
 *
 * @category Fetch API
 */
export class Headers {
  // @ts-ignore
  [_headerList]: HeaderList = [];
  // @ts-ignore
  [_guard]: "immutable" | "request" | "request-no-cors" | "response" | "none" = "none";

  get [_iterableHeaders]() {
    const list = this[_headerList];

    // The order of steps are not similar to the ones suggested by the
    // spec but produce the same result.
    const headers = {};
    const cookies = [];
    for (const entry of list) {
      const name = byteLowerCase(entry[0]);
      const value = entry[1];
      if (value === null) throw new TypeError("Unreachable");
      // The following if statement is not spec compliant.
      // `set-cookie` is the only header that can not be concatenated,
      // so must be given to the user as multiple headers.
      // The else block of the if statement is spec compliant again.
      if (name === "set-cookie") {
        ArrayPrototypePush(cookies, [name, value]);
      } else {
        // The following code has the same behaviour as getHeader()
        // at the end of loop. But it avoids looping through the entire
        // list to combine multiple values with same header name. It
        // instead gradually combines them as they are found.
        let header = headers[name];
        if (header && header.length > 0) {
          header += "\x2C\x20" + value;
        } else {
          header = value;
        }
        headers[name] = header;
      }
    }

    return ArrayPrototypeSort(
      [
        ...new SafeArrayIterator(ObjectEntries(headers)),
        ...new SafeArrayIterator(cookies),
      ],
      (a, b) => {
        const akey = a[0];
        const bkey = b[0];
        if (akey > bkey) return 1;
        if (akey < bkey) return -1;
        return 0;
      },
    );
  }

  constructor(init: HeadersInit = undefined) {
    const prefix = "Failed to construct 'Headers'";
    if (init !== undefined) {
      init = webidl.converters["HeadersInit"](init, {
        prefix,
        context: "Argument 1",
      });
    }

    this[webidl.brand] = webidl.brand;
    this[_guard] = "none";
    if (init !== undefined) {
      fillHeaders(this, init);
    }
  }

  /** Appends a new value onto an existing header inside a `Headers` object, or
   * adds the header if it does not already exist.
   */
  append(name: string, value: string): void {
    webidl.assertBranded(this, HeadersPrototype);
    const prefix = "Failed to execute 'append' on 'Headers'";
    webidl.requiredArguments(arguments.length, 2, { prefix });
    name = webidl.converters["ByteString"](name, {
      prefix,
      context: "Argument 1",
    });
    value = webidl.converters["ByteString"](value, {
      prefix,
      context: "Argument 2",
    });
    appendHeader(this, name, value);
  }

  /** Deletes a header from a `Headers` object. */
  delete(name: string): void {
    const prefix = "Failed to execute 'delete' on 'Headers'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    name = webidl.converters["ByteString"](name, {
      prefix,
      context: "Argument 1",
    });

    if (!RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, name)) {
      throw new TypeError("Header name is not valid.");
    }
    if (this[_guard] == "immutable") {
      throw new TypeError("Headers are immutable.");
    }

    const list = this[_headerList];
    const lowercaseName = byteLowerCase(name);
    for (let i = 0; i < list.length; i++) {
      if (byteLowerCase(list[i][0]) === lowercaseName) {
        ArrayPrototypeSplice(list, i, 1);
        i--;
      }
    }
  }

  /** Returns a `ByteString` sequence of all the values of a header within a
   * `Headers` object with a given name.
   */
  get(name: string): string | null {
    const prefix = "Failed to execute 'get' on 'Headers'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    name = webidl.converters["ByteString"](name, {
      prefix,
      context: "Argument 1",
    });

    if (!RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, name)) {
      throw new TypeError("Header name is not valid.");
    }

    const list = this[_headerList];
    return getHeader(list, name);
  }

  /** Returns a boolean stating whether a `Headers` object contains a certain
   * header.
   */
  has(name: string): boolean {
    const prefix = "Failed to execute 'has' on 'Headers'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    name = webidl.converters["ByteString"](name, {
      prefix,
      context: "Argument 1",
    });

    if (!RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, name)) {
      throw new TypeError("Header name is not valid.");
    }

    const list = this[_headerList];
    const lowercaseName = byteLowerCase(name);
    for (let i = 0; i < list.length; i++) {
      if (byteLowerCase(list[i][0]) === lowercaseName) {
        return true;
      }
    }
    return false;
  }

  /** Sets a new value for an existing header inside a Headers object, or adds
   * the header if it does not already exist.
   */
  set(name: string, value: string): void {
    webidl.assertBranded(this, HeadersPrototype);
    const prefix = "Failed to execute 'set' on 'Headers'";
    webidl.requiredArguments(arguments.length, 2, { prefix });
    name = webidl.converters["ByteString"](name, {
      prefix,
      context: "Argument 1",
    });
    value = webidl.converters["ByteString"](value, {
      prefix,
      context: "Argument 2",
    });

    value = normalizeHeaderValue(value);

    // 2.
    if (!RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, name)) {
      throw new TypeError("Header name is not valid.");
    }
    if (RegExpPrototypeTest(ILLEGAL_VALUE_CHARS, value)) {
      throw new TypeError("Header value is not valid.");
    }

    if (this[_guard] == "immutable") {
      throw new TypeError("Headers are immutable.");
    }

    const list = this[_headerList];
    const lowercaseName = byteLowerCase(name);
    let added = false;
    for (let i = 0; i < list.length; i++) {
      if (byteLowerCase(list[i][0]) === lowercaseName) {
        if (!added) {
          list[i][1] = value;
          added = true;
        } else {
          ArrayPrototypeSplice(list, i, 1);
          i--;
        }
      }
    }
    if (!added) {
      ArrayPrototypePush(list, [name, value]);
    }
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    const headers = {};
    // @ts-ignore
    for (const header of this) {
      headers[header[0]] = header[1];
    }
    return `Headers ${inspect(headers)}`;
  }
}

webidl.mixinPairIterable("Headers", Headers, _iterableHeaders, 0, 1);

webidl.configurePrototype(Headers);
const HeadersPrototype = Headers.prototype;

webidl.converters["HeadersInit"] = (V, opts) => {
  // Union for (sequence<sequence<ByteString>> or record<ByteString, ByteString>)
  if (webidl.type(V) === "Object" && V !== null) {
    if (V[SymbolIterator] !== undefined) {
      return webidl.converters["sequence<sequence<ByteString>>"](V, opts);
    }
    return webidl.converters["record<ByteString, ByteString>"](V, opts);
  }
  throw webidl.makeException(
    TypeError,
    "The provided value is not of type '(sequence<sequence<ByteString>> or record<ByteString, ByteString>)'",
    opts,
  );
};
webidl.converters["Headers"] = webidl.createInterfaceConverter(
  "Headers",
  Headers.prototype,
);

export function headersFromHeaderList(list: HeaderList, guard: "immutable" | "request" | "request-no-cors" | "response" | "none"): Headers {
  const headers = webidl.createBranded(Headers);
  headers[_headerList] = list;
  headers[_guard] = guard;
  return headers;
}

export function headerListFromHeaders(headers: Headers): HeaderList {
  return headers[_headerList];
}

export function guardFromHeaders(headers: Headers): "immutable" | "request" | "request-no-cors" | "response" | "none" {
  return headers[_guard];
}
