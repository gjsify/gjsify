// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/23_response.js

// @ts-check
// <reference path="../webidl/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../url/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="../web/06_streams_types.d.ts" />
// <reference path="./lib.deno_fetch.d.ts" />
// <reference lib="esnext" />
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
const { isProxy } = core;
import * as webidl from '../webidl/00_webidl.js';
import * as consoleInternal from '../console/02_console.js';
import { byteLowerCase, HTTP_TAB_OR_SPACE, regexMatcher, serializeJSValueToJSONString } from '../web/00_infra.js';
import { extractBody, mixinBody, InnerBody } from './22_body.js';
import { getLocationHref } from '../web/12_location.js';
import { extractMimeType } from '../web/01_mimesniff.js';
import { URL } from '../url/00_url.js';
import {
  getDecodeSplitHeader,
  headerListFromHeaders,
  headersFromHeaderList,
  guardFromHeaders,
  fillHeaders,
} from './20_headers.js';
const {
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ObjectDefineProperties,
  ObjectPrototypeIsPrototypeOf,
  RangeError,
  RegExp,
  RegExpPrototypeTest,
  SafeArrayIterator,
  Symbol,
  SymbolFor,
  TypeError,
} = primordials;

import {
  ReadableStream,
} from '../web/06_streams.js';

import type { Blob } from '../web/09_file.js';

import type { Body, BodyInit } from './lib.deno_fetch';
import type { FormData } from './21_formdata.js';

const VCHAR = ["\x21-\x7E"];
const OBS_TEXT = ["\x80-\xFF"];

const REASON_PHRASE = [
  ...new SafeArrayIterator(HTTP_TAB_OR_SPACE),
  ...new SafeArrayIterator(VCHAR),
  ...new SafeArrayIterator(OBS_TEXT),
];
const REASON_PHRASE_MATCHER = regexMatcher(REASON_PHRASE);
const REASON_PHRASE_RE = new RegExp(`^[${REASON_PHRASE_MATCHER}]*$`);

const _response = Symbol("response");
const _headers = Symbol("headers");
const _mimeType = Symbol("mime type");
const _body = Symbol("body");

export interface InnerResponse {
  type: "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";
  url: () => string | null;
  urlList: string[];
  status: number;
  statusMessage: string;
  headerList: [string, string][];
  body: null | InnerBody;
  aborted?: boolean;
  error?: string;
}

export function nullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

export function redirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 ||
    status === 307 || status === 308;
}

/**
 * https://fetch.spec.whatwg.org/#concept-response-clone
 * @param {InnerResponse} response
 * @returns {InnerResponse}
 */
function cloneInnerResponse(response: InnerResponse): InnerResponse {
  const urlList = [...new SafeArrayIterator(response.urlList)];
  const headerList = ArrayPrototypeMap(
    response.headerList,
    (x) => [x[0], x[1]],
  );

  let body = null;
  if (response.body !== null) {
    // @ts-ignore TODO: CHECKME
    body = response.body.clone();
  }

  return {
    type: response.type,
    body,
    // @ts-ignore TODO: CHECKME
    headerList,
    urlList,
    status: response.status,
    statusMessage: response.statusMessage,
    aborted: response.aborted,
    url() {
      if (this.urlList.length == 0) return null;
      return this.urlList[this.urlList.length - 1];
    },
  };
}

/**
 * @returns {InnerResponse}
 */
export function newInnerResponse(status = 200, statusMessage = ""): InnerResponse {
  return {
    type: "default",
    body: null,
    headerList: [],
    urlList: [],
    status,
    statusMessage,
    aborted: false,
    url() {
      if (this.urlList.length == 0) return null;
      return this.urlList[this.urlList.length - 1];
    },
  };
}

export function networkError(error: string): InnerResponse {
  const resp = newInnerResponse(0);
  resp.type = "error";
  resp.error = error;
  return resp;
}

export function abortedNetworkError(): InnerResponse {
  const resp = networkError("aborted");
  resp.aborted = true;
  return resp;
}

/**
 * https://fetch.spec.whatwg.org#initialize-a-response
 */
