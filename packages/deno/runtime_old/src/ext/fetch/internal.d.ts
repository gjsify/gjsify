// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/internal.d.ts

// deno-lint-ignore-file no-explicit-any no-var

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

// export var fetchUtil: {
//   requiredArguments(name: string, length: number, required: number): void;
// };

// export var domIterable: {
//   DomIterableMixin(base: any, dataSymbol: symbol): any;
// };

import type { FormDataEntry } from './21_formdata.js';
import type { InnerRequest } from './23_request.js';
import type { InnerResponse } from './23_response';
import type { InnerBody } from '../fetch/22_body.js';

export namespace headers {
  class Headers {
  }
  export type HeaderList = [string, string][];

  function headersFromHeaderList(
    list: HeaderList,
    guard:
      | "immutable"
      | "request"
      | "request-no-cors"
      | "response"
      | "none",
  ): Headers;

  function headerListFromHeaders(headers: Headers): HeaderList;
  function fillHeaders(headers: Headers, object: HeadersInit): void;
  function getDecodeSplitHeader(
    list: HeaderList,
    name: string,
  ): string[] | null;
  function guardFromHeaders(
    headers: Headers,
  ): "immutable" | "request" | "request-no-cors" | "response" | "none";
}

export namespace formData {
  export type FormData = typeof FormData;
  export function formDataToBlob(
    formData: globalThis.FormData,
  ): Blob;
  export function parseFormData(
    body: Uint8Array,
    boundary: string | undefined,
  ): FormData;
  export function formDataFromEntries(entries: FormDataEntry[]): FormData;
}

export namespace fetchBody {
  function mixinBody(
    prototype: any,
    bodySymbol: symbol,
    mimeTypeSymbol: symbol,
  ): void;
  class InnerBody {
    constructor(stream?: ReadableStream<Uint8Array>);
    stream: ReadableStream<Uint8Array>;
    source: null | Uint8Array | Blob | FormData;
    length: null | number;
    unusable(): boolean;
    consume(): Promise<Uint8Array>;
    clone(): InnerBody;
  }
  function extractBody(object: BodyInit): {
    body: InnerBody;
    contentType: string | null;
  };
}

export namespace fetch {
  function toInnerRequest(request: Request): InnerRequest;
  function fromInnerRequest(
    inner: InnerRequest,
    signal: AbortSignal | null,
    guard:
      | "request"
      | "immutable"
      | "request-no-cors"
      | "response"
      | "none",
  ): Request;
  function redirectStatus(status: number): boolean;
  function nullBodyStatus(status: number): boolean;
  function newInnerRequest(
    method: string,
    url: any,
    headerList?: [string, string][],
    body?: InnerBody,
  ): InnerResponse;
  function toInnerResponse(response: Response): InnerResponse;
  function fromInnerResponse(
    inner: InnerResponse,
    guard:
      | "request"
      | "immutable"
      | "request-no-cors"
      | "response"
      | "none",
  ): Response;
  function networkError(error: string): InnerResponse;
}
