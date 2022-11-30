// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/console/01_colors.js

// <reference path="../../core/internal.d.ts" />

"use strict";

import { primordials } from '../../core/00_primordials.js';

const {
  RegExp,
  StringPrototypeReplace,
  ArrayPrototypeJoin,
} = primordials;

let noColor = false;

export function setNoColor(value) {
  noColor = value;
}

export function getNoColor() {
  return noColor;
}

function code(open, close) {
  return {
    open: `\x1b[${open}m`,
    close: `\x1b[${close}m`,
    regexp: new RegExp(`\\x1b\\[${close}m`, "g"),
  };
}

function run(str: string, code) {
  return `${code.open}${
    StringPrototypeReplace(str, code.regexp, code.open)
  }${code.close}`;
}

export function bold(str: string) {
  return run(str, code(1, 22));
}

export function italic(str: string) {
  return run(str, code(3, 23));
}

export function yellow(str: string) {
  return run(str, code(33, 39));
}

export function cyan(str: string) {
  return run(str, code(36, 39));
}

export function red(str: string) {
  return run(str, code(31, 39));
}

export function green(str: string) {
  return run(str, code(32, 39));
}

export function bgRed(str: string) {
  return run(str, code(41, 49));
}

export function white(str: string) {
  return run(str, code(37, 39));
}

export function gray(str: string) {
  return run(str, code(90, 39));
}

export function magenta(str: string) {
  return run(str, code(35, 39));
}

// https://github.com/chalk/ansi-regex/blob/02fa893d619d3da85411acc8fd4e2eea0e95a9d9/index.js
const ANSI_PATTERN = new RegExp(
  ArrayPrototypeJoin([
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ], "|"),
  "g",
);

export function stripColor(string: string) {
  return StringPrototypeReplace(string, ANSI_PATTERN, "" as any);
}

export function maybeColor(fn: (s: string) => string) {
  return !noColor ? fn : (s: string) => s;
}