function initializeAResponse(response: Response, init: ResponseInit, bodyWithType: { body: InnerBody, contentType: string | null } | null) {
  // 1.
  if ((init.status < 200 || init.status > 599) && init.status != 101) {
    throw new RangeError(
      `The status provided (${init.status}) is not equal to 101 and outside the range [200, 599].`,
    );
  }

  // 2.
  if (
    init.statusText &&
    !RegExpPrototypeTest(REASON_PHRASE_RE, init.statusText)
  ) {
    throw new TypeError("Status text is not valid.");
  }

  // 3.
  response[_response].status = init.status;

  // 4.
  response[_response].statusMessage = init.statusText;
  // 5.
  /** @type {Headers} */
  const headers: Headers = response[_headers];
  if (init.headers) {
    fillHeaders(headers, init.headers);
  }

  // 6.
  if (bodyWithType !== null) {
    if (nullBodyStatus(response[_response].status)) {
      throw new TypeError(
        "Response with null body status cannot have body",
      );
    }

    const { body, contentType } = bodyWithType;
    response[_response].body = body;

    if (contentType !== null) {
      let hasContentType = false;
      const list = headerListFromHeaders(headers);
      for (let i = 0; i < list.length; i++) {
        if (byteLowerCase(list[i][0]) === "content-type") {
          hasContentType = true;
          break;
        }
      }
      if (!hasContentType) {
        ArrayPrototypePush(list, ["Content-Type", contentType]);
      }
    }
  }
}

/** This Fetch API export interface represents the response to a request.
 *
 * @category Fetch API
 */
 export interface Response extends Body {

  readonly trailer: Promise<Headers>;
  clone(): Response;

  /** Stores a `Boolean` that declares whether the body has been used in a
   * response yet.
   */
  readonly bodyUsed: boolean;
  /** Takes a `Response` stream and reads it to completion. It returns a promise
   * that resolves with an `ArrayBuffer`.
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Takes a `Response` stream and reads it to completion. It returns a promise
   * that resolves with a `Blob`.
   */
  blob(): Promise<Blob>;
  /** Takes a `Response` stream and reads it to completion. It returns a promise
   * that resolves with a `FormData` object.
   */
  formData(): Promise<FormData>;
  /** Takes a `Response` stream and reads it to completion. It returns a promise
   * that resolves with the result of parsing the body text as JSON.
   */
  json(): Promise<any>;
  /** Takes a `Response` stream and reads it to completion. It returns a promise
   * that resolves with a `USVString` (text).
   */
  text(): Promise<string>;
}

/** This Fetch API export interface represents the response to a request.
 *
 * @category Fetch API
 */
export class Response {
  get [_mimeType]() {
    const values = getDecodeSplitHeader(
      headerListFromHeaders(this[_headers]),
      "Content-Type",
    );
    return extractMimeType(values);
  }

  /** A simple getter used to expose a `ReadableStream` of the body contents. */
  get [_body](): ReadableStream<Uint8Array> | null {
    return this[_response].body;
  }

  static error(): Response {
    const inner = newInnerResponse(0);
    inner.type = "error";
    const response = webidl.createBranded(Response);
    response[_response] = inner;
    response[_headers] = headersFromHeaderList(
      response[_response].headerList,
      "immutable",
    );
    return response;
  }

  static redirect(url: string, status: number = 302): Response {
    const prefix = "Failed to call 'Response.redirect'";
    url = webidl.converters["USVString"](url, {
      prefix,
      context: "Argument 1",
    });
    status = webidl.converters["unsigned short"](status, {
      prefix,
      context: "Argument 2",
    });

    const baseURL = getLocationHref();
    const parsedURL = new URL(url, baseURL);
    if (!redirectStatus(status)) {
      throw new RangeError("Invalid redirect status code.");
    }
    const inner = newInnerResponse(status);
    inner.type = "default";
    ArrayPrototypePush(inner.headerList, ["Location", parsedURL.href]);
    const response = webidl.createBranded(Response);
    response[_response] = inner;
    response[_headers] = headersFromHeaderList(
      response[_response].headerList,
      "immutable",
    );
    return response;
  }

  static json(data: any | undefined = undefined, init: ResponseInit = {}): Response {
    const prefix = "Failed to call 'Response.json'";
    data = webidl.converters.any(data);
    init = webidl.converters["ResponseInit_fast"](init, {
      prefix,
      context: "Argument 2",
    });

    const str = serializeJSValueToJSONString(data);
    const res = extractBody(str);
    res.contentType = "application/json";
    const response = webidl.createBranded(Response);
    response[_response] = newInnerResponse();
    response[_headers] = headersFromHeaderList(
      response[_response].headerList,
      "response",
    );
    initializeAResponse(response, init, res);
    return response;
  }

