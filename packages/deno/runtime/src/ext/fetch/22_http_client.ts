// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/22_http_client.js

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

import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';

import type { CreateHttpClientOptions } from '../../types/index.js';

export function createHttpClient(options: CreateHttpClientOptions): HttpClient {
  options.caCerts ??= [];
  return new HttpClient(
    ops.op_fetch_custom_client(
      options,
    ),
  );
}

export class HttpClient {
  rid: number;
  constructor(rid: number) {
    this.rid = rid;
  }
  close() {
    core.close(this.rid);
  }
}

export const HttpClientPrototype = HttpClient.prototype;
