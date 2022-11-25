// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on
// - https://github.com/denoland/deno/blob/main/ext/webidl/00_WebIDL.js
// - https://github.com/denoland/deno/blob/main/ext/webidl/internal.d.ts

// Adapted from https://github.com/jsdom/webidl-conversions.
// Copyright Domenic Denicola. Licensed under BSD-2-Clause License.
// Original license at https://github.com/jsdom/webidl-conversions/blob/master/LICENSE.md.

// <reference path="../../core/internal.d.ts" />

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import type { webidl } from '../../types/index.js';

const {
  ArrayBufferPrototype,
  ArrayBufferIsView,
  ArrayPrototypeForEach,
  ArrayPrototypePush,
  ArrayPrototypeSort,
  ArrayIteratorPrototype,
  BigInt,
  BigIntAsIntN,
  BigIntAsUintN,
  Float32Array,
  Float64Array,
  FunctionPrototypeBind,
  Int16Array,
  Int32Array,
  Int8Array,
  isNaN,
  MathFloor,
  MathFround,
  MathMax,
  MathMin,
  MathPow,
  MathRound,
  MathTrunc,
  Number,
  NumberIsFinite,
  NumberIsNaN,
  // deno-lint-ignore camelcase
  NumberMAX_SAFE_INTEGER,
  // deno-lint-ignore camelcase
  NumberMIN_SAFE_INTEGER,
  ObjectAssign,
  ObjectCreate,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors,
  ObjectGetPrototypeOf,
  ObjectPrototypeHasOwnProperty,
  ObjectPrototypeIsPrototypeOf,
  ObjectIs,
  PromisePrototypeThen,
  PromiseReject,
  PromiseResolve,
  ReflectApply,
  ReflectDefineProperty,
  ReflectGetOwnPropertyDescriptor,
  ReflectHas,
  ReflectOwnKeys,
  RegExpPrototypeTest,
  Set,
  // TODO(lucacasonato): add SharedArrayBuffer to primordials
  // SharedArrayBuffer,
  String,
  StringFromCodePoint,
  StringPrototypeCharCodeAt,
  Symbol,
  SymbolIterator,
  SymbolToStringTag,
  TypeError,
  Uint16Array,
  Uint32Array,
  Uint8Array,
  Uint8ClampedArray,
  DataViewPrototype,
} = primordials;

export function makeException(ErrorType: any, message: string, opts: Partial<webidl.ValueConverterOpts> = {}): any {
  return new ErrorType(
    `${opts.prefix ? opts.prefix + ": " : ""}${
      opts.context ? opts.context : "Value"
    } ${message}`,
  );
}

export function toNumber(value: any) {
  if (typeof value === "bigint") {
    throw TypeError("Cannot convert a BigInt value to a number");
  }
  return Number(value);
}

/**
 * Get the WebIDL / ES type of a value.
 */
export function type(V: any) {
  if (V === null) {
    return "Null";
  }
  switch (typeof V) {
    case "undefined":
      return "Undefined";
    case "boolean":
      return "Boolean";
    case "number":
      return "Number";
    case "string":
      return "String";
    case "symbol":
      return "Symbol";
    case "bigint":
      return "BigInt";
    case "object":
    // Falls through
    case "function":
    // Falls through
    default:
      // Per ES spec, typeof returns an implemention-defined value that is not any of the existing ones for
      // uncallable non-standard exotic objects. Yet Type() which the Web IDL spec depends on returns Object for
      // such cases. So treat the default case as an object.
      return "Object";
  }
}

