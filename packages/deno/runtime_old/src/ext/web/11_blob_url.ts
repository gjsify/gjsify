// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/11_blob_url.js

// @ts-check
// <reference no-default-lib="true" />
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../webidl/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />
// <reference path="../url/internal.d.ts" />
// <reference path="../url/lib.deno_url.d.ts" />
// <reference path="./internal.d.ts" />
// <reference lib="esnext" />
"use strict";

import * as ops from '../../ops/index.js';
import * as webidl from '../webidl/00_webidl.js';
import { getParts, Blob } from './09_file.js';
import { URL } from '../url/00_url.js';

export function createObjectURL(blob: Blob): string {
  const prefix = "Failed to execute 'createObjectURL' on 'URL'";
  webidl.requiredArguments(arguments.length, 1, { prefix });
  blob = webidl.converters["Blob"](blob, {
    context: "Argument 1",
    prefix,
  });

  const url = ops.op_blob_create_object_url(
    blob.type,
    getParts(blob),
  );

  return url;
}

export function revokeObjectURL(url: string): void {
  const prefix = "Failed to execute 'revokeObjectURL' on 'URL'";
  webidl.requiredArguments(arguments.length, 1, { prefix });
  url = webidl.converters["DOMString"](url, {
    context: "Argument 1",
    prefix,
  });

  ops.op_blob_revoke_object_url(url);
}

URL.createObjectURL = createObjectURL;
URL.revokeObjectURL = revokeObjectURL;
