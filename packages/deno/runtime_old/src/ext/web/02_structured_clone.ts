// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/02_structured_clone.js

// @ts-check
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../../core/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import { DOMException } from './01_dom_exception.js';
const {
  ArrayBuffer,
  ArrayBufferPrototype,
  ArrayBufferIsView,
  DataViewPrototype,
  ObjectPrototypeIsPrototypeOf,
  TypedArrayPrototypeSlice,
  TypeErrorPrototype,
  WeakMap,
  WeakMapPrototypeSet,
} = primordials;

const objectCloneMemo = new WeakMap();

function cloneArrayBuffer(
  srcBuffer,
  srcByteOffset,
  srcLength,
  _cloneConstructor,
) {
  // this function fudges the return type but SharedArrayBuffer is disabled for a while anyway
  return TypedArrayPrototypeSlice(
    srcBuffer,
    srcByteOffset,
    srcByteOffset + srcLength,
  );
}

// TODO see also packages/deno/runtime/src/ext/web/13_message_port.ts
/** Clone a value in a similar way to structured cloning.  It is similar to a
 * StructureDeserialize(StructuredSerialize(...)). */
export function structuredClone(value: any) {
  // Performance optimization for buffers, otherwise
  // `serialize/deserialize` will allocate new buffer.
  if (ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, value)) {
    const cloned = cloneArrayBuffer(
      value,
      0,
      value.byteLength,
      ArrayBuffer,
    );
    WeakMapPrototypeSet(objectCloneMemo, value, cloned);
    return cloned;
  }
  if (ArrayBufferIsView(value)) {
    const clonedBuffer = structuredClone(value.buffer);
    // Use DataViewConstructor type purely for type-checking, can be a
    // DataView or TypedArray.  They use the same constructor signature,
    // only DataView has a length in bytes and TypedArrays use a length in
    // terms of elements, so we adjust for that.
    let length;
    if (ObjectPrototypeIsPrototypeOf(DataViewPrototype, value)) { // TODO view?
      length = value.byteLength;
    } else {
      length = (value as any).length;
    }
    return new ( (value as any).constructor)(
      clonedBuffer,
      value.byteOffset,
      length,
    );
  }

  try {
    return core.deserialize(core.serialize(value));
  } catch (e) {
    if (ObjectPrototypeIsPrototypeOf(TypeErrorPrototype, e)) {
      throw new DOMException(e.message, "DataCloneError");
    }
    throw e;
  }
}