// Round x to the nearest integer, choosing the even integer if it lies halfway between two.
export function evenRound(x: number) {
  // There are four cases for numbers with fractional part being .5:
  //
  // case |     x     | floor(x) | round(x) | expected | x <> 0 | x % 1 | x & 1 |   example
  //   1  |  2n + 0.5 |  2n      |  2n + 1  |  2n      |   >    |  0.5  |   0   |  0.5 ->  0
  //   2  |  2n + 1.5 |  2n + 1  |  2n + 2  |  2n + 2  |   >    |  0.5  |   1   |  1.5 ->  2
  //   3  | -2n - 0.5 | -2n - 1  | -2n      | -2n      |   <    | -0.5  |   0   | -0.5 ->  0
  //   4  | -2n - 1.5 | -2n - 2  | -2n - 1  | -2n - 2  |   <    | -0.5  |   1   | -1.5 -> -2
  // (where n is a non-negative integer)
  //
  // Branch here for cases 1 and 4
  if (
    (x > 0 && x % 1 === +0.5 && (x & 1) === 0) ||
    (x < 0 && x % 1 === -0.5 && (x & 1) === 1)
  ) {
    return censorNegativeZero(MathFloor(x));
  }

  return censorNegativeZero(MathRound(x));
}

export function integerPart(n) {
  return censorNegativeZero(MathTrunc(n));
}

export function sign(x: number) {
  return x < 0 ? -1 : 1;
}

export function modulo(x: number, y: number) {
  // https://tc39.github.io/ecma262/#eqn-modulo
  // Note that http://stackoverflow.com/a/4467559/3191 does NOT work for large modulos
  const signMightNotMatch = x % y;
  if (sign(y) !== sign(signMightNotMatch)) {
    return signMightNotMatch + y;
  }
  return signMightNotMatch;
}

export function censorNegativeZero(x: number) {
  return x === 0 ? 0 : x;
}

export function createIntegerConversion(bitLength: number, typeOpts: Partial<webidl.IntConverterOpts>) {
  const isSigned = !typeOpts.unsigned;

  let lowerBound;
  let upperBound;
  if (bitLength === 64) {
    upperBound = NumberMAX_SAFE_INTEGER;
    lowerBound = !isSigned ? 0 : NumberMIN_SAFE_INTEGER;
  } else if (!isSigned) {
    lowerBound = 0;
    upperBound = MathPow(2, bitLength) - 1;
  } else {
    lowerBound = -MathPow(2, bitLength - 1);
    upperBound = MathPow(2, bitLength - 1) - 1;
  }

  const twoToTheBitLength = MathPow(2, bitLength);
  const twoToOneLessThanTheBitLength = MathPow(2, bitLength - 1);

  return (V: any, opts: Partial<webidl.IntConverterOpts> = {}) => {
    let x = toNumber(V);
    x = censorNegativeZero(x);

    if (opts.enforceRange) {
      if (!NumberIsFinite(x)) {
        throw makeException(TypeError, "is not a finite number", opts); // TODO type
      }

      x = integerPart(x);

      if (x < lowerBound || x > upperBound) {
        throw makeException(
          TypeError,
          `is outside the accepted range of ${lowerBound} to ${upperBound}, inclusive`,
          opts,
        );
      }

      return x;
    }

    if (!NumberIsNaN(x) && opts.clamp) {
      x = MathMin(MathMax(x, lowerBound), upperBound);
      x = evenRound(x);
      return x;
    }

    if (!NumberIsFinite(x) || x === 0) {
      return 0;
    }
    x = integerPart(x);

    // Math.pow(2, 64) is not accurately representable in JavaScript, so try to avoid these per-spec operations if
    // possible. Hopefully it's an optimization for the non-64-bitLength cases too.
    if (x >= lowerBound && x <= upperBound) {
      return x;
    }

    // These will not work great for bitLength of 64, but oh well. See the README for more details.
    x = modulo(x, twoToTheBitLength);
    if (isSigned && x >= twoToOneLessThanTheBitLength) {
      return x - twoToTheBitLength;
    }
    return x;
  };
}

