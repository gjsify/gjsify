// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent, Inc. and Node.js contributors. All rights reserved. MIT license.

// import { digestAlgorithms } from "../../../crypto/_wasm_crypto/mod.js";
import { getCiphers } from "./crypto_browserify/browserify_aes/mod.js";
import { notImplemented, warnNotImplemented } from "@gjsify/utils";
import { Buffer } from "buffer";
import { ERR_INVALID_ARG_TYPE, hideStackFrames } from "../errors.js";
import { isAnyArrayBuffer, isArrayBufferView } from "../util/types.js";
import { crypto as constants } from "../internal_binding/constants.js";
import { kHandle, kKeyObject } from "./constants.js";

let defaultEncoding = "buffer";

export function setDefaultEncoding(val: string) {
  defaultEncoding = val;
}

export function getDefaultEncoding(): string {
  return defaultEncoding;
}

// This is here because many functions accepted binary strings without
// any explicit encoding in older versions of node, and we don't want
// to break them unnecessarily.
export function toBuf(val: string | Buffer, encoding?: BufferEncoding | 'buffer'): Buffer {
  if (typeof val === "string") {
    if (encoding === "buffer") {
      encoding = "utf8";
    }

    return Buffer.from(val, encoding);
  }

  return val;
}

export const validateByteSource = hideStackFrames((val, name) => {
  val = toBuf(val);

  if (isAnyArrayBuffer(val) || isArrayBufferView(val)) {
    return;
  }

  throw new ERR_INVALID_ARG_TYPE(
    name,
    ["string", "ArrayBuffer", "TypedArray", "DataView", "Buffer"],
    val,
  );
});

/**
 * Returns an array of the names of the supported hash algorithms, such as 'sha1'.
 */
export function getHashes(): readonly string[] {
  warnNotImplemented("crypto.getHashes");
  // TODO: https://github.com/denoland/deno_std/blob/main/crypto/_wasm_crypto/mod.ts
  return [];
}

export function getCurves(): readonly string[] {
  notImplemented("crypto.getCurves");
}

export interface SecureHeapUsage {
  total: number;
  min: number;
  used: number;
  utilization: number;
}

export function secureHeapUsed(): SecureHeapUsage {
  notImplemented("crypto.secureHeapUsed");
}

export function setEngine(_engine: string, _flags: typeof constants) {
  notImplemented("crypto.setEngine");
}

export { getCiphers, kHandle, kKeyObject };

export default {
  getDefaultEncoding,
  getHashes,
  setDefaultEncoding,
  getCiphers,
  getCurves,
  secureHeapUsed,
  setEngine,
  validateByteSource,
  toBuf,
  kHandle,
  kKeyObject,
};
