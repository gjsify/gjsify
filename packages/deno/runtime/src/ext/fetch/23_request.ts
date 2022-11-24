// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/23_request.js

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
import * as consoleInternal from '../console/02_console.js';
import {
  HTTP_TOKEN_CODE_POINT_RE,
  byteUpperCase,
} from '../web/00_infra.js';
import { URL } from '../url/00_url.js';
import {
  guardFromHeaders,
  headersFromHeaderList,
  headerListFromHeaders,
  fillHeaders,
  getDecodeSplitHeader,
} from './20_headers.js';
import { mixinBody, extractBody, InnerBody } from './22_body.js';
import { getLocationHref } from '../web/12_location.js';
import { extractMimeType } from '../web/01_mimesniff.js';
import { blobFromObjectUrl, Blob } from '../web/09_file.js';
import { HttpClientPrototype } from './22_http_client.js';
import * as abortSignal from '../web/03_abort_signal.js';

import type { RequestInfo, RequestInit, Body } from './lib.deno_fetch';
import type { FormData } from './21_formdata.js';

import {
  ReadableStream,
} from '../web/06_streams.js';

const {
  ArrayPrototypeMap,
  ArrayPrototypeSlice,
  ArrayPrototypeSplice,
  ObjectKeys,
  ObjectPrototypeIsPrototypeOf,
  RegExpPrototypeTest,
  Symbol,
  SymbolFor,
  TypeError,
} = primordials;

const _request = Symbol("request");
const _headers = Symbol("headers");
const _getHeaders = Symbol("get headers");
const _headersCache = Symbol("headers cache");
const _signal = Symbol("signal");
const _mimeType = Symbol("mime type");
const _body = Symbol("body");
export const _flash = Symbol("flash");
const _url = Symbol("url");
const _method = Symbol("method");

/**
 * @param {(() => string)[]} urlList
 * @param {string[]} urlListProcessed
 */
export function processUrlList(urlList: (() => string)[], urlListProcessed: string[]) {
  for (let i = 0; i < urlList.length; i++) {
    if (urlListProcessed[i] === undefined) {
      urlListProcessed[i] = urlList[i]();
    }
  }
  return urlListProcessed;
}

export interface InnerRequest {

  // TODO: what type is right?
  method: string;
  // method: () => string;
  url: () => URL;
  currentUrl: () => URL;
  headerList: [string, string][];
  // headerList: () => [string, string][];
  body: null | InnerBody;
  redirectMode: "follow" | "error" | "manual";
  redirectCount: number;
  urlList: (() => string)[];
  urlListProcessed: string[];
  // NOTE: non standard extension for `Deno.HttpClient`.
  clientRid: number | null
  blobUrlEntry: Blob | null;
}

export function newInnerRequest(method: () => string, url: string | (() => string), headerList: () => [string, string][], body: InnerBody, maybeBlob: boolean): InnerRequest {
  let blobUrlEntry = null;
  if (maybeBlob && typeof url === "string" && url.startsWith("blob:")) {
    blobUrlEntry = blobFromObjectUrl(url);
  }
  const innerRequest: InnerRequest = {
    // @ts-ignore
    methodInner: null,
    get method() {
      if (this.methodInner === null) {
        try {
          this.methodInner = method();
        } catch {
          throw new TypeError("cannot read method: request closed");
        }
      }
      return this.methodInner;
    },
    set method(value) {
      this.methodInner = value;
    },
    headerListInner: null,
    get headerList() {
      if (this.headerListInner === null) {
        try {
          this.headerListInner = headerList();
        } catch {
          throw new TypeError("cannot read headers: request closed");
        }
      }
      return this.headerListInner;
    },
    set headerList(value) {
      this.headerListInner = value;
    },
    body,
    redirectMode: "follow",
    redirectCount: 0,
    urlList: [typeof url === "string" ? () => url : url],
    urlListProcessed: [],
    clientRid: null,
    blobUrlEntry,
    url() {
      if (this.urlListProcessed[0] === undefined) {
        try {
          this.urlListProcessed[0] = this.urlList[0]();
        } catch {
          throw new TypeError("cannot read url: request closed");
        }
      }
      return this.urlListProcessed[0];
    },
    currentUrl() {
      const currentIndex = this.urlList.length - 1;
      if (this.urlListProcessed[currentIndex] === undefined) {
        try {
          this.urlListProcessed[currentIndex] = this.urlList[currentIndex]();
        } catch {
          throw new TypeError("cannot read url: request closed");
        }
      }
      return this.urlListProcessed[currentIndex];
    },
  };
  return innerRequest;
}