export function createLongLongConversion(bitLength, { unsigned }: { unsigned?: boolean }) {
  const upperBound = NumberMAX_SAFE_INTEGER;
  const lowerBound = unsigned ? 0 : NumberMIN_SAFE_INTEGER;
  const asBigIntN = unsigned ? BigIntAsUintN : BigIntAsIntN;

  return (V, opts: Partial<webidl.IntConverterOpts> = {}) => {
    let x = toNumber(V);
    x = censorNegativeZero(x);

    if (opts.enforceRange) {
      if (!NumberIsFinite(x)) {
        throw makeException(TypeError, "is not a finite number", opts);
      }

      x = integerPart(x);

      if (x < lowerBound || x > upperBound) {
        throw makeException(
          TypeError,
          `is outside the accepted range of ${lowerBound} to ${upperBound}, inclusive`,
          opts,
        );
      }

      return x;
    }

    if (!NumberIsNaN(x) && opts.clamp) {
      x = MathMin(MathMax(x, lowerBound), upperBound);
      x = evenRound(x);
      return x;
    }

    if (!NumberIsFinite(x) || x === 0) {
      return 0;
    }

    let xBigInt = BigInt(integerPart(x));
    xBigInt = asBigIntN(bitLength, xBigInt);
    return Number(xBigInt);
  };
}

const converters = {} as webidl.converters;

converters.any = (V: any): any => {
  return V;
};

/**
 * Convert a value into a `boolean` (bool).
 */
converters.boolean = function (val: any) {
  return !!val;
};

converters.byte = createIntegerConversion(8, { unsigned: false });
converters.octet = createIntegerConversion(8, { unsigned: true });

converters.short = createIntegerConversion(16, { unsigned: false });
converters["unsigned short"] = createIntegerConversion(16, {
  unsigned: true,
});

converters.long = createIntegerConversion(32, { unsigned: false });
converters["unsigned long"] = createIntegerConversion(32, { unsigned: true });

converters["long long"] = createLongLongConversion(64, { unsigned: false });
converters["unsigned long long"] = createLongLongConversion(64, {
  unsigned: true,
});

converters.float = (V, opts) => {
  const x = toNumber(V);

  if (!NumberIsFinite(x)) {
    throw makeException(
      TypeError,
      "is not a finite floating-point value",
      opts,
    );
  }

  if (ObjectIs(x, -0)) {
    return x;
  }

  const y = MathFround(x);

  if (!NumberIsFinite(y)) {
    throw makeException(
      TypeError,
      "is outside the range of a single-precision floating-point value",
      opts,
    );
  }

  return y;
};

converters["unrestricted float"] = (V, _opts) => {
  const x = toNumber(V);

  if (isNaN(x)) {
    return x;
  }

  if (ObjectIs(x, -0)) {
    return x;
  }

  return MathFround(x);
};

converters.double = (V, opts) => {
  const x = toNumber(V);

  if (!NumberIsFinite(x)) {
    throw makeException(
      TypeError,
      "is not a finite floating-point value",
      opts,
    );
  }

  return x;
};

converters["unrestricted double"] = (V, _opts) => {
  const x = toNumber(V);

  return x;
};

converters.DOMString = function (V, opts: Partial<webidl.StringConverterOpts> = {}) {
  if (typeof V === "string") {
    return V;
  } else if (V === null && opts.treatNullAsEmptyString) {
    return "";
  } else if (typeof V === "symbol") {
    throw makeException(
      TypeError,
      "is a symbol, which cannot be converted to a string",
      opts,
    );
  }

  return String(V);
};

// deno-lint-ignore no-control-regex
const IS_BYTE_STRING = /^[\x00-\xFF]*$/;
converters.ByteString = (V, opts) => {
  const x = converters.DOMString(V, opts);
  if (!RegExpPrototypeTest(IS_BYTE_STRING, x)) {
    throw makeException(TypeError, "is not a valid ByteString", opts);
  }
  return x;
};

