// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Bases on https://github.com/denoland/deno/blob/main/ext/url/lib.deno_url.d.ts

// deno-lint-ignore-file no-explicit-any

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

/** @category Web APIs */
export interface URLPatternInit {
  protocol?: string;
  username?: string;
  password?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  baseURL?: string;
}

/** @category Web APIs */
export type URLPatternInput = string | URLPatternInit;

/** @category Web APIs */
export interface URLPatternComponentResult {
  input: string;
  groups: Record<string, string>;
}

/** `URLPatternResult` is the object returned from `URLPattern.exec`.
 *
 * @category Web APIs
 */
export interface URLPatternResult {
  /** The inputs provided when matching. */
  inputs: [URLPatternInit] | [URLPatternInit, string];

  /** The matched result for the `protocol` matcher. */
  protocol: URLPatternComponentResult;
  /** The matched result for the `username` matcher. */
  username: URLPatternComponentResult;
  /** The matched result for the `password` matcher. */
  password: URLPatternComponentResult;
  /** The matched result for the `hostname` matcher. */
  hostname: URLPatternComponentResult;
  /** The matched result for the `port` matcher. */
  port: URLPatternComponentResult;
  /** The matched result for the `pathname` matcher. */
  pathname: URLPatternComponentResult;
  /** The matched result for the `search` matcher. */
  search: URLPatternComponentResult;
  /** The matched result for the `hash` matcher. */
  hash: URLPatternComponentResult;
}

export interface UrlComponents {
  protocol: UrlComponent;
  username: UrlComponent;
  password: UrlComponent;
  hostname: UrlComponent;
  port: UrlComponent;
  pathname: UrlComponent;
  search: UrlComponent;
  hash: UrlComponent;
}

export interface UrlComponent {
  patternString: string;
  regexp: RegExp;
  groupNameList: string[];
}