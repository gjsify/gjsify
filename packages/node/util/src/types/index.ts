// SPDX-License-Identifier: MIT
// Adapted from Node.js (refs/node/lib/internal/util/types.js) and Deno (refs/deno/ext/node/polyfills/internal/util/types.ts)
// Copyright (c) Node.js contributors. MIT license.
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Modifications: Uses prototype-method-detection instead of V8 C++ bindings, no primordials

// Cached prototype methods and getters for type detection
const _toString = Object.prototype.toString;
const _bigIntValueOf = BigInt.prototype.valueOf;
const _booleanValueOf = Boolean.prototype.valueOf;
const _dateValueOf = Date.prototype.valueOf;
const _numberValueOf = Number.prototype.valueOf;
const _stringValueOf = String.prototype.valueOf;
const _symbolValueOf = Symbol.prototype.valueOf;
const _weakMapHas = WeakMap.prototype.has;
const _weakSetHas = WeakSet.prototype.has;

const _getArrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;

const _getSharedArrayBufferByteLength = typeof SharedArrayBuffer !== 'undefined'
  ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get!
  : undefined;

const _getTypedArrayToStringTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array).prototype,
  Symbol.toStringTag,
)!.get!;

const _getSetSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const _getMapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;

function isObjectLike(value: unknown): value is Record<string | number | symbol, unknown> {
  return value !== null && typeof value === "object";
}

// --- ArrayBuffer / SharedArrayBuffer ---