converters.USVString = (V, opts) => {
  const S = converters.DOMString(V, opts);
  const n = S.length;
  let U = "";
  for (let i = 0; i < n; ++i) {
    const c = StringPrototypeCharCodeAt(S, i);
    if (c < 0xd800 || c > 0xdfff) {
      U += StringFromCodePoint(c);
    } else if (0xdc00 <= c && c <= 0xdfff) {
      U += StringFromCodePoint(0xfffd);
    } else if (i === n - 1) {
      U += StringFromCodePoint(0xfffd);
    } else {
      const d = StringPrototypeCharCodeAt(S, i + 1);
      if (0xdc00 <= d && d <= 0xdfff) {
        const a = c & 0x3ff;
        const b = d & 0x3ff;
        U += StringFromCodePoint((2 << 15) + (2 << 9) * a + b);
        ++i;
      } else {
        U += StringFromCodePoint(0xfffd);
      }
    }
  }
  return U;
};

converters.object = (V, opts) => {
  if (type(V) !== "Object") {
    throw makeException(TypeError, "is not an object", opts);
  }

  return V;
};

// Not exported, but used in Function and VoidFunction.

// Neither Function nor VoidFunction is defined with [TreatNonObjectAsNull], so
// handling for that is omitted.
function convertCallbackFunction(V: any, opts) {
  if (typeof V !== "function") {
    throw makeException(TypeError, "is not a function", opts);
  }
  return V;
}

function isNonSharedArrayBuffer(V: any) {
  return ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, V);
}

function isSharedArrayBuffer(V: any) {
  return ObjectPrototypeIsPrototypeOf(SharedArrayBuffer.prototype, V);
}

converters.ArrayBuffer = (V: any, opts: Partial<webidl.BufferConverterOpts> = {}) => {
  if (!isNonSharedArrayBuffer(V)) {
    if (opts.allowShared && !isSharedArrayBuffer(V)) {
      throw makeException(
        TypeError,
        "is not an ArrayBuffer or SharedArrayBuffer",
        opts,
      );
    }
    throw makeException(TypeError, "is not an ArrayBuffer", opts);
  }

  return V;
};

converters.DataView = (V: any, opts: Partial<webidl.BufferConverterOpts> = {}) => {
  if (!(ObjectPrototypeIsPrototypeOf(DataViewPrototype, V))) {
    throw makeException(TypeError, "is not a DataView", opts);
  }

  if (!opts.allowShared && isSharedArrayBuffer(V.buffer)) {
    throw makeException(
      TypeError,
      "is backed by a SharedArrayBuffer, which is not allowed",
      opts,
    );
  }

  return V;
};

// Returns the unforgeable `TypedArray` constructor name or `undefined`,
// if the `this` value isn't a valid `TypedArray` object.
//
// https://tc39.es/ecma262/#sec-get-%typedarray%.prototype-@@tostringtag
const typedArrayNameGetter = ObjectGetOwnPropertyDescriptor(
  ObjectGetPrototypeOf(Uint8Array).prototype,
  SymbolToStringTag,
).get;
ArrayPrototypeForEach(
  [
    Int8Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Uint8ClampedArray,
    Float32Array,
    Float64Array,
  ],
  (func) => {
    const name = func.name;
    const article = RegExpPrototypeTest(/^[AEIOU]/, name) ? "an" : "a";
    converters[name] = (V, opts: Partial<webidl.BufferConverterOpts> = {}) => {
      if (!ArrayBufferIsView(V) || typedArrayNameGetter.call(V) !== name) {
        throw makeException(
          TypeError,
          `is not ${article} ${name} object`,
          opts,
        );
      }
      if (!opts.allowShared && isSharedArrayBuffer(V.buffer)) {
        throw makeException(
          TypeError,
          "is a view on a SharedArrayBuffer, which is not allowed",
          opts,
        );
      }

      return V;
    };
  },
);

// Common definitions

converters.ArrayBufferView = (V, opts: Partial<webidl.BufferConverterOpts> = {}) => {
  if (!ArrayBufferIsView(V)) {
    throw makeException(
      TypeError,
      "is not a view on an ArrayBuffer or SharedArrayBuffer",
      opts,
    );
  }

  if (!opts.allowShared && isSharedArrayBuffer(V.buffer)) {
    throw makeException(
      TypeError,
      "is a view on a SharedArrayBuffer, which is not allowed",
      opts,
    );
  }

  return V;
};