/**
 * https://fetch.spec.whatwg.org/#concept-request-clone
 * @param {InnerRequest} request
 * @returns {InnerRequest}
 */
function cloneInnerRequest(request: InnerRequest): InnerRequest {
  const headerList = ArrayPrototypeMap(
    request.headerList,
    (x) => [x[0], x[1]],
  );

  let body = null;
  if (request.body !== null) {
    // @ts-ignore
    body = request.body.clone();
  }

  const result: InnerRequest = {
    method: request.method,
    // @ts-ignore TODO: CHECKME
    headerList,
    body,
    redirectMode: request.redirectMode,
    redirectCount: request.redirectCount,
    urlList: request.urlList,
    urlListProcessed: request.urlListProcessed,
    clientRid: request.clientRid,
    blobUrlEntry: request.blobUrlEntry,
    url() {
      if (this.urlListProcessed[0] === undefined) {
        try {
          this.urlListProcessed[0] = this.urlList[0]();
        } catch {
          throw new TypeError("cannot read url: request closed");
        }
      }
      return this.urlListProcessed[0];
    },
    currentUrl() {
      const currentIndex = this.urlList.length - 1;
      if (this.urlListProcessed[currentIndex] === undefined) {
        try {
          this.urlListProcessed[currentIndex] = this.urlList[currentIndex]();
        } catch {
          throw new TypeError("cannot read url: request closed");
        }
      }
      return this.urlListProcessed[currentIndex];
    },
  };

  return result;
}

/**
 * @param {string} m
 * @returns {boolean}
 */
function isKnownMethod(m: string): boolean {
  return (
    m === "DELETE" ||
    m === "GET" ||
    m === "HEAD" ||
    m === "OPTIONS" ||
    m === "POST" ||
    m === "PUT"
  );
}
/**
 * @param {string} m
 * @returns {string}
 */
function validateAndNormalizeMethod(m: string): string {
  // Fast path for well-known methods
  if (isKnownMethod(m)) {
    return m;
  }

  // Regular path
  if (!RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, m)) {
    throw new TypeError("Method is not valid.");
  }
  const upperCase = byteUpperCase(m);
  if (
    upperCase === "CONNECT" || upperCase === "TRACE" || upperCase === "TRACK"
  ) {
    throw new TypeError("Method is forbidden.");
  }
  return upperCase;
}

