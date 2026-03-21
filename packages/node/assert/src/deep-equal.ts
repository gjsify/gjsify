/**
 * Deep equality comparison for Node.js assert module.
 * Ported from Deno's internal/util/comparisons.ts with simplifications:
 * - No primordials (direct JS calls)
 * - No Buffer.compare (byte-by-byte comparison)
 * - No getOwnNonIndexProperties C++ binding (JS approximation)
 * - No kPartial mode (partialDeepStrictEqual not implemented)
 * - No isKeyObject, isCryptoKey, isURL checks
 */

type Memo = {
  set: Set<unknown> | undefined;
  a: unknown;
  b: unknown;
  c: unknown;
  d: unknown;
  deep: boolean;
};

const enum ValueType {
  noIterator,
  isArray,
  isSet,
  isMap,
}

const kStrict = 1;
const kLoose = 0;

// Type detection helpers (single-realm, instanceof is safe)
function isDate(v: unknown): v is Date { return v instanceof Date; }
function isRegExp(v: unknown): v is RegExp { return v instanceof RegExp; }
function isMap(v: unknown): v is Map<unknown, unknown> { return v instanceof Map; }
function isSet(v: unknown): v is Set<unknown> { return v instanceof Set; }
function isError(v: unknown): v is Error { return v instanceof Error; }
function isAnyArrayBuffer(v: unknown): v is ArrayBuffer | SharedArrayBuffer {
  return v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer);
}
function isArrayBufferView(v: unknown): v is ArrayBufferView {
  return ArrayBuffer.isView(v);
}

function isBoxedPrimitive(v: unknown): boolean {
  return v instanceof Number || v instanceof String || v instanceof Boolean ||
    v instanceof BigInt || v instanceof Symbol;
}

function isNumberObject(v: unknown): v is Number { return v instanceof Number; }
function isStringObject(v: unknown): v is String { return v instanceof String; }
function isBooleanObject(v: unknown): v is Boolean { return v instanceof Boolean; }
function isBigIntObject(v: unknown): boolean {
  return typeof BigInt !== 'undefined' && v instanceof Object && Object.prototype.toString.call(v) === '[object BigInt]';
}
function isSymbolObject(v: unknown): boolean {
  return v instanceof Object && Object.prototype.toString.call(v) === '[object Symbol]';
}

function isFloatTypedArray(v: unknown): boolean {
  return v instanceof Float32Array || v instanceof Float64Array;
}

const hasOwn = (obj: unknown, prop: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, prop);
const hasEnumerable = (obj: unknown, prop: PropertyKey) => Object.prototype.propertyIsEnumerable.call(obj, prop);

// Well-known constructors whose prototype check can be replaced with constructor check
const wellKnownConstructors = new Set<Function>([
  Array, ArrayBuffer, Boolean, DataView, Date, Error,
  Float32Array, Float64Array, Function,
  Int8Array, Int16Array, Int32Array,
  Map, Number, Object, Promise, RegExp, Set, String, Symbol,
  Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray,
  BigInt64Array, BigUint64Array,
  WeakMap, WeakSet,
]);

/**
 * Get own non-index properties of an object.
 * JS approximation of the C++ binding used in Node/Deno.
 */
function getOwnNonIndexProperties(obj: object, skipSymbols: boolean): (string | symbol)[] {
  const keys = Object.getOwnPropertyNames(obj);
  const result: (string | symbol)[] = [];

  for (const key of keys) {
    // Skip array indices
    const num = Number(key);
    if (Number.isInteger(num) && num >= 0 && num < 2 ** 32 - 1 && String(num) === key) {
      continue;
    }
    // Only include enumerable properties (matches Node/Deno ONLY_ENUMERABLE behavior)
    if (!hasEnumerable(obj, key)) {
      continue;
    }
    result.push(key);
  }

  if (!skipSymbols) {
    const symbols = Object.getOwnPropertySymbols(obj);
    for (const sym of symbols) {
      if (hasEnumerable(obj, sym)) {
        result.push(sym);
      }
    }
  }

  return result;
}