converters.BufferSource = (V, opts: Partial<webidl.BufferConverterOpts> = {}) => {
  if (ArrayBufferIsView(V)) {
    if (!opts.allowShared && isSharedArrayBuffer(V.buffer)) {
      throw makeException(
        TypeError,
        "is a view on a SharedArrayBuffer, which is not allowed",
        opts,
      );
    }

    return V;
  }

  if (!opts.allowShared && !isNonSharedArrayBuffer(V)) {
    throw makeException(
      TypeError,
      "is not an ArrayBuffer or a view on one",
      opts,
    );
  }
  if (
    opts.allowShared &&
    !isSharedArrayBuffer(V) &&
    !isNonSharedArrayBuffer(V)
  ) {
    throw makeException(
      TypeError,
      "is not an ArrayBuffer, SharedArrayBuffer, or a view on one",
      opts,
    );
  }

  return V;
};

converters.DOMTimeStamp = converters["unsigned long long"];
converters.DOMHighResTimeStamp = converters["double"];

converters.Function = convertCallbackFunction;

converters.VoidFunction = convertCallbackFunction;

converters["UVString?"] = createNullableConverter(
  converters.USVString,
);
converters["sequence<double>"] = createSequenceConverter(
  converters.double,
);
converters["sequence<object>"] = createSequenceConverter(
  converters.object,
);
converters["Promise<undefined>"] = createPromiseConverter(() => undefined);

converters["sequence<ByteString>"] = createSequenceConverter(
  converters.ByteString,
);
converters["sequence<sequence<ByteString>>"] = createSequenceConverter(
  converters["sequence<ByteString>"],
);
converters["record<ByteString, ByteString>"] = createRecordConverter(
  converters.ByteString,
  converters.ByteString,
);

converters["sequence<USVString>"] = createSequenceConverter(
  converters.USVString,
);
converters["sequence<sequence<USVString>>"] = createSequenceConverter(
  converters["sequence<USVString>"],
);
converters["record<USVString, USVString>"] = createRecordConverter(
  converters.USVString,
  converters.USVString,
);

converters["sequence<DOMString>"] = createSequenceConverter(
  converters.DOMString,
);

/**
 * Assert that the a function has at least a required amount of arguments.
 */
export function requiredArguments(length: number, required: number, opts: Partial<webidl.ConverterOpts> = {}) {
  if (length < required) {
    const errMsg = `${
      opts.prefix ? opts.prefix + ": " : ""
    }${required} argument${
      required === 1 ? "" : "s"
    } required, but only ${length} present.`;
    throw new TypeError(errMsg);
  }
}

/**
 * Create a converter for dictionaries.
 */
export function createDictionaryConverter<T>(name: string, ...dictionaries: webidl.Dictionary[]): (v: any, opts: Partial<webidl.ValueConverterOpts>) => T {
  let hasRequiredKey = false;
  const allMembers = [];
  for (const members of dictionaries) {
    for (const member of members) {
      if (member.required) {
        hasRequiredKey = true;
      }
      ArrayPrototypePush(allMembers, member);
    }
  }
  ArrayPrototypeSort(allMembers, (a, b) => {
    if (a.key == b.key) {
      return 0;
    }
    return a.key < b.key ? -1 : 1;
  });

  const defaultValues = {};
  for (const member of allMembers) {
    if (ReflectHas(member, "defaultValue")) {
      const idlMemberValue = member.defaultValue;
      const imvType = typeof idlMemberValue;
      // Copy by value types can be directly assigned, copy by reference types
      // need to be re-created for each allocation.
      if (
        imvType === "number" || imvType === "boolean" ||
        imvType === "string" || imvType === "bigint" ||
        imvType === "undefined"
      ) {
        defaultValues[member.key] = member.converter(idlMemberValue, {});
      } else {
        ObjectDefineProperty(defaultValues, member.key, {
          get() {
            return member.converter(idlMemberValue, member.defaultValue);
          },
          enumerable: true,
        });
      }
    }
  }

  return function (V, opts: Partial<webidl.ValueConverterOpts> = {}): T {
    const typeV = type(V);
    switch (typeV) {
      case "Undefined":
      case "Null":
      case "Object":
        break;
      default:
        throw makeException(
          TypeError,
          "can not be converted to a dictionary",
          opts,
        );
    }
    const esDict = V;

    const idlDict = ObjectAssign({}, defaultValues) as T;

    // NOTE: fast path Null and Undefined.
    if ((V === undefined || V === null) && !hasRequiredKey) {
      return idlDict;
    }

    for (const member of allMembers) {
      const key = member.key;

      let esMemberValue;
      if (typeV === "Undefined" || typeV === "Null") {
        esMemberValue = undefined;
      } else {
        esMemberValue = esDict[key];
      }

      if (esMemberValue !== undefined) {
        const context = `'${key}' of '${name}'${
          opts.context ? ` (${opts.context})` : ""
        }`;
        const converter = member.converter;
        const idlMemberValue = converter(esMemberValue, { ...opts, context });
        idlDict[key] = idlMemberValue;
      } else if (member.required) {
        throw makeException(
          TypeError,
          `can not be converted to '${name}' because '${key}' is required in '${name}'.`,
          opts,
        );
      }
    }

    return idlDict;
  };
}

