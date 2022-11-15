// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/00_infra.js

// @ts-check
// <reference path="../../core/internal.d.ts" />
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as ops from '../../ops/index.js';

const {
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  Error,
  JSONStringify,
  NumberPrototypeToString,
  RegExp,
  SafeArrayIterator,
  String,
  StringPrototypeCharAt,
  StringPrototypeCharCodeAt,
  StringPrototypeMatch,
  StringPrototypePadStart,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSubstring,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
  TypeError,
} = primordials;

export const ASCII_DIGIT = ["\u0030-\u0039"];
export const ASCII_UPPER_ALPHA = ["\u0041-\u005A"];
export const ASCII_LOWER_ALPHA = ["\u0061-\u007A"];
export const ASCII_ALPHA = [
  ...new SafeArrayIterator(ASCII_UPPER_ALPHA) as string,
  ...new SafeArrayIterator(ASCII_LOWER_ALPHA) as string,
];
export const ASCII_ALPHANUMERIC = [
  ...new SafeArrayIterator(ASCII_DIGIT) as string,
  ...new SafeArrayIterator(ASCII_ALPHA) as string,
];

export const HTTP_TAB_OR_SPACE = ["\u0009", "\u0020"];
export const HTTP_WHITESPACE = [
  "\u000A",
  "\u000D",
  ...new SafeArrayIterator(HTTP_TAB_OR_SPACE),
];

export const HTTP_TOKEN_CODE_POINT = [
  "\u0021",
  "\u0023",
  "\u0024",
  "\u0025",
  "\u0026",
  "\u0027",
  "\u002A",
  "\u002B",
  "\u002D",
  "\u002E",
  "\u005E",
  "\u005F",
  "\u0060",
  "\u007C",
  "\u007E",
  ...new SafeArrayIterator(ASCII_ALPHANUMERIC),
];
export const HTTP_TOKEN_CODE_POINT_RE = new RegExp(
  `^[${regexMatcher(HTTP_TOKEN_CODE_POINT)}]+$`,
);
export const HTTP_QUOTED_STRING_TOKEN_POINT = [
  "\u0009",
  "\u0020-\u007E",
  "\u0080-\u00FF",
];
export const HTTP_QUOTED_STRING_TOKEN_POINT_RE = new RegExp(
  `^[${regexMatcher(HTTP_QUOTED_STRING_TOKEN_POINT)}]+$`,
);
export const HTTP_TAB_OR_SPACE_MATCHER = regexMatcher(HTTP_TAB_OR_SPACE);
export const HTTP_TAB_OR_SPACE_PREFIX_RE = new RegExp(
  `^[${HTTP_TAB_OR_SPACE_MATCHER}]+`,
  "g",
);
export const HTTP_TAB_OR_SPACE_SUFFIX_RE = new RegExp(
  `[${HTTP_TAB_OR_SPACE_MATCHER}]+$`,
  "g",
);
export const HTTP_WHITESPACE_MATCHER = regexMatcher(HTTP_WHITESPACE);
export const HTTP_BETWEEN_WHITESPACE = new RegExp(
  `^[${HTTP_WHITESPACE_MATCHER}]*(.*?)[${HTTP_WHITESPACE_MATCHER}]*$`,
);
export const HTTP_WHITESPACE_PREFIX_RE = new RegExp(
  `^[${HTTP_WHITESPACE_MATCHER}]+`,
  "g",
);
export const HTTP_WHITESPACE_SUFFIX_RE = new RegExp(
  `[${HTTP_WHITESPACE_MATCHER}]+$`,
  "g",
);

/**
 * Turn a string of chars into a regex safe matcher.
 */
