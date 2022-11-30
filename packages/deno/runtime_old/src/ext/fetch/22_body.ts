// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/22_body.js

// @ts-check
// <reference path="../webidl/internal.d.ts" />
// <reference path="../url/internal.d.ts" />
// <reference path="../url/lib.deno_url.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="../web/06_streams_types.d.ts" />
// <reference path="./lib.deno_fetch.d.ts" />
// <reference lib="esnext" />
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as webidl from '../webidl/00_webidl.js';
import { parseUrlEncoded, URLSearchParamsPrototype } from '../url/00_url.js';
import {
  parseFormData,
  formDataFromEntries,
  formDataToBlob,
  FormDataPrototype,
  FormData,
} from './21_formdata.js';
import * as mimesniff from '../web/01_mimesniff.js';
import { MimeType } from '../web/01_mimesniff.js';
import { BlobPrototype, Blob } from '../web/09_file.js';

import {
  isReadableStreamDisturbed,
  errorReadableStream,
  readableStreamClose,
  readableStreamDisturb,
  readableStreamCollectIntoUint8Array,
  readableStreamThrowIfErrored,
  createProxy,
  ReadableStreamPrototype,
  ReadableStream,
} from '../web/06_streams.js';

import type { BodyInit } from './lib.deno_fetch.js';

const {
  ArrayBufferPrototype,
  ArrayBufferIsView,
  ArrayPrototypeMap,
  JSONParse,
  ObjectDefineProperties,
  ObjectPrototypeIsPrototypeOf,
  TypedArrayPrototypeSlice,
  TypeError,
  Uint8Array,
  Uint8ArrayPrototype,
} = primordials;

function chunkToU8(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === "string" ? core.encode(chunk) : chunk;
}

function chunkToString(chunk: Uint8Array | string): string {
  return typeof chunk === "string" ? chunk : core.decode(chunk);
}

export type InnerBodyStatic = { body: Uint8Array | string, consumed: boolean }

export class InnerBody {

  streamOrStatic: ReadableStream<Uint8Array> | InnerBodyStatic;
  source: null | Uint8Array | string | Blob | FormData = null;
  length: number | null = null;

  constructor(stream: ReadableStream<Uint8Array> | InnerBodyStatic) {
    this.streamOrStatic = stream ??
      { body: new Uint8Array(), consumed: false };
    this.source = null;
    this.length = null;
  }

  get stream() {
    if (
      !ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      const { body, consumed } = (this.streamOrStatic as { body: string | Uint8Array; consumed: boolean;} );
      if (consumed) {
        this.streamOrStatic = new ReadableStream();
        this.streamOrStatic.getReader();
        readableStreamDisturb(this.streamOrStatic as ReadableStream);
        readableStreamClose(this.streamOrStatic as ReadableStream);
      } else {
        this.streamOrStatic = new ReadableStream({
          start(controller) {
            controller.enqueue(chunkToU8(body));
            controller.close();
          },
        });
      }
    }
    return this.streamOrStatic;
  }

  /**
   * https://fetch.spec.whatwg.org/#body-unusable
   */
  unusable(): boolean {
    if (
      ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      return (this.streamOrStatic as ReadableStream).locked ||
        isReadableStreamDisturbed(this.streamOrStatic as ReadableStream);
    }
    return (this.streamOrStatic as InnerBodyStatic).consumed;
  }

  consumed(): boolean {
    if (
      ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      return isReadableStreamDisturbed(this.streamOrStatic as ReadableStream);
    }
    return (this.streamOrStatic as InnerBodyStatic).consumed;
  }

  /**
   * https://fetch.spec.whatwg.org/#concept-body-consume-body
   */
  async consume(): Promise<Uint8Array> {
    if (this.unusable()) throw new TypeError("Body already consumed.");
    if (
      ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      readableStreamThrowIfErrored(this.stream as ReadableStream);
      return readableStreamCollectIntoUint8Array(this.stream);
    } else {
      (this.streamOrStatic as InnerBodyStatic).consumed = true;
      return (this.streamOrStatic as InnerBodyStatic).body as Uint8Array;
    }
  }

  cancel(error) {
    if (
      ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      (this.streamOrStatic as ReadableStream).cancel(error);
    } else {
      (this.streamOrStatic as InnerBodyStatic).consumed = true;
    }
  }

  error(error) {
    if (
      ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      errorReadableStream(this.streamOrStatic, error);
    } else {
      (this.streamOrStatic as InnerBodyStatic).consumed = true;
    }
  }

