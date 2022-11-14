// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/url/01_urlpattern.js

// @ts-check
// <reference path="../../core/internal.d.ts" />
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../webidl/internal.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="./lib.deno_url.d.ts" />

"use strict";


import { primordials, ops } from '@gjsify/deno_core';
import * as webidl from '../webidl/00_webidl.js';
import type { URLPatternInput, UrlComponents, URLPatternResult } from '@gjsify/deno_core';

const {
  ArrayPrototypeMap,
  ObjectKeys,
  ObjectFromEntries,
  RegExp,
  RegExpPrototypeExec,
  RegExpPrototypeTest,
  Symbol,
  SymbolFor,
  TypeError,
} = primordials;

const _components = Symbol("components");

/**
 * The URLPattern API provides a web platform primitive for matching URLs based
 * on a convenient pattern syntax.
 *
 * The syntax is based on path-to-regexp. Wildcards, named capture groups,
 * regular groups, and group modifiers are all supported.
 *
 * ```ts
 * // Specify the pattern as structured data.
 * const pattern = new URLPattern({ pathname: "/users/:user" });
 * const match = pattern.exec("/users/joe");
 * console.log(match.pathname.groups.user); // joe
 * ```
 *
 * ```ts
 * // Specify a fully qualified string pattern.
 * const pattern = new URLPattern("https://example.com/books/:id");
 * console.log(pattern.test("https://example.com/books/123")); // true
 * console.log(pattern.test("https://deno.land/books/123")); // false
 * ```
 *
 * ```ts
 * // Specify a relative string pattern with a base URL.
 * const pattern = new URLPattern("/:article", "https://blog.example.com");
 * console.log(pattern.test("https://blog.example.com/article")); // true
 * console.log(pattern.test("https://blog.example.com/article/123")); // false
 * ```
 *
 * @category Web APIs
 */
export class URLPattern {
  /** @type {Components} */
  [_components: symbol]: UrlComponents;
  
  // @ts-ignore
  [webidl.brand]: any;