/** This Fetch API export interface represents a resource request.
 *
 * @category Fetch API
 */
 export interface Request extends Body {

  /**
   * Returns the cache mode associated with request, which is a string
   * indicating how the request will interact with the browser's cache when
   * fetching.
   */
  readonly cache: RequestCache;
  /**
   * Returns the credentials mode associated with request, which is a string
   * indicating whether credentials will be sent with the request always, never,
   * or only when sent to a same-origin URL.
   */
  readonly credentials: RequestCredentials;
  /**
   * Returns the kind of resource requested by request, e.g., "document" or "script".
   */
  readonly destination: RequestDestination;

  /**
   * Returns request's subresource integrity metadata, which is a cryptographic
   * hash of the resource being fetched. Its value consists of multiple hashes
   * separated by whitespace. [SRI]
   */
  readonly integrity: string;
  /**
   * Returns a boolean indicating whether or not request is for a history
   * navigation (a.k.a. back-forward navigation).
   */
  readonly isHistoryNavigation: boolean;
  /**
   * Returns a boolean indicating whether or not request is for a reload
   * navigation.
   */
  readonly isReloadNavigation: boolean;
  /**
   * Returns a boolean indicating whether or not request can outlive the global
   * in which it was created.
   */
  readonly keepalive: boolean;
  /**
   * Returns the mode associated with request, which is a string indicating
   * whether the request will use CORS, or will be restricted to same-origin
   * URLs.
   */
  readonly mode: RequestMode;
  /**
   * Returns the referrer of request. Its value can be a same-origin URL if
   * explicitly set in init, the empty string to indicate no referrer, and
   * "about:client" when defaulting to the global's default. This is used during
   * fetching to determine the value of the `Referer` header of the request
   * being made.
   */
  readonly referrer: string;
  /**
   * Returns the referrer policy associated with request. This is used during
   * fetching to compute the value of the request's referrer.
   */
  readonly referrerPolicy: ReferrerPolicy;

  /** A simple getter used to expose a `ReadableStream` of the body contents. */
  readonly body: ReadableStream<Uint8Array> | null;
  /** Stores a `Boolean` that declares whether the body has been used in a
   * request yet.
   */
  readonly bodyUsed: boolean;
  /** Takes a `Request` stream and reads it to completion. It returns a promise
   * that resolves with an `ArrayBuffer`.
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Takes a `Request` stream and reads it to completion. It returns a promise
   * that resolves with a `Blob`.
   */
  blob(): Promise<Blob>;
  /** Takes a `Request` stream and reads it to completion. It returns a promise
   * that resolves with a `FormData` object.
   */
  formData(): Promise<FormData>;
  /** Takes a `Request` stream and reads it to completion. It returns a promise
   * that resolves with the result of parsing the body text as JSON.
   */
  json(): Promise<any>;
  /** Takes a `Request` stream and reads it to completion. It returns a promise
   * that resolves with a `USVString` (text).
   */
  text(): Promise<string>;
}


/** This Fetch API export interface represents a resource request.
 *
 * @category Fetch API
 */
export class Request implements Body {
  // @ts-ignore
  [_request]: InnerRequest;
  // @ts-ignore
  [_headersCache]: Headers;
  // @ts-ignore
  [_getHeaders];

  /** @type {Headers} */
  get [_headers](): Headers {
    if (this[_headersCache] === undefined) {
      this[_headersCache] = this[_getHeaders]();
    }
    return this[_headersCache];
  }

  set [_headers](value) {
    this[_headersCache] = value;
  }

  // @ts-ignore
  [_signal]: AbortSignal;
  get [_mimeType]() {
    const values = getDecodeSplitHeader(
      headerListFromHeaders(this[_headers]),
      "Content-Type",
    );
    return extractMimeType(values);
  }
  get [_body]() {
    if (this[_flash]) {
      return this[_flash].body;
    } else {
      return this[_request].body;
    }
  }