/**
 * Create a converter for enums.
 * @see https://heycam.github.io/webidl/#es-enumeration
 */
export function createEnumConverter(name: string, values: string[]): (v: any, opts: webidl.ValueConverterOpts) => string {
  const E = new Set(values);

  return function (V, opts: Partial<webidl.ValueConverterOpts> = {}) {
    const S = String(V);

    if (!E.has(S)) {
      throw new TypeError(
        `${
          opts.prefix ? opts.prefix + ": " : ""
        }The provided value '${S}' is not a valid enum value of type ${name}.`,
      );
    }

    return S;
  };
}

/**
 * Create a converter that makes the contained type nullable.
 */
export function createNullableConverter<T>(converter: (v: any, opts: Partial<webidl.ValueConverterOpts>) => T): (v: any, opts: Partial<webidl.ValueConverterOpts>) => T | null {
  return (V, opts: Partial<webidl.ValueConverterOpts> = {}) => {
    // FIXME: If Type(V) is not Object, and the conversion to an IDL value is
    // being performed due to V being assigned to an attribute whose type is a
    // nullable callback function that is annotated with
    // [LegacyTreatNonObjectAsNull], then return the IDL nullable type T?
    // value null.

    if (V === null || V === undefined) return null;
    return converter(V, opts);
  };
}

/**
 * Create a converter that converts a sequence of the inner type.
 * @see https://heycam.github.io/webidl/#es-sequence
 */
export function createSequenceConverter<T>(converter: (v: any, opts: Partial<webidl.ValueConverterOpts>) => T): (v: any, opts: Partial<webidl.ValueConverterOpts>) => T[] {
  return function (V, opts = {}) {
    if (type(V) !== "Object") {
      throw makeException(
        TypeError,
        "can not be converted to sequence.",
        opts,
      );
    }
    const iter = V?.[SymbolIterator]?.();
    if (iter === undefined) {
      throw makeException(
        TypeError,
        "can not be converted to sequence.",
        opts,
      );
    }
    const array = [];
    while (true) {
      const res = iter?.next?.();
      if (res === undefined) {
        throw makeException(
          TypeError,
          "can not be converted to sequence.",
          opts,
        );
      }
      if (res.done === true) break;
      const val = converter(res.value, {
        ...opts,
        context: `${opts.context}, index ${array.length}`,
      });
      ArrayPrototypePush(array, val);
    }
    return array;
  };
}

export function createRecordConverter<
  K extends string | number | symbol,
  V,
