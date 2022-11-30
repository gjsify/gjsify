// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/06_util.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import { build } from './01_build.js';
import { URLPrototype } from '../../ext/url/index.js';

const {
  decodeURIComponent,
  ObjectPrototypeIsPrototypeOf,
  Promise,
  SafeArrayIterator,
  StringPrototypeReplace,
  TypeError,
} = primordials;

let logDebug = false;
let logSource = "JS";

export function setLogDebug(debug: boolean, source: string) {
  logDebug = debug;
  if (source) {
    logSource = source;
  }
}

export function log(...args: any[]) {
  if (logDebug) {
    // if we destructure `console` off `globalThis` too early, we don't bind to
    // the right console, therefore we don't log anything out.
    globalThis.console.log(
      `DEBUG ${logSource} -`,
      ...new SafeArrayIterator(args),
    );
  }
}

export function createResolvable() {
  let resolve: (value: unknown) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  }) as Promise<any> & {resolve: (value: unknown) => void; reject: (reason?: any) => void;}
  promise.resolve = resolve;
  promise.reject = reject;
  return promise;
}

// Keep in sync with `fromFileUrl()` in `std/path/win32.ts`.
export function pathFromURLWin32(url: URL) {
  let p = StringPrototypeReplace(
    url.pathname,
    /^\/*([A-Za-z]:)(\/|$)/,
    "$1/" as any, // TODO type
  );
  p = StringPrototypeReplace(
    p,
    /\//g,
    "\\" as any, // TODO type
  );
  p = StringPrototypeReplace(
    p,
    /%(?![0-9A-Fa-f]{2})/g,
    "%25" as any, // TODO type
  );
  let path = decodeURIComponent(p);
  if (url.hostname != "") {
    // Note: The `URL` implementation guarantees that the drive letter and
    // hostname are mutually exclusive. Otherwise it would not have been valid
    // to append the hostname and path like this.
    path = `\\\\${url.hostname}${path}`;
  }
  return path;
}

// Keep in sync with `fromFileUrl()` in `std/path/posix.ts`.
export function pathFromURLPosix(url: URL) {
  if (url.hostname !== "") {
    throw new TypeError(`Host must be empty.`);
  }

  return decodeURIComponent(
    StringPrototypeReplace(url.pathname, /%(?![0-9A-Fa-f]{2})/g, "%25" as any /* TODO type*/),
  );
}

export function pathFromURL(pathOrUrl: URL | string): string {
  if (ObjectPrototypeIsPrototypeOf(URLPrototype, pathOrUrl)) {
    if ((pathOrUrl as URL).protocol != "file:") {
      throw new TypeError("Must be a file URL.");
    }

    return build.os == "windows"
      ? pathFromURLWin32(pathOrUrl as URL)
      : pathFromURLPosix(pathOrUrl as URL);
  }
  return pathOrUrl as string;
}

export function writable(value: any) {
  return {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  };
}

export function nonEnumerable(value: any) {
  return {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  };
}

export function readOnly(value: any) {
  return {
    value,
    enumerable: true,
    writable: false,
    configurable: true,
  };
}

export function getterOnly(getter: any) {
  return {
    get: getter,
    enumerable: true,
    configurable: true,
  };
}