function areSimilarRegExps(a: RegExp, b: RegExp): boolean {
  return a.source === b.source && a.flags === b.flags && a.lastIndex === b.lastIndex;
}

function areSimilarFloatArrays(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const viewA = a as unknown as ArrayLike<number>;
  const viewB = b as unknown as ArrayLike<number>;
  for (let i = 0; i < (viewA as any).length; i++) {
    if ((viewA as any)[i] !== (viewB as any)[i]) return false;
  }
  return true;
}

function areSimilarTypedArrays(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const viewA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const viewB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
}

function areEqualArrayBuffers(buf1: ArrayBuffer | SharedArrayBuffer, buf2: ArrayBuffer | SharedArrayBuffer): boolean {
  if (buf1.byteLength !== buf2.byteLength) return false;
  const a = new Uint8Array(buf1);
  const b = new Uint8Array(buf2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isEqualBoxedPrimitive(val1: unknown, val2: unknown): boolean {
  if (isNumberObject(val1)) {
    return isNumberObject(val2) && Object.is((val1 as Number).valueOf(), (val2 as Number).valueOf());
  }
  if (isStringObject(val1)) {
    return isStringObject(val2) && (val1 as String).valueOf() === (val2 as String).valueOf();
  }
  if (isBooleanObject(val1)) {
    return isBooleanObject(val2) && (val1 as Boolean).valueOf() === (val2 as Boolean).valueOf();
  }
  if (isBigIntObject(val1)) {
    return isBigIntObject(val2) &&
      (val1 as any)[Symbol.toPrimitive]('number') === (val2 as any)[Symbol.toPrimitive]('number');
  }
  if (isSymbolObject(val1)) {
    return isSymbolObject(val2) &&
      Symbol.prototype.valueOf.call(val1) === Symbol.prototype.valueOf.call(val2);
  }
  return false;
}

function getTypedArrayTag(val: unknown): string | undefined {
  return Object.prototype.toString.call(val).slice(8, -1);
}

function innerDeepEqual(
  val1: unknown,
  val2: unknown,
  mode: number,
  memos: Memo | null | undefined,
): boolean {
  // Identical values
  if (val1 === val2) {
    return val1 !== 0 || Object.is(val1, val2) || mode === kLoose;
  }

  if (mode !== kLoose) {
    // Strict mode
    if (typeof val1 === 'number') {
      // NaN check
      return val1 !== val1 && val2 !== val2;
    }
    if (typeof val2 !== 'object' || typeof val1 !== 'object' || val1 === null || val2 === null) {
      return false;
    }
  } else {
    // Loose mode
    if (val1 === null || typeof val1 !== 'object') {
      return (val2 === null || typeof val2 !== 'object') &&
        // eslint-disable-next-line eqeqeq
        (val1 == val2 || (val1 !== val1 && val2 !== val2));
    }
    if (val2 === null || typeof val2 !== 'object') {
      return false;
    }
  }

  return objectComparisonStart(val1 as object, val2 as object, mode, memos);
}

function objectComparisonStart(
  val1: object,
  val2: object,
  mode: number,
  memos: Memo | null | undefined,
): boolean {
  // In strict mode, check constructors/prototypes
  if (mode === kStrict) {
    if (
      wellKnownConstructors.has(val1.constructor as Function) ||
      (val1.constructor !== undefined && !hasOwn(val1, 'constructor'))
    ) {
      if (val1.constructor !== val2.constructor) {
        return false;
      }
    } else if (Object.getPrototypeOf(val1) !== Object.getPrototypeOf(val2)) {
      return false;
    }
  }

  const val1Tag = Object.prototype.toString.call(val1);
  const val2Tag = Object.prototype.toString.call(val2);

  if (val1Tag !== val2Tag) {
    return false;
  }

  if (Array.isArray(val1)) {
    if (!Array.isArray(val2) || val1.length !== val2.length) {
      return false;
    }
    const keys2 = getOwnNonIndexProperties(val2, mode === kLoose);
    if (keys2.length !== getOwnNonIndexProperties(val1, mode === kLoose).length) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, ValueType.isArray, keys2);
  } else if (val1Tag === '[object Object]') {
    return keyCheck(val1, val2, mode, memos, ValueType.noIterator);
  } else if (isDate(val1)) {
    if (!isDate(val2)) return false;
    const time1 = val1.getTime();
    const time2 = val2.getTime();
    if (time1 !== time2 && !(Number.isNaN(time1) && Number.isNaN(time2))) {
      return false;
    }
  } else if (isRegExp(val1)) {
    if (!isRegExp(val2) || !areSimilarRegExps(val1, val2)) {
      return false;
    }
  } else if (isArrayBufferView(val1)) {
    if (getTypedArrayTag(val1) !== getTypedArrayTag(val2)) {
      return false;
    }
    if (mode === kLoose && isFloatTypedArray(val1)) {
      if (!areSimilarFloatArrays(val1, val2 as ArrayBufferView)) {
        return false;
      }
    } else if (!areSimilarTypedArrays(val1, val2 as ArrayBufferView)) {
      return false;
    }
    const keys2 = getOwnNonIndexProperties(val2, mode === kLoose);
    if (keys2.length !== getOwnNonIndexProperties(val1, mode === kLoose).length) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, ValueType.noIterator, keys2);
  } else if (isSet(val1)) {
    if (!isSet(val2) || val1.size !== val2.size) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, ValueType.isSet);
  } else if (isMap(val1)) {
    if (!isMap(val2) || val1.size !== val2.size) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, ValueType.isMap);
  } else if (isAnyArrayBuffer(val1)) {
    if (!isAnyArrayBuffer(val2) || !areEqualArrayBuffers(val1, val2 as ArrayBuffer)) {
      return false;
    }
  } else if (isError(val1)) {
    if (
      !isError(val2) ||
      val1.message !== val2.message ||
      val1.name !== val2.name
    ) {
      return false;
    }
    // Check cause if it exists
    if (hasOwn(val1, 'cause') !== hasOwn(val2, 'cause')) {
      return false;
    }
    if (hasOwn(val1, 'cause') && !innerDeepEqual((val1 as any).cause, (val2 as any).cause, mode, memos)) {
      return false;
    }
  } else if (isBoxedPrimitive(val1)) {
    if (!isEqualBoxedPrimitive(val1, val2)) {
      return false;
    }
  } else if (
    Array.isArray(val2) || isArrayBufferView(val2) || isSet(val2) || isMap(val2) ||
    isDate(val2) || isRegExp(val2) || isAnyArrayBuffer(val2) || isBoxedPrimitive(val2) ||
    isError(val2)
  ) {
    return false;
  }

  return keyCheck(val1, val2, mode, memos, ValueType.noIterator);
}