>(
  keyConverter: (v: any, opts: webidl.ValueConverterOpts) => K,
  valueConverter: (v: any, opts: webidl.ValueConverterOpts) => V,
): (
  v: Record<K, V>,
  opts: webidl.ValueConverterOpts,
) => any {
  return (V: Record<K, V>, opts: webidl.ValueConverterOpts) => {
    if (type(V) !== "Object") {
      throw makeException(
        TypeError,
        "can not be converted to dictionary.",
        opts,
      );
    }
    const result: any = {}; // TODO type
    // Fast path for common case (not a Proxy)
    if (!core.isProxy(V)) {
      for (const key in V) {
        if (!ObjectPrototypeHasOwnProperty(V, key)) {
          continue;
        }
        const typedKey = keyConverter(key, opts);
        const value = V[key];
        const typedValue = valueConverter(value, opts);
        result[typedKey] = typedValue;
      }
      return result;
    }
    // Slow path if Proxy (e.g: in WPT tests)
    const keys = ReflectOwnKeys(V);
    for (const key of keys) {
      const desc = ObjectGetOwnPropertyDescriptor(V, key);
      if (desc !== undefined && desc.enumerable === true) {
        const typedKey = keyConverter(key, opts);
        const value = V[key];
        const typedValue = valueConverter(value, opts);
        result[typedKey] = typedValue;
      }
    }
    return result;
  };
}

/**
 * Create a converter that converts a Promise of the inner type.
 */
export function createPromiseConverter<T>(converter: (v: any, opts: webidl.ValueConverterOpts) => T): (v: any, opts: webidl.ValueConverterOpts) => Promise<T> {
  return (V: any, opts: webidl.ValueConverterOpts) =>
    PromisePrototypeThen(PromiseResolve(V), (V) => converter(V, opts)) as Promise<T>;
}

/**
 * Invoke a callback function.
 */
export function invokeCallbackFunction<T>(
  callable: (...args: any) => any,
  args: any[],
  thisArg: any,
  returnValueConverter: (v: any, opts: webidl.ValueConverterOpts) => T,
  opts: webidl.ConverterOpts & { returnsPromise?: boolean },
): T {
  try {
    const rv = ReflectApply(callable, thisArg, args);
    return returnValueConverter(rv, {
      prefix: opts.prefix,
      context: "return value",
    });
  } catch (err) {
    if (opts.returnsPromise === true) {
      return PromiseReject(err) as T;
    }
    throw err;
  }
}

/**
 * The branding symbol.
 */
export const brand = Symbol("[[webidl.brand]]");

/**
 * Create a converter for interfaces.
 */
export function createInterfaceConverter(name: string, prototype: any): (v: any, opts: webidl.ValueConverterOpts) => any {
  return (V, opts) => {
    if (!ObjectPrototypeIsPrototypeOf(prototype, V) || V[brand] !== brand) {
      throw makeException(TypeError, `is not of type ${name}.`, opts);
    }
    return V;
  };
}

// TODO(lucacasonato): have the user pass in the prototype, and not the type.
/**
 * Create a branded instance of an interface.
 */
export function createBranded(Type: any): any {
  const t = ObjectCreate(Type.prototype);
  t[brand] = brand;
  return t;
}

/**
 * Assert that self is branded.
 */
export function assertBranded(self: any, prototype: any): void {
  if (
    !ObjectPrototypeIsPrototypeOf(prototype, self) || self[brand] !== brand
  ) {
    console.error("Brand", brand);
    console.error("self[brand]", self[brand]);
    console.error("self.constructor.name", self.constructor.name);
    console.error("prototype.constructor.name", prototype.constructor.name);
    throw new TypeError("Illegal invocation");
  }
}

/**
 * Throw an illegal constructor error.
 */
export function illegalConstructor(): never {
  throw new TypeError("Illegal constructor");
}

function define(target: any, source: any) {
  for (const key of ReflectOwnKeys(source)) {
    const descriptor = ReflectGetOwnPropertyDescriptor(source, key);
    if (descriptor && !ReflectDefineProperty(target, key, descriptor)) {
      throw new TypeError(`Cannot redefine property: ${String(key)}`);
    }
  }
}

const _iteratorInternal = Symbol("iterator internal");