  /**
   * https://fetch.spec.whatwg.org/#dom-request
   */
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const prefix = "Failed to construct 'Request'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    input = webidl.converters["RequestInfo_DOMString"](input, {
      prefix,
      context: "Argument 1",
    });
    init = webidl.converters["RequestInit"](init, {
      prefix,
      context: "Argument 2",
    });

    this[webidl.brand] = webidl.brand;

    /** @type {InnerRequest} */
    let request: InnerRequest;
    const baseURL = getLocationHref();

    // 4.
    let signal = null;

    // 5.
    if (typeof input === "string") {
      const parsedURL = new URL(input, baseURL);
      request = newInnerRequest(
        () => "GET",
        parsedURL.href,
        () => [],
        null,
        true,
      );
    } else { // 6.
      if (!ObjectPrototypeIsPrototypeOf(RequestPrototype, input)) {
        throw new TypeError("Unreachable");
      }
      request = input[_request];
      signal = input[_signal];
    }

    // 12.
    // TODO(lucacasonato): create a copy of `request`

    // 22.
    if (init.redirect !== undefined) {
      request.redirectMode = init.redirect;
    }

    // 25.
    if (init.method !== undefined) {
      let method: any = init.method;
      method = validateAndNormalizeMethod(method);
      request.method = method;
    }

    // 26.
    if (init.signal !== undefined) {
      signal = init.signal;
    }

    // NOTE: non standard extension. This handles Deno.HttpClient parameter
    if ((init as any).client !== undefined) {
      if (
        (init as any).client !== null &&
        !ObjectPrototypeIsPrototypeOf(HttpClientPrototype, (init as any).client)
      ) {
        throw webidl.makeException(
          TypeError,
          "`client` must be a Deno.HttpClient",
          { prefix, context: "Argument 2" },
        );
      }
      request.clientRid = (init as any).client?.rid ?? null;
    }

    // 27.
    this[_request] = request;

    // 28.
    this[_signal] = abortSignal.newSignal();

    // 29.
    if (signal !== null) {
      abortSignal.follow(this[_signal], signal);
    }

    // 30.
    this[_headers] = headersFromHeaderList(request.headerList, "request");

    // 32.
    if (ObjectKeys(init).length > 0) {
      let headers = ArrayPrototypeSlice(
        headerListFromHeaders(this[_headers]),
        0,
        headerListFromHeaders(this[_headers]).length,
      );
      if (init.headers !== undefined) {
        headers = init.headers as any;
      }
      ArrayPrototypeSplice(
        headerListFromHeaders(this[_headers]),
        0,
        headerListFromHeaders(this[_headers]).length,
      );
      fillHeaders(this[_headers], headers);
    }

    // 33.
    let inputBody = null;
    if (ObjectPrototypeIsPrototypeOf(RequestPrototype, input)) {
      inputBody = input[_body];
    }

    // 34.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      ((init.body !== undefined && init.body !== null) ||
        inputBody !== null)
    ) {
      throw new TypeError("Request with GET/HEAD method cannot have body.");
    }

    // 35.
    let initBody = null;

    // 36.
    if (init.body !== undefined && init.body !== null) {
      const res = extractBody(init.body);
      initBody = res.body;
      if (res.contentType !== null && !this[_headers].has("content-type")) {
        this[_headers].append("Content-Type", res.contentType);
      }
    }

    // 37.
    const inputOrInitBody = initBody ?? inputBody;

    // 39.
    let finalBody = inputOrInitBody;

    // 40.
    if (initBody === null && inputBody !== null) {
      if (input[_body] && input[_body].unusable()) {
        throw new TypeError("Input request's body is unusable.");
      }
      finalBody = inputBody.createProxy();
    }

    // 41.
    request.body = finalBody;
  }

  /**
   * Returns request's HTTP method, which is "GET" by default.
   */
  get method(): string {
    webidl.assertBranded(this, RequestPrototype);
    if (this[_method]) {
      return this[_method];
    }
    if (this[_flash]) {
      this[_method] = this[_flash].methodCb();
      return this[_method];
    } else {
      this[_method] = this[_request].method;
      return this[_method];
    }
  }

  /**
   * Returns the URL of request as a string.
   */
  get url(): string {
    webidl.assertBranded(this, RequestPrototype);
    if (this[_url]) {
      return this[_url];
    }

    if (this[_flash]) {
      this[_url] = this[_flash].urlCb();
      return this[_url];
    } else {
      this[_url] = this[_request].url();
      return this[_url];
    }
  }

  /**
   * Returns a Headers object consisting of the headers associated with request.
   * Note that headers added in the network layer by the user agent will not be
   * accounted for in this object, e.g., the "Host" header.
   */
  get headers(): Headers {
    webidl.assertBranded(this, RequestPrototype);
    return this[_headers];
  }

  /**
   * Returns the redirect mode associated with request, which is a string
   * indicating how redirects for the request will be handled during fetching. A
   * request will follow redirects by default.
   */
  get redirect(): RequestRedirect {
    webidl.assertBranded(this, RequestPrototype);
    if (this[_flash]) {
      return this[_flash].redirectMode;
    }
    return this[_request].redirectMode;
  }

  /**
   * Returns the signal associated with request, which is an AbortSignal object
   * indicating whether or not request has been aborted, and its abort event
   * handler.
   */
  get signal(): AbortSignal {
    webidl.assertBranded(this, RequestPrototype);
    return this[_signal];
  }

  clone(): Request {
    webidl.assertBranded(this, RequestPrototype);
    if (this[_body] && this[_body].unusable()) {
      throw new TypeError("Body is unusable.");
    }
    let newReq;
    if (this[_flash]) {
      newReq = cloneInnerRequest(this[_flash]);
    } else {
      newReq = cloneInnerRequest(this[_request]);
    }
    const newSignal = abortSignal.newSignal();
    abortSignal.follow(newSignal, this[_signal]);
    return fromInnerRequest(
      newReq,
      newSignal,
      guardFromHeaders(this[_headers]),
    );
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(RequestPrototype, this),
      keys: [
        "bodyUsed" as any,
        "headers",
        "method",
        "redirect",
        "url",
      ],
    }));
  }
}