function getEnumerables(val: unknown, keys: symbol[]): symbol[] {
  return keys.filter((key) => hasEnumerable(val, key));
}

function keyCheck(
  val1: unknown,
  val2: unknown,
  mode: number,
  memos: Memo | null | undefined,
  iterationType: ValueType,
  keys2?: (string | symbol)[],
): boolean {
  const isArrayLikeObject = keys2 !== undefined;

  if (keys2 === undefined) {
    keys2 = Object.keys(val2 as object);
  }
  let keys1: string[] | undefined;

  if (!isArrayLikeObject) {
    if (keys2.length !== (keys1 = Object.keys(val1 as object)).length) {
      return false;
    } else if (mode === kStrict) {
      // Check symbol keys in strict mode
      const symbolKeysA = Object.getOwnPropertySymbols(val1 as object);
      if (symbolKeysA.length !== 0) {
        let count = 0;
        for (const key of symbolKeysA) {
          if (hasEnumerable(val1, key)) {
            if (!hasEnumerable(val2, key)) return false;
            (keys2 as (string | symbol)[]).push(key);
            count++;
          } else if (hasEnumerable(val2, key)) {
            return false;
          }
        }
        const symbolKeysB = Object.getOwnPropertySymbols(val2 as object);
        if (symbolKeysA.length !== symbolKeysB.length &&
            getEnumerables(val2, symbolKeysB).length !== count) {
          return false;
        }
      } else {
        const symbolKeysB = Object.getOwnPropertySymbols(val2 as object);
        if (symbolKeysB.length !== 0 && getEnumerables(val2, symbolKeysB).length !== 0) {
          return false;
        }
      }
    }
  }

  if (keys2.length === 0 &&
    (iterationType === ValueType.noIterator ||
      (iterationType === ValueType.isArray && (val2 as any[]).length === 0) ||
      (val2 as any).size === 0)) {
    return true;
  }

  if (memos === null) {
    return objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  }
  return handleCycles(val1, val2, mode, keys1, keys2, memos, iterationType);
}