  constructor(body: BodyInit | null = null, init: ResponseInit = undefined) {
    const prefix = "Failed to construct 'Response'";
    body = webidl.converters["BodyInit_DOMString?"](body, {
      prefix,
      context: "Argument 1",
    });
    init = webidl.converters["ResponseInit_fast"](init, {
      prefix,
      context: "Argument 2",
    });

    this[_response] = newInnerResponse();
    this[_headers] = headersFromHeaderList(
      this[_response].headerList,
      "response",
    );

    let bodyWithType = null;
    if (body !== null) {
      bodyWithType = extractBody(body);
    }
    initializeAResponse(this, init, bodyWithType);
    this[webidl.brand] = webidl.brand;
  }

  get type(): ResponseType {
    webidl.assertBranded(this, ResponsePrototype);
    return this[_response].type;
  }

  get url(): string {
    webidl.assertBranded(this, ResponsePrototype);
    const url = this[_response].url();
    if (url === null) return "";
    const newUrl = new URL(url);
    newUrl.hash = "";
    return newUrl.href;
  }

  get redirected(): boolean {
    webidl.assertBranded(this, ResponsePrototype);
    return this[_response].urlList.length > 1;
  }

  get status(): number {
    webidl.assertBranded(this, ResponsePrototype);
    return this[_response].status;
  }

  get ok(): boolean {
    webidl.assertBranded(this, ResponsePrototype);
    const status = this[_response].status;
    return status >= 200 && status <= 299;
  }

  get statusText(): string {
    webidl.assertBranded(this, ResponsePrototype);
    return this[_response].statusMessage;
  }

  get headers(): Headers {
    webidl.assertBranded(this, ResponsePrototype);
    return this[_headers];
  }

  clone(): Response {
    webidl.assertBranded(this, ResponsePrototype);
    if (this[_body] && this[_body].unusable()) {
      throw new TypeError("Body is unusable.");
    }
    const second = webidl.createBranded(Response);
    const newRes = cloneInnerResponse(this[_response]);
    second[_response] = newRes;
    second[_headers] = headersFromHeaderList(
      newRes.headerList,
      guardFromHeaders(this[_headers]),
    );
    return second;
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(ResponsePrototype, this),
      keys: [
        "body",
        "bodyUsed",
        "headers",
        "ok",
        "redirected",
        "status",
        "statusText",
        "url",
      ],
    }));
  }
}

webidl.configurePrototype(Response);
ObjectDefineProperties(Response, {
  json: { enumerable: true },
  redirect: { enumerable: true },
  error: { enumerable: true },
});
export const ResponsePrototype = Response.prototype;
mixinBody(ResponsePrototype, _body, _mimeType);

webidl.converters["Response"] = webidl.createInterfaceConverter(
  "Response",
  ResponsePrototype,
);
webidl.converters["ResponseInit"] = webidl.createDictionaryConverter(
  "ResponseInit",
  [{
    key: "status",
    defaultValue: 200,
    converter: webidl.converters["unsigned short"],
  }, {
    key: "statusText",
    defaultValue: "",
    converter: webidl.converters["ByteString"],
  }, {
    key: "headers",
    converter: webidl.converters["HeadersInit"],
  }],
);
webidl.converters["ResponseInit_fast"] = function (init, opts) {
  if (init === undefined || init === null) {
    return { status: 200, statusText: "", headers: undefined };
  }
  // Fast path, if not a proxy
  if (typeof init === "object" && !isProxy(init)) {
    // Not a proxy fast path
    const status = init.status !== undefined
      ? webidl.converters["unsigned short"](init.status)
      : 200;
    const statusText = init.statusText !== undefined
      ? webidl.converters["ByteString"](init.statusText)
      : "";
    const headers = init.headers !== undefined
      ? webidl.converters["HeadersInit"](init.headers)
      : undefined;
    return { status, statusText, headers };
  }
  // Slow default path
  return webidl.converters["ResponseInit"](init, opts);
};

export function toInnerResponse(response: Response): InnerResponse {
  return response[_response];
}

export function fromInnerResponse(inner: InnerResponse, guard: "request" | "immutable" | "request-no-cors" | "response" | "none"): Response {
  const response = webidl.createBranded(Response);
  response[_response] = inner;
  response[_headers] = headersFromHeaderList(inner.headerList, guard);
  return response;
}