export function regexMatcher(chars: string[]): string {
  const matchers = ArrayPrototypeMap(chars, (char) => {
    if (char.length === 1) {
      const a = StringPrototypePadStart(
        NumberPrototypeToString(StringPrototypeCharCodeAt(char, 0), 16),
        4,
        "0",
      );
      return `\\u${a}`;
    } else if (char.length === 3 && char[1] === "-") {
      const a = StringPrototypePadStart(
        NumberPrototypeToString(StringPrototypeCharCodeAt(char, 0), 16),
        4,
        "0",
      );
      const b = StringPrototypePadStart(
        NumberPrototypeToString(StringPrototypeCharCodeAt(char, 2), 16),
        4,
        "0",
      );
      return `\\u${a}-\\u${b}`;
    } else {
      throw TypeError("unreachable");
    }
  });
  return ArrayPrototypeJoin(matchers, "");
}

/**
 * https://infra.spec.whatwg.org/#collect-a-sequence-of-code-points
 */
export function collectSequenceOfCodepoints(input: string, position: number, condition: (char: string) => boolean): {result: string, position: number} {
  const start = position;
  for (
    let c = StringPrototypeCharAt(input, position);
    position < input.length && condition(c);
    c = StringPrototypeCharAt(input, ++position)
  );
  return { result: StringPrototypeSlice(input, start, position), position };
}

export function byteUpperCase(s: string): string {
  return StringPrototypeReplace(
    String(s),
    /[a-z]/g,
    function byteUpperCaseReplace(c) {
      return StringPrototypeToUpperCase(c);
    },
  );
}

export function byteLowerCase(s: string): string {
  // NOTE: correct since all callers convert to ByteString first
  // TODO(@AaronO): maybe prefer a ByteString_Lower webidl converter
  return StringPrototypeToLowerCase(s);
}

/**
 * https://fetch.spec.whatwg.org/#collect-an-http-quoted-string
 */
export function collectHttpQuotedString(input: string, position: number, extractValue: boolean): {result: string, position: number} {
  // 1.
  const positionStart = position;
  // 2.
  let value = "";
  // 3.
  if (input[position] !== "\u0022") throw new TypeError('must be "');
  // 4.
  position++;
  // 5.
  while (true) {
    // 5.1.
    const res = collectSequenceOfCodepoints(
      input,
      position,
      (c) => c !== "\u0022" && c !== "\u005C",
    );
    value += res.result;
    position = res.position;
    // 5.2.
    if (position >= input.length) break;
    // 5.3.
    const quoteOrBackslash = input[position];
    // 5.4.
    position++;
    // 5.5.
    if (quoteOrBackslash === "\u005C") {
      // 5.5.1.
      if (position >= input.length) {
        value += "\u005C";
        break;
      }
      // 5.5.2.
      value += input[position];
      // 5.5.3.
      position++;
    } else { // 5.6.
      // 5.6.1
      if (quoteOrBackslash !== "\u0022") throw new TypeError('must be "');
      // 5.6.2
      break;
    }
  }
  // 6.
  if (extractValue) return { result: value, position };
  // 7.
  return {
    result: StringPrototypeSubstring(input, positionStart, position + 1),
    position,
  };
}

export function forgivingBase64Encode(data: Uint8Array): string {
  return ops.op_base64_encode(data);
}

export function forgivingBase64Decode(data: string): Uint8Array {
  return ops.op_base64_decode(data);
}

export function isHttpWhitespace(char: string): boolean {
  switch (char) {
    case "\u0009":
    case "\u000A":
    case "\u000D":
    case "\u0020":
      return true;
    default:
      return false;
  }
}

export function httpTrim(s: string): string {
  if (!isHttpWhitespace(s[0]) && !isHttpWhitespace(s[s.length - 1])) {
    return s;
  }
  return StringPrototypeMatch(s, HTTP_BETWEEN_WHITESPACE)?.[1] ?? "";
}

export class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AssertionError";
  }
}

export function assert(cond: unknown, msg: string = "Assertion failed."): asserts cond {
  if (!cond) {
    throw new AssertionError(msg);
  }
}

export function serializeJSValueToJSONString(value: unknown): string {
  const result = JSONStringify(value);
  if (result === undefined) {
    throw new TypeError("Value is not JSON serializable.");
  }
  return result;
}