webidl.configurePrototype(Request);
const RequestPrototype = Request.prototype;
mixinBody(RequestPrototype, _body, _mimeType);

webidl.converters["Request"] = webidl.createInterfaceConverter(
  "Request",
  RequestPrototype,
);
webidl.converters["RequestInfo_DOMString"] = (V, opts) => {
  // Union for (Request or USVString)
  if (typeof V == "object") {
    if (ObjectPrototypeIsPrototypeOf(RequestPrototype, V)) {
      return webidl.converters["Request"](V, opts);
    }
  }
  // Passed to new URL(...) which implicitly converts DOMString -> USVString
  return webidl.converters["DOMString"](V, opts);
};
webidl.converters["RequestRedirect"] = webidl.createEnumConverter(
  "RequestRedirect",
  [
    "follow",
    "error",
    "manual",
  ],
);
webidl.converters["RequestInit"] = webidl.createDictionaryConverter(
  "RequestInit",
  [
    { key: "method", converter: webidl.converters["ByteString"] },
    { key: "headers", converter: webidl.converters["HeadersInit"] },
    {
      key: "body",
      converter: webidl.createNullableConverter(
        webidl.converters["BodyInit_DOMString"],
      ),
    },
    { key: "redirect", converter: webidl.converters["RequestRedirect"] },
    {
      key: "signal",
      converter: webidl.createNullableConverter(
        webidl.converters["AbortSignal"],
      ),
    },
    { key: "client", converter: webidl.converters.any },
  ],
);

/**
 * @param {Request} request
 * @returns {InnerRequest}
 */
export function toInnerRequest(request: Request): InnerRequest {
  return request[_request];
}

/**
 * @param {InnerRequest} inner
 * @param {"request" | "immutable" | "request-no-cors" | "response" | "none"} guard
 * @returns {Request}
 */
export function fromInnerRequest(inner: InnerRequest, signal, guard: "request" | "immutable" | "request-no-cors" | "response" | "none"): Request {
  const request = webidl.createBranded(Request);
  request[_request] = inner;
  request[_signal] = signal;
  request[_getHeaders] = () => headersFromHeaderList(inner.headerList, guard);
  return request;
}

/**
 * @param {number} serverId
 * @param {number} streamRid
 * @param {ReadableStream} body
 * @param {() => string} methodCb
 * @param {() => string} urlCb
 * @param {() => [string, string][]} headersCb
 * @returns {Request}
 */
export function fromFlashRequest(
  serverId: number,
  streamRid: number,
  body: ReadableStream,
  methodCb: () => string,
  urlCb: () => string,
  headersCb: () => [string, string][],
): Request {
  const request = webidl.createBranded(Request);
  request[_flash] = {
    body: body !== null ? new InnerBody(body) : null,
    methodCb,
    urlCb,
    streamRid,
    serverId,
    redirectMode: "follow",
    redirectCount: 0,
  };
  request[_getHeaders] = () => headersFromHeaderList(headersCb(), "request");
  return request;
}