  clone(): InnerBody {
    const [out1, out2] = (this.stream as ReadableStream).tee();
    this.streamOrStatic = out1;
    const second = new InnerBody(out2);
    second.source = core.deserialize(core.serialize(this.source));
    second.length = this.length;
    return second;
  }

  createProxy(): InnerBody {
    let proxyStreamOrStatic;
    if (
      ObjectPrototypeIsPrototypeOf(
        ReadableStreamPrototype,
        this.streamOrStatic,
      )
    ) {
      proxyStreamOrStatic = createProxy(this.streamOrStatic as ReadableStream);
    } else {
      proxyStreamOrStatic = { ...this.streamOrStatic };
      (this.streamOrStatic as InnerBodyStatic).consumed = true;
    }
    const proxy = new InnerBody(proxyStreamOrStatic);
    proxy.source = this.source;
    proxy.length = this.length;
    return proxy;
  }
}

export function mixinBody(prototype: any, bodySymbol: symbol, mimeTypeSymbol: symbol): void {
  async function consumeBody(object, type) {
    webidl.assertBranded(object, prototype);

    const body = object[bodySymbol] !== null
      ? await object[bodySymbol].consume()
      : new Uint8Array();

    const mimeType = type === "Blob" || type === "FormData"
      ? object[mimeTypeSymbol]
      : null;
    return packageData(body, type, mimeType);
  }

  const mixin: PropertyDescriptorMap = {
    body: {
      get(): ReadableStream<Uint8Array> | null {
        webidl.assertBranded(this, prototype);
        if (this[bodySymbol] === null) {
          return null;
        } else {
          return this[bodySymbol].stream;
        }
      },
      configurable: true,
      enumerable: true,
    },
    bodyUsed: {
      get(): boolean {
        webidl.assertBranded(this, prototype);
        if (this[bodySymbol] !== null) {
          return this[bodySymbol].consumed();
        }
        return false;
      },
      configurable: true,
      enumerable: true,
    },
    arrayBuffer: {
      value: function arrayBuffer(): Promise<ArrayBuffer> {
        return consumeBody(this, "ArrayBuffer");
      },
      writable: true,
      configurable: true,
      enumerable: true,
    },
    blob: {
      value: function blob(): Promise<Blob> {
        return consumeBody(this, "Blob");
      },
      writable: true,
      configurable: true,
      enumerable: true,
    },
    formData: {
      value: function formData(): Promise<FormData> {
        return consumeBody(this, "FormData");
      },
      writable: true,
      configurable: true,
      enumerable: true,
    },
    json: {
      value: function json(): Promise<any> {
        return consumeBody(this, "JSON");
      },
      writable: true,
      configurable: true,
      enumerable: true,
    },
    text: {
      value: function text(): Promise<string> {
        return consumeBody(this, "text");
      },
      writable: true,
      configurable: true,
      enumerable: true,
    },
  };
  return ObjectDefineProperties(prototype, mixin);
}

/**
 * https://fetch.spec.whatwg.org/#concept-body-package-data
 */
function packageData(bytes: Uint8Array | string, type: "ArrayBuffer" | "Blob" | "FormData" | "JSON" | "text", mimeType: MimeType | null) {
  switch (type) {
    case "ArrayBuffer":
      return chunkToU8(bytes).buffer;
    case "Blob":
      return new Blob([bytes], {
        type: mimeType !== null ? mimesniff.serializeMimeType(mimeType) : "",
      });
    case "FormData": {
      if (mimeType !== null) {
        const essence = mimesniff.essence(mimeType);
        if (essence === "multipart/form-data") {
          const boundary = mimeType.parameters.get("boundary");
          if (boundary === null) {
            throw new TypeError(
              "Missing boundary parameter in mime type of multipart formdata.",
            );
          }
          return parseFormData(chunkToU8(bytes), boundary);
        } else if (essence === "application/x-www-form-urlencoded") {
          // TODO(@AaronO): pass as-is with StringOrBuffer in op-layer
          const entries = parseUrlEncoded(chunkToU8(bytes));
          return formDataFromEntries(
            // @ts-ignore
            ArrayPrototypeMap(
              entries,
              (x) => ({ name: x[0], value: x[1] }),
            ),
          );
        }
        throw new TypeError("Body can not be decoded as form data");
      }
      throw new TypeError("Missing content type");
    }
    case "JSON":
      return JSONParse(chunkToString(bytes));
    case "text":
      return chunkToString(bytes);
  }
}