function handleCycles(
  val1: unknown,
  val2: unknown,
  mode: number,
  keys1: string[] | undefined,
  keys2: (string | symbol)[],
  memos: Memo | undefined,
  iterationType: ValueType,
): boolean {
  if (memos === undefined) {
    memos = {
      set: undefined,
      a: val1,
      b: val2,
      c: undefined,
      d: undefined,
      deep: false,
    };
    return objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  }

  if (memos.set === undefined) {
    if (memos.deep === false) {
      if (memos.a === val1) return memos.b === val2;
      if (memos.b === val2) return false;
      memos.c = val1;
      memos.d = val2;
      memos.deep = true;
      const result = objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
      memos.deep = false;
      return result;
    }
    memos.set = new Set();
    memos.set.add(memos.a);
    memos.set.add(memos.b);
    memos.set.add(memos.c);
    memos.set.add(memos.d);
  }

  const { set } = memos;
  const originalSize = set.size;
  set.add(val1);
  set.add(val2);
  if (originalSize !== set.size - 2) {
    return originalSize === set.size;
  }

  const areEq = objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  set.delete(val1);
  set.delete(val2);
  return areEq;
}

function findLooseMatchingPrimitives(prim: unknown): boolean | undefined | null {
  switch (typeof prim) {
    case 'undefined': return null;
    case 'object': return undefined;
    case 'symbol': return false;
    case 'string':
      prim = +prim;
    // falls through
    case 'number':
      if (prim !== prim) return false; // NaN
  }
  return true;
}

function setMightHaveLoosePrim(a: Set<unknown>, b: Set<unknown>, prim: unknown): boolean {
  const altValue = findLooseMatchingPrimitives(prim);
  if (altValue != null) return altValue as boolean;
  return !b.has(altValue) && a.has(altValue);
}

function mapMightHaveLoosePrim(
  a: Map<unknown, unknown>, b: Map<unknown, unknown>,
  prim: unknown, item2: unknown, memo: Memo,
): boolean {
  const altValue = findLooseMatchingPrimitives(prim);
  if (altValue != null) return altValue as boolean;
  const item1 = a.get(altValue);
  if ((item1 === undefined && !a.has(altValue)) || !innerDeepEqual(item1, item2, kLoose, memo)) {
    return false;
  }
  return !b.has(altValue) && innerDeepEqual(item1, item2, kLoose, memo);
}