const globalIteratorPrototype = ObjectGetPrototypeOf(ArrayIteratorPrototype);

/**
 * Mix in the iterable declarations defined in webidl.
 * https://heycam.github.io/webidl/#es-iterable
 */
export function mixinPairIterable(
  name: string,
  prototype: any,
  dataSymbol: symbol,
  keyKey: string | number | symbol,
  valueKey: string | number | symbol,
) {
  const iteratorPrototype = ObjectCreate(globalIteratorPrototype, {
    [SymbolToStringTag]: { configurable: true, value: `${name} Iterator` },
  });
  define(iteratorPrototype, {
    next() {
      const internal = this && this[_iteratorInternal];
      if (!internal) {
        throw new TypeError(
          `next() called on a value that is not a ${name} iterator object`,
        );
      }
      const { target, kind, index } = internal;
      const values = target[dataSymbol];
      const len = values.length;
      if (index >= len) {
        return { value: undefined, done: true };
      }
      const pair = values[index];
      internal.index = index + 1;
      let result;
      switch (kind) {
        case "key":
          result = pair[keyKey];
          break;
        case "value":
          result = pair[valueKey];
          break;
        case "key+value":
          result = [pair[keyKey], pair[valueKey]];
          break;
      }
      return { value: result, done: false };
    },
  });
  function createDefaultIterator(target, kind) {
    const iterator = ObjectCreate(iteratorPrototype);
    ObjectDefineProperty(iterator, _iteratorInternal, {
      value: { target, kind, index: 0 },
      configurable: true,
    });
    return iterator;
  }

  function entries() {
    assertBranded(this, prototype.prototype);
    return createDefaultIterator(this, "key+value");
  }

  const properties = {
    entries: {
      value: entries,
      writable: true,
      enumerable: true,
      configurable: true,
    },
    [SymbolIterator]: {
      value: entries,
      writable: true,
      enumerable: false,
      configurable: true,
    },
    keys: {
      value: function keys() {
        assertBranded(this, prototype.prototype);
        return createDefaultIterator(this, "key");
      },
      writable: true,
      enumerable: true,
      configurable: true,
    },
    values: {
      value: function values() {
        assertBranded(this, prototype.prototype);
        return createDefaultIterator(this, "value");
      },
      writable: true,
      enumerable: true,
      configurable: true,
    },
    forEach: {
      value: function forEach(idlCallback, thisArg = undefined) {
        assertBranded(this, prototype.prototype);
        const prefix = `Failed to execute 'forEach' on '${name}'`;
        requiredArguments(arguments.length, 1, { prefix });
        idlCallback = converters["Function"](idlCallback, {
          prefix,
          context: "Argument 1",
        });
        idlCallback = FunctionPrototypeBind(
          idlCallback,
          thisArg ?? globalThis,
        );
        const pairs = this[dataSymbol];
        for (let i = 0; i < pairs.length; i++) {
          const entry = pairs[i];
          idlCallback(entry[valueKey], entry[keyKey], this);
        }
      },
      writable: true,
      enumerable: true,
      configurable: true,
    },
  };
  return ObjectDefineProperties(prototype.prototype, properties);
}

/**
 * Configure prototype properties enumerability / writability / configurability.
 */
export function configurePrototype(prototype: any) {
  const descriptors = ObjectGetOwnPropertyDescriptors(prototype.prototype);
  for (const key in descriptors) {
    if (key === "constructor") continue;
    const descriptor = descriptors[key];
    if (
      ReflectHas(descriptor, "value") &&
      typeof descriptor.value === "function"
    ) {
      ObjectDefineProperty(prototype.prototype, key, {
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else if (ReflectHas(descriptor, "get")) {
      ObjectDefineProperty(prototype.prototype, key, {
        enumerable: true,
        configurable: true,
      });
    }
  }
  ObjectDefineProperty(prototype.prototype, SymbolToStringTag, {
    value: prototype.name,
    enumerable: false,
    configurable: true,
    writable: false,
  });
}

export { converters }