export function extractBody(object: BodyInit): {body: InnerBody, contentType: string | null} {
  let stream: ReadableStream<Uint8Array> | { body: Uint8Array | string, consumed: boolean };
  let source = null;
  let length = null;
  let contentType = null;
  if (typeof object === "string") {
    source = object;
    contentType = "text/plain;charset=UTF-8";
  } else if (ObjectPrototypeIsPrototypeOf(BlobPrototype, object)) {
    stream = (object as Blob).stream() as any as ReadableStream<Uint8Array>;
    source = object;
    length = (object as Blob).size;
    if ((object as Blob).type.length !== 0) {
      contentType = (object as Blob).type;
    }
  } else if (ObjectPrototypeIsPrototypeOf(Uint8ArrayPrototype, object)) {
    // Fast(er) path for common case of Uint8Array
    const copy = TypedArrayPrototypeSlice(object, 0, (object as Uint8Array).byteLength);
    source = copy;
  } else if (
    ArrayBufferIsView(object) ||
    ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, object)
  ) {
    const u8 = ArrayBufferIsView(object)
      ? new Uint8Array(
        object.buffer,
        object.byteOffset,
        object.byteLength,
      )
      : new Uint8Array(object as ArrayBuffer);
    const copy = TypedArrayPrototypeSlice(u8, 0, u8.byteLength);
    source = copy;
  } else if (ObjectPrototypeIsPrototypeOf(FormDataPrototype, object)) {
    const res = formDataToBlob(object as FormData);
    stream = res.stream();
    source = res;
    length = res.size;
    contentType = res.type;
  } else if (
    ObjectPrototypeIsPrototypeOf(URLSearchParamsPrototype, object)
  ) {
    // TODO(@satyarohith): not sure what primordial here.
    source = object.toString();
    contentType = "application/x-www-form-urlencoded;charset=UTF-8";
  } else if (ObjectPrototypeIsPrototypeOf(ReadableStreamPrototype, object)) {
    stream = object as ReadableStream;
    if ((object as ReadableStream).locked || isReadableStreamDisturbed(object as ReadableStream)) {
      throw new TypeError("ReadableStream is locked or disturbed");
    }
  }
  if (typeof source === "string") {
    // WARNING: this deviates from spec (expects length to be set)
    // https://fetch.spec.whatwg.org/#bodyinit > 7.
    // no observable side-effect for users so far, but could change
    stream = { body: source, consumed: false };
    length = null; // NOTE: string length != byte length
  } else if (ObjectPrototypeIsPrototypeOf(Uint8ArrayPrototype, source)) {
    stream = { body: source, consumed: false };
    length = source.byteLength;
  }
  const body = new InnerBody(stream);
  body.source = source;
  body.length = length;
  return { body, contentType };
}

webidl.converters["BodyInit_DOMString"] = (V, opts) => {
  // Union for (ReadableStream or Blob or ArrayBufferView or ArrayBuffer or FormData or URLSearchParams or USVString)
  if (ObjectPrototypeIsPrototypeOf(ReadableStreamPrototype, V)) {
    return webidl.converters["ReadableStream"](V, opts);
  } else if (ObjectPrototypeIsPrototypeOf(BlobPrototype, V)) {
    return webidl.converters["Blob"](V, opts);
  } else if (ObjectPrototypeIsPrototypeOf(FormDataPrototype, V)) {
    return webidl.converters["FormData"](V, opts);
  } else if (ObjectPrototypeIsPrototypeOf(URLSearchParamsPrototype, V)) {
    return webidl.converters["URLSearchParams"](V, opts);
  }
  if (typeof V === "object") {
    if (
      ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, V) ||
      ObjectPrototypeIsPrototypeOf(SharedArrayBuffer.prototype, V)
    ) {
      return webidl.converters["ArrayBuffer"](V, opts);
    }
    if (ArrayBufferIsView(V)) {
      return webidl.converters["ArrayBufferView"](V, opts);
    }
  }
  // BodyInit conversion is passed to extractBody(), which calls core.encode().
  // core.encode() will UTF-8 encode strings with replacement, being equivalent to the USV normalization.
  // Therefore we can convert to DOMString instead of USVString and avoid a costly redundant conversion.
  return webidl.converters["DOMString"](V, opts);
};
webidl.converters["BodyInit_DOMString?"] = webidl.createNullableConverter(
  webidl.converters["BodyInit_DOMString"],
);