  constructor(input: URLPatternInput, baseURL?: string) {
    // @ts-ignore
    this[webidl.brand] = webidl.brand;
    const prefix = "Failed to construct 'URLPattern'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    input = webidl.converters.URLPatternInput(input, {
      prefix,
      context: "Argument 1",
    });
    if (baseURL !== undefined) {
      baseURL = webidl.converters.USVString(baseURL, {
        prefix,
        context: "Argument 2",
      });
    }

    const components = ops.op_urlpattern_parse(input, baseURL);

    for (const key of ObjectKeys(components)) {
      try {
        components[key].regexp = new RegExp(
          components[key].regexpString,
          "u",
        );
      } catch (e) {
        throw new TypeError(`${prefix}: ${key} is invalid; ${e.message}`);
      }
    }

    this[_components] = components;
  }

  /** The pattern string for the `protocol`. */
  get protocol() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].protocol.patternString;
  }

  /** The pattern string for the `username`. */
  get username() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].username.patternString;
  }

  /** The pattern string for the `password`. */
  get password() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].password.patternString;
  }

  /** The pattern string for the `hostname`. */
  get hostname() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].hostname.patternString;
  }

  /** The pattern string for the `port`. */
  get port() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].port.patternString;
  }

  /** The pattern string for the `pathname`. */
  get pathname() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].pathname.patternString;
  }

  /** The pattern string for the `search`. */
  get search() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].search.patternString;
  }

  /** The pattern string for the `hash`. */
  get hash() {
    webidl.assertBranded(this, URLPatternPrototype);
    return this[_components].hash.patternString;
  }

  /**
   * Test if the given input matches the stored pattern.
   *
   * The input can either be provided as a url string (with an optional base),
   * or as individual components in the form of an object.
   *
   * ```ts
   * const pattern = new URLPattern("https://example.com/books/:id");
   *
   * // Test a url string.
   * console.log(pattern.test("https://example.com/books/123")); // true
   *
   * // Test a relative url with a base.
   * console.log(pattern.test("/books/123", "https://example.com")); // true
   *
   * // Test an object of url components.
   * console.log(pattern.test({ pathname: "/books/123" })); // true
   * ```
   */
  test(input: URLPatternInput, baseURL?: string): boolean {
    webidl.assertBranded(this, URLPatternPrototype);
    const prefix = "Failed to execute 'test' on 'URLPattern'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    input = webidl.converters.URLPatternInput(input, {
      prefix,
      context: "Argument 1",
    });
    if (baseURL !== undefined) {
      baseURL = webidl.converters.USVString(baseURL, {
        prefix,
        context: "Argument 2",
      });
    }

    const res = ops.op_urlpattern_process_match_input(
      input,
      baseURL,
    );
    if (res === null) {
      return false;
    }

    const [values] = res;

    for (const key of ObjectKeys(values)) {
      if (!RegExpPrototypeTest(this[_components][key].regexp, values[key])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match the given input against the stored pattern.
   *
   * The input can either be provided as a url string (with an optional base),
   * or as individual components in the form of an object.
   *
   * ```ts
   * const pattern = new URLPattern("https://example.com/books/:id");
   *
   * // Match a url string.
   * let match = pattern.exec("https://example.com/books/123");
   * console.log(match.pathname.groups.id); // 123
   *
   * // Match a relative url with a base.
   * match = pattern.exec("/books/123", "https://example.com");
   * console.log(match.pathname.groups.id); // 123
   *
   * // Match an object of url components.
   * match = pattern.exec({ pathname: "/books/123" });
   * console.log(match.pathname.groups.id); // 123
   * ```
   */
  exec(input: URLPatternInput, baseURL?: string): URLPatternResult | null {
    webidl.assertBranded(this, URLPatternPrototype);
    const prefix = "Failed to execute 'exec' on 'URLPattern'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    input = webidl.converters.URLPatternInput(input, {
      prefix,
      context: "Argument 1",
    });
    if (baseURL !== undefined) {
      baseURL = webidl.converters.USVString(baseURL, {
        prefix,
        context: "Argument 2",
      });
    }

    const res = ops.op_urlpattern_process_match_input(
      input,
      baseURL,
    );
    if (res === null) {
      return null;
    }

    const [values, inputs] = res;
    if (inputs[1] === null) {
      inputs.pop();
    }

    const result = { inputs } as any as URLPatternResult;

    /** @type {string} */
    for (const key of ObjectKeys(values)) {
      /** @type {Component} */
      const component = this[_components][key];
      const input = values[key];
      const match = RegExpPrototypeExec(component.regexp, input);
      if (match === null) {
        return null;
      }
      const groupEntries = ArrayPrototypeMap(
        component.groupNameList,
        (name, i) => [name, match[i + 1] ?? ""],
      );
      const groups = ObjectFromEntries(groupEntries as any); // TODO type
      result[key] = {
        input,
        groups,
      };
    }

    return result;
  }

  // @ts-ignore
  [SymbolFor("Deno.customInspect")](inspect: (obj: any) => void) {
    return `URLPattern ${
      inspect({
        protocol: this.protocol,
        username: this.username,
        password: this.password,
        hostname: this.hostname,
        port: this.port,
        pathname: this.pathname,
        search: this.search,
        hash: this.hash,
      })
    }`;
  }
}

webidl.configurePrototype(URLPattern);
const URLPatternPrototype = URLPattern.prototype;

webidl.converters.URLPatternInit = webidl
  .createDictionaryConverter("URLPatternInit", [
    { key: "protocol", converter: webidl.converters.USVString },
    { key: "username", converter: webidl.converters.USVString },
    { key: "password", converter: webidl.converters.USVString },
    { key: "hostname", converter: webidl.converters.USVString },
    { key: "port", converter: webidl.converters.USVString },
    { key: "pathname", converter: webidl.converters.USVString },
    { key: "search", converter: webidl.converters.USVString },
    { key: "hash", converter: webidl.converters.USVString },
    { key: "baseURL", converter: webidl.converters.USVString },
  ]);

webidl.converters["URLPatternInput"] = (V, opts) => {
  // Union for (URLPatternInit or USVString)
  if (typeof V == "object") {
    return webidl.converters.URLPatternInit(V, opts);
  }
  return webidl.converters.USVString(V, opts);
};