export function isAnyArrayBuffer(value: unknown): value is ArrayBuffer | SharedArrayBuffer {
  return isArrayBuffer(value) || isSharedArrayBuffer(value);
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  try {
    _getArrayBufferByteLength.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  if (_getSharedArrayBufferByteLength === undefined) return false;
  try {
    _getSharedArrayBufferByteLength.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isArrayBufferView(
  value: unknown,
): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

// --- TypedArray checks ---

export function isTypedArray(value: unknown): boolean {
  return _getTypedArrayToStringTag.call(value) !== undefined;
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return _getTypedArrayToStringTag.call(value) === "Uint8Array";
}

export function isUint8ClampedArray(value: unknown): value is Uint8ClampedArray {
  return _getTypedArrayToStringTag.call(value) === "Uint8ClampedArray";
}

export function isUint16Array(value: unknown): value is Uint16Array {
  return _getTypedArrayToStringTag.call(value) === "Uint16Array";
}

export function isUint32Array(value: unknown): value is Uint32Array {
  return _getTypedArrayToStringTag.call(value) === "Uint32Array";
}

export function isInt8Array(value: unknown): value is Int8Array {
  return _getTypedArrayToStringTag.call(value) === "Int8Array";
}

export function isInt16Array(value: unknown): value is Int16Array {
  return _getTypedArrayToStringTag.call(value) === "Int16Array";
}

export function isInt32Array(value: unknown): value is Int32Array {
  return _getTypedArrayToStringTag.call(value) === "Int32Array";
}

export function isFloat32Array(value: unknown): value is Float32Array {
  return _getTypedArrayToStringTag.call(value) === "Float32Array";
}

export function isFloat64Array(value: unknown): value is Float64Array {
  return _getTypedArrayToStringTag.call(value) === "Float64Array";
}

export function isBigInt64Array(value: unknown): value is BigInt64Array {
  return _getTypedArrayToStringTag.call(value) === "BigInt64Array";
}

export function isBigUint64Array(value: unknown): value is BigUint64Array {
  return _getTypedArrayToStringTag.call(value) === "BigUint64Array";
}

export function isDataView(value: unknown): value is DataView {
  return ArrayBuffer.isView(value) && _getTypedArrayToStringTag.call(value) === undefined;
}

// --- Collection checks ---

export function isMap(value: unknown): value is Map<unknown, unknown> {
  try {
    _getMapSize.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isSet(value: unknown): value is Set<unknown> {
  try {
    _getSetSize.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isWeakMap(value: unknown): value is WeakMap<WeakKey, unknown> {
  try {
    _weakMapHas.call(value, null as any);
    return true;
  } catch {
    return false;
  }
}

export function isWeakSet(value: unknown): value is WeakSet<WeakKey> {
  try {
    _weakSetHas.call(value, null as any);
    return true;
  } catch {
    return false;
  }
}

export function isMapIterator(value: unknown): boolean {
  return isObjectLike(value) && value[Symbol.toStringTag] === "Map Iterator";
}

export function isSetIterator(value: unknown): boolean {
  return isObjectLike(value) && value[Symbol.toStringTag] === "Set Iterator";
}

// --- Date / RegExp / Error ---

export function isDate(value: unknown): value is Date {
  try {
    _dateValueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isRegExp(value: unknown): value is RegExp {
  return (
    isObjectLike(value) &&
    value[Symbol.toStringTag] === undefined &&
    _toString.call(value) === "[object RegExp]"
  );
}

export function isNativeError(value: unknown): value is Error {
  return (
    isObjectLike(value) &&
    value[Symbol.toStringTag] === undefined &&
    _toString.call(value) === "[object Error]"
  );
}

// --- Function checks ---

export function isAsyncFunction(value: unknown): boolean {
  return typeof value === "function" && (value as any)[Symbol.toStringTag] === "AsyncFunction";
}

export function isGeneratorFunction(value: unknown): value is GeneratorFunction {
  return typeof value === "function" && (value as any)[Symbol.toStringTag] === "GeneratorFunction";
}

export function isGeneratorObject(value: unknown): value is Generator {
  return isObjectLike(value) && value[Symbol.toStringTag] === "Generator";
}

// --- Promise ---

export function isPromise(value: unknown): value is Promise<unknown> {
  return isObjectLike(value) && value[Symbol.toStringTag] === "Promise";
}

// --- Boxed primitives ---

export function isBooleanObject(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  try {
    _booleanValueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isNumberObject(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  try {
    _numberValueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isStringObject(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  try {
    _stringValueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isSymbolObject(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  try {
    _symbolValueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isBigIntObject(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  try {
    _bigIntValueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

export function isBoxedPrimitive(value: unknown): boolean {
  return (
    isBooleanObject(value) ||
    isStringObject(value) ||
    isNumberObject(value) ||
    isSymbolObject(value) ||
    isBigIntObject(value)
  );
}

// --- Arguments ---

export function isArgumentsObject(value: unknown): value is IArguments {
  return (
    isObjectLike(value) &&
    value[Symbol.toStringTag] === undefined &&
    _toString.call(value) === "[object Arguments]"
  );
}

// --- Module namespace ---

export function isModuleNamespaceObject(value: unknown): boolean {
  return isObjectLike(value) && value[Symbol.toStringTag] === "Module";
}

// --- Proxy ---
// Cannot be detected in pure JavaScript (requires runtime-specific binding).
// Always returns false. This matches the limitation of all non-V8/Deno runtimes.
export function isProxy(value: unknown): boolean {
  return false;
}

// --- Crypto (stubs for compatibility) ---

export function isCryptoKey(value: unknown): boolean {
  return isObjectLike(value) && _toString.call(value) === "[object CryptoKey]";
}

export function isKeyObject(value: unknown): boolean {
  return false;
}

// Default export with all functions
const types = {
  isAnyArrayBuffer,
  isArrayBuffer,
  isArrayBufferView,
  isArgumentsObject,
  isAsyncFunction,
  isBigInt64Array,
  isBigUint64Array,
  isBigIntObject,
  isBooleanObject,
  isBoxedPrimitive,
  isCryptoKey,
  isDataView,
  isDate,
  isFloat32Array,
  isFloat64Array,
  isGeneratorFunction,
  isGeneratorObject,
  isInt8Array,
  isInt16Array,
  isInt32Array,
  isKeyObject,
  isMap,
  isMapIterator,
  isModuleNamespaceObject,
  isNativeError,
  isNumberObject,
  isPromise,
  isProxy,
  isRegExp,
  isSet,
  isSetIterator,
  isSharedArrayBuffer,
  isStringObject,
  isSymbolObject,
  isTypedArray,
  isUint8Array,
  isUint8ClampedArray,
  isUint16Array,
  isUint32Array,
  isWeakMap,
  isWeakSet,
};

export default types;