function setEquiv(a: Set<unknown>, b: Set<unknown>, mode: number, memo: Memo | null): boolean {
  let array: unknown[] | undefined;

  for (const val of b) {
    if (!a.has(val)) {
      if ((typeof val !== 'object' || val === null) &&
          (mode !== kLoose || !setMightHaveLoosePrim(a, b, val))) {
        return false;
      }
      if (array === undefined) array = [];
      array.push(val);
    }
  }

  if (array === undefined) return true;

  for (const val1 of a) {
    if (typeof val1 === 'object' && val1 !== null) {
      if (!b.has(val1)) {
        let found = false;
        for (let i = 0; i < array.length; i++) {
          if (innerDeepEqual(val1, array[i], mode, memo)) {
            array.splice(i, 1);
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    } else if (
      !b.has(val1) &&
      (mode !== kLoose || !setMightHaveLoosePrim(b, a, val1))
    ) {
      let found = false;
      for (let i = 0; i < array.length; i++) {
        if (innerDeepEqual(val1, array[i], mode, memo)) {
          array.splice(i, 1);
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
  }

  return array.length === 0;
}

function mapEquiv(a: Map<unknown, unknown>, b: Map<unknown, unknown>, mode: number, memo: Memo): boolean {
  let array: unknown[] | undefined;

  for (const [key2, item2] of b) {
    if (typeof key2 === 'object' && key2 !== null) {
      if (array === undefined) {
        if (a.size === 1) {
          const [key1, item1] = a.entries().next().value!;
          return innerDeepEqual(key1, key2, mode, memo) && innerDeepEqual(item1, item2, mode, memo);
        }
        array = [];
      }
      array.push(key2);
    } else {
      const item1 = a.get(key2);
      if ((item1 === undefined && !a.has(key2)) || !innerDeepEqual(item1, item2, mode, memo)) {
        if (mode !== kLoose) return false;
        if (!mapMightHaveLoosePrim(a, b, key2, item2, memo)) return false;
        if (array === undefined) array = [];
        array.push(key2);
      }
    }
  }

  if (array === undefined) return true;

  for (const [key1, item1] of a) {
    if (typeof key1 === 'object' && key1 !== null) {
      if (!b.has(key1)) {
        let found = false;
        for (let i = 0; i < array.length; i++) {
          const key2 = array[i];
          if (innerDeepEqual(key1, key2, mode, memo) && innerDeepEqual(item1, b.get(key2), mode, memo)) {
            array.splice(i, 1);
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    } else if (
      mode === kLoose && typeof key1 !== 'object' &&
      (!a.has(key1) || !innerDeepEqual(item1, a.get(key1), mode, memo))
    ) {
      // Loose mode primitive key mismatch handled above
    }
  }

  return array.length === 0;
}

function objEquiv(
  a: unknown,
  b: unknown,
  mode: number,
  keys1: string[] | undefined,
  keys2: (string | symbol)[],
  memos: Memo | null,
  iterationType: ValueType,
): boolean {
  if (keys2.length > 0) {
    let i = 0;
    if (keys1 !== undefined) {
      for (; i < keys2.length; i++) {
        const key = keys2[i];
        if (keys1[i] !== key) break;
        if (!innerDeepEqual((a as any)[key], (b as any)[key], mode, memos)) return false;
      }
    }
    for (; i < keys2.length; i++) {
      const key = keys2[i];
      const descriptor = Object.getOwnPropertyDescriptor(a, key);
      if (!descriptor?.enumerable ||
          !innerDeepEqual(
            descriptor.value !== undefined ? descriptor.value : (a as any)[key],
            (b as any)[key], mode, memos)) {
        return false;
      }
    }
  }

  if (iterationType === ValueType.isArray) {
    for (let i = 0; i < (a as any[]).length; i++) {
      if ((b as any)[i] === undefined && !hasOwn(b as object, i)) {
        // Sparse array
        if ((a as any)[i] !== undefined || hasOwn(a as object, i)) return false;
        continue;
      }
      if (mode !== kLoose && (a as any)[i] === undefined && !hasOwn(a as object, i)) {
        return false;
      }
      if (!innerDeepEqual((a as any)[i], (b as any)[i], mode, memos)) return false;
    }
  } else if (iterationType === ValueType.isSet) {
    if (!setEquiv(a as Set<unknown>, b as Set<unknown>, mode, memos)) return false;
  } else if (iterationType === ValueType.isMap) {
    if (!mapEquiv(a as Map<unknown, unknown>, b as Map<unknown, unknown>, mode, memos as Memo)) return false;
  }

  return true;
}

// Cycle detection: start without memos, enable on stack overflow
let detectCycles = function (val1: unknown, val2: unknown, mode: number): boolean {
  try {
    return innerDeepEqual(val1, val2, mode, null);
  } catch {
    detectCycles = innerDeepEqual as any;
    return innerDeepEqual(val1, val2, mode, undefined);
  }
};

export function isDeepEqual(val1: unknown, val2: unknown): boolean {
  return detectCycles(val1, val2, kLoose);
}

export function isDeepStrictEqual(val1: unknown, val2: unknown): boolean {
  return detectCycles(val1, val2, kStrict);
}
