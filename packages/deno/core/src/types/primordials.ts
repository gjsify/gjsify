//@ts-nocheck
// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://github.com/denoland/deno/blob/main/core/internal.d.ts

export type UncurryThis<T extends (this: unknown, ...args: unknown[]) => unknown> =
(self: ThisParameterType<T>, ...args: Parameters<T>) => ReturnType<T>;

export type UncurryThisStaticApply<
T extends (this: unknown, ...args: unknown[]) => unknown,
> = (self: ThisParameterType<T>, args: Parameters<T>) => ReturnType<T>;

export type StaticApply<T extends (this: unknown, ...args: unknown[]) => unknown> =
(args: Parameters<T>) => ReturnType<T>;

/**
 * Primordials are a way to safely use globals without fear of global mutation
 * Generally, this means removing `this` parameter usage and instead using
 * a regular parameter:
 *
 * @example
 *
 * ```js
 * 'thing'.startsWith('hello');
 * ```
 *
 * becomes
 *
 * ```js
 * primordials.StringPrototypeStartsWith('thing', 'hello')
 * ```
 */
export interface Primordials {


    uncurryThis<T extends (...args: unknown[]) => unknown>(
        fn: T,
    ): (self: ThisType<T>, ...args: Parameters<T>) => ReturnType<T>;

    applyBind: (...args: any[]) => void;

    makeSafe<T extends NewableFunction>(
        unsafe: NewableFunction,
        safe: T,
    ): T;

    SafeMap: Map;
    SafeWeakMap: WeakMap;
    SafeSet: Set;
    SafeWeakSet: WeakSet;
    SafeFinalizationRegistry: FinalizationRegistry;
    SafeWeakRef: WeakRef;
    SafePromise: Promise;
    SafePromiseAll: (values: unknown[]) => Promise<unknown>;
    SafePromisePrototypeFinally: (thisPromise: Promise<any>, onFinally: (() => void) | undefined | null) => Promise<unknown>;

    // TODO types
    SafeArrayIterator: any;
    SafeStringIterator: any;
    ArrayPrototypeSymbolIterator: any;
    ArrayIteratorPrototype: any;
    ArrayIteratorPrototypeNext: any;
    StringPrototypeSymbolIterator: any;
    StringIteratorPrototypeNext: any;

    setQueueMicrotask: (value: any) => void;
    indirectEval: (x: string) => any;

    isNaN: typeof globalThis.isNaN;
    decodeURI: typeof globalThis.decodeURI;
    decodeURIComponent: typeof globalThis.decodeURIComponent;
    encodeURI: typeof globalThis.encodeURI;
    encodeURIComponent: typeof globalThis.encodeURIComponent;
    JSONParse: typeof JSON.parse;
    JSONStringify: typeof JSON.stringify;
    MathAbs: typeof Math.abs;
    MathAcos: typeof Math.acos;
    MathAcosh: typeof Math.acosh;
    MathAsin: typeof Math.asin;
    MathAsinh: typeof Math.asinh;
    MathAtan: typeof Math.atan;
    MathAtanh: typeof Math.atanh;
    MathAtan2: typeof Math.atan2;
    MathCeil: typeof Math.ceil;
    MathCbrt: typeof Math.cbrt;
    MathExpm1: typeof Math.expm1;
    MathClz32: typeof Math.clz32;
    MathCos: typeof Math.cos;
    MathCosh: typeof Math.cosh;
    MathExp: typeof Math.exp;
    MathFloor: typeof Math.floor;
    MathFround: typeof Math.fround;
    MathHypot: typeof Math.hypot;
    MathImul: typeof Math.imul;
    MathLog: typeof Math.log;
    MathLog1p: typeof Math.log1p;
    MathLog2: typeof Math.log2;
    MathLog10: typeof Math.log10;
    MathMax: typeof Math.max;
    MathMaxApply: StaticApply<typeof Math.max>;
    MathMin: typeof Math.min;
    MathPow: typeof Math.pow;
    MathRandom: typeof Math.random;
    MathRound: typeof Math.round;
    MathSign: typeof Math.sign;
    MathSin: typeof Math.sin;
    MathSinh: typeof Math.sinh;
    MathSqrt: typeof Math.sqrt;
    MathTan: typeof Math.tan;
    MathTanh: typeof Math.tanh;
    MathTrunc: typeof Math.trunc;
    MathE: typeof Math.E;
    MathLN10: typeof Math.LN10;
    MathLN2: typeof Math.LN2;
    MathLOG10E: typeof Math.LOG10E;
    MathLOG2E: typeof Math.LOG2E;
    MathPI: typeof Math.PI;
    MathSQRT1_2: typeof Math.SQRT1_2;
    MathSQRT2: typeof Math.SQRT2;
    ReflectDefineProperty: typeof Reflect.defineProperty;
    ReflectDeleteProperty: typeof Reflect.deleteProperty;
    ReflectApply: typeof Reflect.apply;
    ReflectConstruct: typeof Reflect.construct;
    ReflectGet: typeof Reflect.get;
    ReflectGetOwnPropertyDescriptor:
        typeof Reflect.getOwnPropertyDescriptor;
    ReflectGetPrototypeOf: typeof Reflect.getPrototypeOf;
    ReflectHas: typeof Reflect.has;
    ReflectIsExtensible: typeof Reflect.isExtensible;
    ReflectOwnKeys: typeof Reflect.ownKeys;
    ReflectPreventExtensions: typeof Reflect.preventExtensions;
    ReflectSet: typeof Reflect.set;
    ReflectSetPrototypeOf: typeof Reflect.setPrototypeOf;
    AggregateError: typeof globalThis.AggregateError;
    AggregateErrorLength: typeof AggregateError.length;
    AggregateErrorName: typeof AggregateError.name;
    AggregateErrorPrototype: typeof AggregateError.prototype;
    Array: typeof globalThis.Array;
    ArrayLength: typeof Array.length;
    ArrayName: typeof Array.name;
    ArrayPrototype: typeof Array.prototype;
    ArrayIsArray: typeof Array.isArray;
    ArrayFrom: typeof Array.from;
    ArrayOf: typeof Array.of;
    ArrayPrototypeConcat: UncurryThis<
        typeof Array.prototype.concat
    >;
    ArrayPrototypeCopyWithin: UncurryThis<
        typeof Array.prototype.copyWithin
    >;
    ArrayPrototypeFill: UncurryThis<typeof Array.prototype.fill>;
    ArrayPrototypeFind: UncurryThis<typeof Array.prototype.find>;
    ArrayPrototypeFindIndex: UncurryThis<
        typeof Array.prototype.findIndex
    >;
    ArrayPrototypeLastIndexOf: UncurryThis<
        typeof Array.prototype.lastIndexOf
    >;
    ArrayPrototypePop: UncurryThis<typeof Array.prototype.pop>;
    ArrayPrototypePush: UncurryThis<typeof Array.prototype.push>;
    ArrayPrototypePushApply: UncurryThisStaticApply<
        typeof Array.prototype.push
    >;
    ArrayPrototypeReverse: UncurryThis<
        typeof Array.prototype.reverse
    >;
    ArrayPrototypeShift: UncurryThis<typeof Array.prototype.shift>;
    ArrayPrototypeUnshift: UncurryThis<
        typeof Array.prototype.unshift
    >;
    ArrayPrototypeUnshiftApply: UncurryThisStaticApply<
        typeof Array.prototype.unshift
    >;
    ArrayPrototypeSlice: UncurryThis<typeof Array.prototype.slice>;
    ArrayPrototypeSort: UncurryThis<typeof Array.prototype.sort>;
    ArrayPrototypeSplice: UncurryThis<
        typeof Array.prototype.splice
    >;
    ArrayPrototypeIncludes: UncurryThis<
        typeof Array.prototype.includes
    >;
    ArrayPrototypeIndexOf: UncurryThis<
        typeof Array.prototype.indexOf
    >;
    ArrayPrototypeJoin: UncurryThis<typeof Array.prototype.join>;
    ArrayPrototypeKeys: UncurryThis<typeof Array.prototype.keys>;
    ArrayPrototypeEntries: UncurryThis<
        typeof Array.prototype.entries
    >;
    ArrayPrototypeValues: UncurryThis<
        typeof Array.prototype.values
    >;
    ArrayPrototypeForEach: UncurryThis<
        typeof Array.prototype.forEach
    >;
    ArrayPrototypeFilter: UncurryThis<
        typeof Array.prototype.filter
    >;
    ArrayPrototypeFlat: UncurryThis<typeof Array.prototype.flat>;
    ArrayPrototypeFlatMap: UncurryThis<
        typeof Array.prototype.flatMap
    >;
    ArrayPrototypeMap: UncurryThis<typeof Array.prototype.map>;
    ArrayPrototypeEvery: UncurryThis<typeof Array.prototype.every>;
    ArrayPrototypeSome: UncurryThis<typeof Array.prototype.some>;
    ArrayPrototypeReduce: UncurryThis<
        typeof Array.prototype.reduce
    >;
    ArrayPrototypeReduceRight: UncurryThis<
        typeof Array.prototype.reduceRight
    >;
    ArrayPrototypeToLocaleString: UncurryThis<
        typeof Array.prototype.toLocaleString
    >;
    ArrayPrototypeToString: UncurryThis<
        typeof Array.prototype.toString
    >;
    ArrayBuffer: typeof globalThis.ArrayBuffer;
    ArrayBufferLength: typeof ArrayBuffer.length;
    ArrayBufferName: typeof ArrayBuffer.name;
    ArrayBufferPrototype: typeof ArrayBuffer.prototype;
    ArrayBufferIsView: typeof ArrayBuffer.isView;
    ArrayBufferPrototypeSlice: UncurryThis<
        typeof ArrayBuffer.prototype.slice
    >;
    BigInt: typeof globalThis.BigInt;
    BigIntLength: typeof BigInt.length;
    BigIntName: typeof BigInt.name;
    BigIntPrototype: typeof BigInt.prototype;
    BigIntAsUintN: typeof BigInt.asUintN;
    BigIntAsIntN: typeof BigInt.asIntN;
    BigIntPrototypeToLocaleString: UncurryThis<
        typeof BigInt.prototype.toLocaleString
    >;
    BigIntPrototypeToString: UncurryThis<
        typeof BigInt.prototype.toString
    >;
    BigIntPrototypeValueOf: UncurryThis<
        typeof BigInt.prototype.valueOf
    >;
    BigInt64Array: typeof globalThis.BigInt64Array;
    BigInt64ArrayLength: typeof BigInt64Array.length;
    BigInt64ArrayName: typeof BigInt64Array.name;
    BigInt64ArrayPrototype: typeof BigInt64Array.prototype;
    BigInt64ArrayBYTES_PER_ELEMENT:
        typeof BigInt64Array.BYTES_PER_ELEMENT;
    BigUint64Array: typeof globalThis.BigUint64Array;
    BigUint64ArrayLength: typeof BigUint64Array.length;
    BigUint64ArrayName: typeof BigUint64Array.name;
    BigUint64ArrayPrototype: typeof BigUint64Array.prototype;
    BigUint64ArrayBYTES_PER_ELEMENT:
        typeof BigUint64Array.BYTES_PER_ELEMENT;
    Boolean: typeof globalThis.Boolean;
    BooleanLength: typeof Boolean.length;
    BooleanName: typeof Boolean.name;
    BooleanPrototype: typeof Boolean.prototype;
    BooleanPrototypeToString: UncurryThis<
        typeof Boolean.prototype.toString
    >;
    BooleanPrototypeValueOf: UncurryThis<
        typeof Boolean.prototype.valueOf
    >;
    DataView: typeof globalThis.DataView;
    DataViewLength: typeof DataView.length;
    DataViewName: typeof DataView.name;
    DataViewPrototype: typeof DataView.prototype;
    DataViewPrototypeGetInt8: UncurryThis<
        typeof DataView.prototype.getInt8
    >;
    DataViewPrototypeSetInt8: UncurryThis<
        typeof DataView.prototype.setInt8
    >;
    DataViewPrototypeGetUint8: UncurryThis<
        typeof DataView.prototype.getUint8
    >;
    DataViewPrototypeSetUint8: UncurryThis<
        typeof DataView.prototype.setUint8
    >;
    DataViewPrototypeGetInt16: UncurryThis<
        typeof DataView.prototype.getInt16
    >;
    DataViewPrototypeSetInt16: UncurryThis<
        typeof DataView.prototype.setInt16
    >;
    DataViewPrototypeGetUint16: UncurryThis<
        typeof DataView.prototype.getUint16
    >;
    DataViewPrototypeSetUint16: UncurryThis<
        typeof DataView.prototype.setUint16
    >;
    DataViewPrototypeGetInt32: UncurryThis<
        typeof DataView.prototype.getInt32
    >;
    DataViewPrototypeSetInt32: UncurryThis<
        typeof DataView.prototype.setInt32
    >;
    DataViewPrototypeGetUint32: UncurryThis<
        typeof DataView.prototype.getUint32
    >;
    DataViewPrototypeSetUint32: UncurryThis<
        typeof DataView.prototype.setUint32
    >;
    DataViewPrototypeGetFloat32: UncurryThis<
        typeof DataView.prototype.getFloat32
    >;
    DataViewPrototypeSetFloat32: UncurryThis<
        typeof DataView.prototype.setFloat32
    >;
    DataViewPrototypeGetFloat64: UncurryThis<
        typeof DataView.prototype.getFloat64
    >;
    DataViewPrototypeSetFloat64: UncurryThis<
        typeof DataView.prototype.setFloat64
    >;
    DataViewPrototypeGetBigInt64: UncurryThis<
        typeof DataView.prototype.getBigInt64
    >;
    DataViewPrototypeSetBigInt64: UncurryThis<
        typeof DataView.prototype.setBigInt64
    >;
    DataViewPrototypeGetBigUint64: UncurryThis<
        typeof DataView.prototype.getBigUint64
    >;
    DataViewPrototypeSetBigUint64: UncurryThis<
        typeof DataView.prototype.setBigUint64
    >;
    Date: typeof globalThis.Date;
    DateLength: typeof Date.length;
    DateName: typeof Date.name;
    DatePrototype: typeof Date.prototype;
    DateNow: typeof Date.now;
    DateParse: typeof Date.parse;
    DateUTC: typeof Date.UTC;
    DatePrototypeToString: UncurryThis<
        typeof Date.prototype.toString
    >;
    DatePrototypeToDateString: UncurryThis<
        typeof Date.prototype.toDateString
    >;
    DatePrototypeToTimeString: UncurryThis<
        typeof Date.prototype.toTimeString
    >;
    DatePrototypeToISOString: UncurryThis<
        typeof Date.prototype.toISOString
    >;
    DatePrototypeToUTCString: UncurryThis<
        typeof Date.prototype.toUTCString
    >;
    DatePrototypeToGMTString: UncurryThis<
        // @ts-ignore
        typeof Date.prototype.toGMTString
    >;
    DatePrototypeGetDate: UncurryThis<
        typeof Date.prototype.getDate
    >;
    DatePrototypeSetDate: UncurryThis<
        typeof Date.prototype.setDate
    >;
    DatePrototypeGetDay: UncurryThis<typeof Date.prototype.getDay>;
    DatePrototypeGetFullYear: UncurryThis<
        typeof Date.prototype.getFullYear
    >;
    DatePrototypeSetFullYear: UncurryThis<
        typeof Date.prototype.setFullYear
    >;
    DatePrototypeGetHours: UncurryThis<
        typeof Date.prototype.getHours
    >;
    DatePrototypeSetHours: UncurryThis<
        typeof Date.prototype.setHours
    >;
    DatePrototypeGetMilliseconds: UncurryThis<
        typeof Date.prototype.getMilliseconds
    >;
    DatePrototypeSetMilliseconds: UncurryThis<
        typeof Date.prototype.setMilliseconds
    >;
    DatePrototypeGetMinutes: UncurryThis<
        typeof Date.prototype.getMinutes
    >;
    DatePrototypeSetMinutes: UncurryThis<
        typeof Date.prototype.setMinutes
    >;
    DatePrototypeGetMonth: UncurryThis<
        typeof Date.prototype.getMonth
    >;
    DatePrototypeSetMonth: UncurryThis<
        typeof Date.prototype.setMonth
    >;
    DatePrototypeGetSeconds: UncurryThis<
        typeof Date.prototype.getSeconds
    >;
    DatePrototypeSetSeconds: UncurryThis<
        typeof Date.prototype.setSeconds
    >;
    DatePrototypeGetTime: UncurryThis<
        typeof Date.prototype.getTime
    >;
    DatePrototypeSetTime: UncurryThis<
        typeof Date.prototype.setTime
    >;
    DatePrototypeGetTimezoneOffset: UncurryThis<
        typeof Date.prototype.getTimezoneOffset
    >;
    DatePrototypeGetUTCDate: UncurryThis<
        typeof Date.prototype.getUTCDate
    >;
    DatePrototypeSetUTCDate: UncurryThis<
        typeof Date.prototype.setUTCDate
    >;
    DatePrototypeGetUTCDay: UncurryThis<
        typeof Date.prototype.getUTCDay
    >;
    DatePrototypeGetUTCFullYear: UncurryThis<
        typeof Date.prototype.getUTCFullYear
    >;
    DatePrototypeSetUTCFullYear: UncurryThis<
        typeof Date.prototype.setUTCFullYear
    >;
    DatePrototypeGetUTCHours: UncurryThis<
        typeof Date.prototype.getUTCHours
    >;
    DatePrototypeSetUTCHours: UncurryThis<
        typeof Date.prototype.setUTCHours
    >;
    DatePrototypeGetUTCMilliseconds: UncurryThis<
        typeof Date.prototype.getUTCMilliseconds
    >;
    DatePrototypeSetUTCMilliseconds: UncurryThis<
        typeof Date.prototype.setUTCMilliseconds
    >;
    DatePrototypeGetUTCMinutes: UncurryThis<
        typeof Date.prototype.getUTCMinutes
    >;
    DatePrototypeSetUTCMinutes: UncurryThis<
        typeof Date.prototype.setUTCMinutes
    >;
    DatePrototypeGetUTCMonth: UncurryThis<
        typeof Date.prototype.getUTCMonth
    >;
    DatePrototypeSetUTCMonth: UncurryThis<
        typeof Date.prototype.setUTCMonth
    >;
    DatePrototypeGetUTCSeconds: UncurryThis<
        typeof Date.prototype.getUTCSeconds
    >;
    DatePrototypeSetUTCSeconds: UncurryThis<
        typeof Date.prototype.setUTCSeconds
    >;
    DatePrototypeValueOf: UncurryThis<
        typeof Date.prototype.valueOf
    >;
    DatePrototypeGetYear: UncurryThis<
        // @ts-ignore
        typeof Date.prototype.getYear
    >;
    DatePrototypeSetYear: UncurryThis<
        // @ts-ignore
        typeof Date.prototype.setYear
    >;
    DatePrototypeToJSON: UncurryThis<typeof Date.prototype.toJSON>;
    DatePrototypeToLocaleString: UncurryThis<
        typeof Date.prototype.toLocaleString
    >;
    DatePrototypeToLocaleDateString: UncurryThis<
        typeof Date.prototype.toLocaleDateString
    >;
    DatePrototypeToLocaleTimeString: UncurryThis<
        typeof Date.prototype.toLocaleTimeString
    >;
    Error: typeof globalThis.Error;
    ErrorLength: typeof Error.length;
    ErrorName: typeof Error.name;
    ErrorPrototype: typeof Error.prototype;
    ErrorCaptureStackTrace: typeof Error.captureStackTrace;
    ErrorStackTraceLimit: typeof Error.stackTraceLimit;
    ErrorPrototypeToString: UncurryThis<
        typeof Error.prototype.toString
    >;
    EvalError: typeof globalThis.EvalError;
    EvalErrorLength: typeof EvalError.length;
    EvalErrorName: typeof EvalError.name;
    EvalErrorPrototype: typeof EvalError.prototype;
    Float32Array: typeof globalThis.Float32Array;
    Float32ArrayLength: typeof Float32Array.length;
    Float32ArrayName: typeof Float32Array.name;
    Float32ArrayPrototype: typeof Float32Array.prototype;
    Float32ArrayBYTES_PER_ELEMENT:
        typeof Float32Array.BYTES_PER_ELEMENT;
    Float64Array: typeof globalThis.Float64Array;
    Float64ArrayLength: typeof Float64Array.length;
    Float64ArrayName: typeof Float64Array.name;
    Float64ArrayPrototype: typeof Float64Array.prototype;
    Float64ArrayBYTES_PER_ELEMENT:
        typeof Float64Array.BYTES_PER_ELEMENT;
    Function: typeof globalThis.Function;
    FunctionLength: typeof Function.length;
    FunctionName: typeof Function.name;
    FunctionPrototype: typeof Function.prototype;
    FunctionPrototypeApply: UncurryThis<
        typeof Function.prototype.apply
    >;
    FunctionPrototypeBind: UncurryThis<
        typeof Function.prototype.bind
    >;
    FunctionPrototypeCall: UncurryThis<
        typeof Function.prototype.call
    >;
    FunctionPrototypeToString: UncurryThis<
        typeof Function.prototype.toString
    >;
    Int16Array: typeof globalThis.Int16Array;
    Int16ArrayLength: typeof Int16Array.length;
    Int16ArrayName: typeof Int16Array.name;
    Int16ArrayPrototype: typeof Int16Array.prototype;
    Int16ArrayBYTES_PER_ELEMENT:
        typeof Int16Array.BYTES_PER_ELEMENT;
    Int32Array: typeof globalThis.Int32Array;
    Int32ArrayLength: typeof Int32Array.length;
    Int32ArrayName: typeof Int32Array.name;
    Int32ArrayPrototype: typeof Int32Array.prototype;
    Int32ArrayBYTES_PER_ELEMENT:
        typeof Int32Array.BYTES_PER_ELEMENT;
    Int8Array: typeof globalThis.Int8Array;
    Int8ArrayLength: typeof Int8Array.length;
    Int8ArrayName: typeof Int8Array.name;
    Int8ArrayPrototype: typeof Int8Array.prototype;
    Int8ArrayBYTES_PER_ELEMENT: typeof Int8Array.BYTES_PER_ELEMENT;
    Map: typeof globalThis.Map;
    MapLength: typeof Map.length;
    MapName: typeof Map.name;
    MapPrototype: typeof Map.prototype;
    MapPrototypeGet: UncurryThis<typeof Map.prototype.get>;
    MapPrototypeSet: UncurryThis<typeof Map.prototype.set>;
    MapPrototypeHas: UncurryThis<typeof Map.prototype.has>;
    MapPrototypeDelete: UncurryThis<typeof Map.prototype.delete>;
    MapPrototypeClear: UncurryThis<typeof Map.prototype.clear>;
    MapPrototypeEntries: UncurryThis<typeof Map.prototype.entries>;
    MapPrototypeForEach: UncurryThis<typeof Map.prototype.forEach>;
    MapPrototypeGetSize: UncurryThis<typeof Map.prototype.getSize>;
    MapPrototypeKeys: UncurryThis<typeof Map.prototype.keys>;
    MapPrototypeValues: UncurryThis<typeof Map.prototype.values>;
    Number: typeof globalThis.Number;
    NumberLength: typeof Number.length;
    NumberName: typeof Number.name;
    NumberPrototype: typeof Number.prototype;
    NumberIsFinite: typeof Number.isFinite;
    NumberIsInteger: typeof Number.isInteger;
    NumberIsNaN: typeof Number.isNaN;
    NumberIsSafeInteger: typeof Number.isSafeInteger;
    NumberParseFloat: typeof Number.parseFloat;
    NumberParseInt: typeof Number.parseInt;
    NumberMAX_VALUE: typeof Number.MAX_VALUE;
    NumberMIN_VALUE: typeof Number.MIN_VALUE;
    NumberNaN: typeof Number.NaN;
    NumberNEGATIVE_INFINITY: typeof Number.NEGATIVE_INFINITY;
    NumberPOSITIVE_INFINITY: typeof Number.POSITIVE_INFINITY;
    NumberMAX_SAFE_INTEGER: typeof Number.MAX_SAFE_INTEGER;
    NumberMIN_SAFE_INTEGER: typeof Number.MIN_SAFE_INTEGER;
    NumberEPSILON: typeof Number.EPSILON;
    NumberPrototypeToExponential: UncurryThis<
        typeof Number.prototype.toExponential
    >;
    NumberPrototypeToFixed: UncurryThis<
        typeof Number.prototype.toFixed
    >;
    NumberPrototypeToPrecision: UncurryThis<
        typeof Number.prototype.toPrecision
    >;
    NumberPrototypeToString: UncurryThis<
        typeof Number.prototype.toString
    >;
    NumberPrototypeValueOf: UncurryThis<
        typeof Number.prototype.valueOf
    >;
    NumberPrototypeToLocaleString: UncurryThis<
        typeof Number.prototype.toLocaleString
    >;
    Object: typeof globalThis.Object;
    ObjectLength: typeof Object.length;
    ObjectName: typeof Object.name;
    ObjectPrototype: typeof Object.prototype;
    ObjectAssign: typeof Object.assign;
    ObjectGetOwnPropertyDescriptor:
        typeof Object.getOwnPropertyDescriptor;
    ObjectGetOwnPropertyDescriptors:
        typeof Object.getOwnPropertyDescriptors;
    ObjectGetOwnPropertyNames: typeof Object.getOwnPropertyNames;
    ObjectGetOwnPropertySymbols:
        typeof Object.getOwnPropertySymbols;
    ObjectIs: typeof Object.is;
    ObjectPreventExtensions: typeof Object.preventExtensions;
    ObjectSeal: typeof Object.seal;
    ObjectCreate: typeof Object.create;
    ObjectDefineProperties: typeof Object.defineProperties;
    ObjectDefineProperty: typeof Object.defineProperty;
    ObjectFreeze: typeof Object.freeze;
    ObjectGetPrototypeOf: typeof Object.getPrototypeOf;
    ObjectSetPrototypeOf: typeof Object.setPrototypeOf;
    ObjectIsExtensible: typeof Object.isExtensible;
    ObjectIsFrozen: typeof Object.isFrozen;
    ObjectIsSealed: typeof Object.isSealed;
    ObjectKeys: typeof Object.keys;
    ObjectEntries: typeof Object.entries;
    ObjectFromEntries: typeof Object.fromEntries;
    ObjectValues: typeof Object.values;
    ObjectPrototype__defineGetter__: UncurryThis<
        // @ts-ignore
        typeof Object.prototype.__defineGetter__
    >;
    ObjectPrototype__defineSetter__: UncurryThis<
        // @ts-ignore
        typeof Object.prototype.__defineSetter__
    >;
    ObjectPrototypeHasOwnProperty: UncurryThis<
        typeof Object.prototype.hasOwnProperty
    >;
    ObjectPrototype__lookupGetter__: UncurryThis<
        // @ts-ignore
        typeof Object.prototype.__lookupGetter__
    >;
    ObjectPrototype__lookupSetter__: UncurryThis<
        // @ts-ignore
        typeof Object.prototype.__lookupSetter__
    >;
    ObjectPrototypeIsPrototypeOf: UncurryThis<
        typeof Object.prototype.isPrototypeOf
    >;
    ObjectPrototypePropertyIsEnumerable: UncurryThis<
        typeof Object.prototype.propertyIsEnumerable
    >;
    ObjectPrototypeToString: UncurryThis<
        typeof Object.prototype.toString
    >;
    ObjectPrototypeValueOf: UncurryThis<
        typeof Object.prototype.valueOf
    >;
    ObjectPrototypeToLocaleString: UncurryThis<
        typeof Object.prototype.toLocaleString
    >;
    queueMicrotask: typeof globalThis.queueMicrotask;
    RangeError: typeof globalThis.RangeError;
    RangeErrorLength: typeof RangeError.length;
    RangeErrorName: typeof RangeError.name;
    RangeErrorPrototype: typeof RangeError.prototype;
    ReferenceError: typeof globalThis.ReferenceError;
    ReferenceErrorLength: typeof ReferenceError.length;
    ReferenceErrorName: typeof ReferenceError.name;
    ReferenceErrorPrototype: typeof ReferenceError.prototype;
    RegExp: typeof globalThis.RegExp;
    RegExpLength: typeof RegExp.length;
    RegExpName: typeof RegExp.name;
    RegExpPrototype: typeof RegExp.prototype;
    RegExpPrototypeExec: UncurryThis<typeof RegExp.prototype.exec>;
    RegExpPrototypeCompile: UncurryThis<
        typeof RegExp.prototype.compile
    >;
    RegExpPrototypeToString: UncurryThis<
        typeof RegExp.prototype.toString
    >;
    RegExpPrototypeTest: UncurryThis<typeof RegExp.prototype.test>;
    Set: typeof globalThis.Set;
    SetLength: typeof Set.length;
    SetName: typeof Set.name;
    SetPrototype: typeof Set.prototype;
    SetPrototypeHas: UncurryThis<typeof Set.prototype.has>;
    SetPrototypeAdd: UncurryThis<typeof Set.prototype.add>;
    SetPrototypeDelete: UncurryThis<typeof Set.prototype.delete>;
    SetPrototypeClear: UncurryThis<typeof Set.prototype.clear>;
    SetPrototypeEntries: UncurryThis<typeof Set.prototype.entries>;
    SetPrototypeGetSize: UncurryThis<typeof Set.prototype.getSize>;
    SetPrototypeForEach: UncurryThis<typeof Set.prototype.forEach>;
    SetPrototypeValues: UncurryThis<typeof Set.prototype.values>;
    SetPrototypeKeys: UncurryThis<typeof Set.prototype.keys>;
    String: typeof globalThis.String;
    StringLength: typeof String.length;
    StringName: typeof String.name;
    StringPrototype: typeof String.prototype;
    StringFromCharCode: typeof String.fromCharCode;
    StringFromCodePoint: typeof String.fromCodePoint;
    StringRaw: typeof String.raw;
    StringPrototypeAnchor: UncurryThis<
        typeof String.prototype.anchor
    >;
    StringPrototypeBig: UncurryThis<typeof String.prototype.big>;
    StringPrototypeBlink: UncurryThis<
        typeof String.prototype.blink
    >;
    StringPrototypeBold: UncurryThis<typeof String.prototype.bold>;
    StringPrototypeCharAt: UncurryThis<
        typeof String.prototype.charAt
    >;
    StringPrototypeCharCodeAt: UncurryThis<
        typeof String.prototype.charCodeAt
    >;
    StringPrototypeCodePointAt: UncurryThis<
        typeof String.prototype.codePointAt
    >;
    StringPrototypeConcat: UncurryThis<
        typeof String.prototype.concat
    >;
    StringPrototypeEndsWith: UncurryThis<
        typeof String.prototype.endsWith
    >;
    StringPrototypeFontcolor: UncurryThis<
        typeof String.prototype.fontcolor
    >;
    StringPrototypeFontsize: UncurryThis<
        typeof String.prototype.fontsize
    >;
    StringPrototypeFixed: UncurryThis<
        typeof String.prototype.fixed
    >;
    StringPrototypeIncludes: UncurryThis<
        typeof String.prototype.includes
    >;
    StringPrototypeIndexOf: UncurryThis<
        typeof String.prototype.indexOf
    >;
    StringPrototypeItalics: UncurryThis<
        typeof String.prototype.italics
    >;
    StringPrototypeLastIndexOf: UncurryThis<
        typeof String.prototype.lastIndexOf
    >;
    StringPrototypeLink: UncurryThis<typeof String.prototype.link>;
    StringPrototypeLocaleCompare: UncurryThis<
        typeof String.prototype.localeCompare
    >;
    StringPrototypeMatch: UncurryThis<
        typeof String.prototype.match
    >;
    StringPrototypeMatchAll: UncurryThis<
        typeof String.prototype.matchAll
    >;
    StringPrototypeNormalize: UncurryThis<
        typeof String.prototype.normalize
    >;
    StringPrototypePadEnd: UncurryThis<
        typeof String.prototype.padEnd
    >;
    StringPrototypePadStart: UncurryThis<
        typeof String.prototype.padStart
    >;
    StringPrototypeRepeat: UncurryThis<
        typeof String.prototype.repeat
    >;
    StringPrototypeReplace: UncurryThis<
        typeof String.prototype.replace
    >;
    StringPrototypeSearch: UncurryThis<
        typeof String.prototype.search
    >;
    StringPrototypeSlice: UncurryThis<
        typeof String.prototype.slice
    >;
    StringPrototypeSmall: UncurryThis<
        typeof String.prototype.small
    >;
    StringPrototypeSplit: UncurryThis<
        typeof String.prototype.split
    >;
    StringPrototypeStrike: UncurryThis<
        typeof String.prototype.strike
    >;
    StringPrototypeSub: UncurryThis<typeof String.prototype.sub>;
    StringPrototypeSubstr: UncurryThis<
        typeof String.prototype.substr
    >;
    StringPrototypeSubstring: UncurryThis<
        typeof String.prototype.substring
    >;
    StringPrototypeSup: UncurryThis<typeof String.prototype.sup>;
    StringPrototypeStartsWith: UncurryThis<
        typeof String.prototype.startsWith
    >;
    StringPrototypeToString: UncurryThis<
        typeof String.prototype.toString
    >;
    StringPrototypeTrim: UncurryThis<typeof String.prototype.trim>;
    StringPrototypeTrimStart: UncurryThis<
        typeof String.prototype.trimStart
    >;
    StringPrototypeTrimLeft: UncurryThis<
        typeof String.prototype.trimLeft
    >;
    StringPrototypeTrimEnd: UncurryThis<
        typeof String.prototype.trimEnd
    >;
    StringPrototypeTrimRight: UncurryThis<
        typeof String.prototype.trimRight
    >;
    StringPrototypeToLocaleLowerCase: UncurryThis<
        typeof String.prototype.toLocaleLowerCase
    >;
    StringPrototypeToLocaleUpperCase: UncurryThis<
        typeof String.prototype.toLocaleUpperCase
    >;
    StringPrototypeToLowerCase: UncurryThis<
        typeof String.prototype.toLowerCase
    >;
    StringPrototypeToUpperCase: UncurryThis<
        typeof String.prototype.toUpperCase
    >;
    StringPrototypeValueOf: UncurryThis<
        typeof String.prototype.valueOf
    >;
    StringPrototypeReplaceAll: UncurryThis<
        typeof String.prototype.replaceAll
    >;
    Symbol: typeof globalThis.Symbol;
    SymbolLength: typeof Symbol.length;
    SymbolName: typeof Symbol.name;
    SymbolPrototype: typeof Symbol.prototype;
    SymbolFor: typeof Symbol.for;
    SymbolKeyFor: typeof Symbol.keyFor;
    SymbolAsyncIterator: typeof Symbol.asyncIterator;
    SymbolHasInstance: typeof Symbol.hasInstance;
    SymbolIsConcatSpreadable: typeof Symbol.isConcatSpreadable;
    SymbolIterator: typeof Symbol.iterator;
    SymbolMatch: typeof Symbol.match;
    SymbolMatchAll: typeof Symbol.matchAll;
    SymbolReplace: typeof Symbol.replace;
    SymbolSearch: typeof Symbol.search;
    SymbolSpecies: typeof Symbol.species;
    SymbolSplit: typeof Symbol.split;
    SymbolToPrimitive: typeof Symbol.toPrimitive;
    SymbolToStringTag: typeof Symbol.toStringTag;
    SymbolUnscopables: typeof Symbol.unscopables;
    SymbolPrototypeToString: UncurryThis<
        typeof Symbol.prototype.toString
    >;
    SymbolPrototypeValueOf: UncurryThis<
        typeof Symbol.prototype.valueOf
    >;
    SyntaxError: typeof globalThis.SyntaxError;
    SyntaxErrorLength: typeof SyntaxError.length;
    SyntaxErrorName: typeof SyntaxError.name;
    SyntaxErrorPrototype: typeof SyntaxError.prototype;
    TypeError: typeof globalThis.TypeError;
    TypeErrorLength: typeof TypeError.length;
    TypeErrorName: typeof TypeError.name;
    TypeErrorPrototype: typeof TypeError.prototype;
    TypedArrayFrom: (
        constructor: Uint8ArrayConstructor,
        arrayLike: ArrayLike<number>,
    ) => Uint8Array;
    TypedArrayPrototypeCopyWithin: UncurryThis<
        typeof Uint8Array.prototype.copyWithin
    >;
    TypedArrayPrototypeEvery: UncurryThis<
        typeof Uint8Array.prototype.every
    >;
    TypedArrayPrototypeFill: UncurryThis<
        typeof Uint8Array.prototype.fill
    >;
    TypedArrayPrototypeFilter: UncurryThis<
        typeof Uint8Array.prototype.filter
    >;
    TypedArrayPrototypeFind: UncurryThis<
        typeof Uint8Array.prototype.find
    >;
    TypedArrayPrototypeFindIndex: UncurryThis<
        typeof Uint8Array.prototype.findIndex
    >;
    TypedArrayPrototypeForEach: UncurryThis<
        typeof Uint8Array.prototype.forEach
    >;
    TypedArrayPrototypeIndexOf: UncurryThis<
        typeof Uint8Array.prototype.indexOf
    >;
    TypedArrayPrototypeJoin: UncurryThis<
        typeof Uint8Array.prototype.join
    >;
    TypedArrayPrototypeLastIndexOf: UncurryThis<
        typeof Uint8Array.prototype.lastIndexOf
    >;
    TypedArrayPrototypeMap: UncurryThis<
        typeof Uint8Array.prototype.map
    >;
    TypedArrayPrototypeReduce: UncurryThis<
        typeof Uint8Array.prototype.reduce
    >;
    TypedArrayPrototypeReduceRight: UncurryThis<
        typeof Uint8Array.prototype.reduceRight
    >;
    TypedArrayPrototypeReverse: UncurryThis<
        typeof Uint8Array.prototype.reverse
    >;
    TypedArrayPrototypeSet: UncurryThis<
        typeof Uint8Array.prototype.set
    >;
    TypedArrayPrototypeSlice: UncurryThis<
        typeof Uint8Array.prototype.slice
    >;
    TypedArrayPrototypeSome: UncurryThis<
        typeof Uint8Array.prototype.some
    >;
    TypedArrayPrototypeSort: UncurryThis<
        typeof Uint8Array.prototype.sort
    >;
    TypedArrayPrototypeSubarray: UncurryThis<
        typeof Uint8Array.prototype.subarray
    >;
    TypedArrayPrototypeToLocaleString: UncurryThis<
        typeof Uint8Array.prototype.toLocaleString
    >;
    TypedArrayPrototypeToString: UncurryThis<
        typeof Uint8Array.prototype.toString
    >;
    TypedArrayPrototypeValueOf: UncurryThis<
        typeof Uint8Array.prototype.valueOf
    >;
    URIError: typeof globalThis.URIError;
    URIErrorLength: typeof URIError.length;
    URIErrorName: typeof URIError.name;
    URIErrorPrototype: typeof URIError.prototype;
    Uint16Array: typeof globalThis.Uint16Array;
    Uint16ArrayLength: typeof Uint16Array.length;
    Uint16ArrayName: typeof Uint16Array.name;
    Uint16ArrayPrototype: typeof Uint16Array.prototype;
    Uint16ArrayBYTES_PER_ELEMENT:
        typeof Uint16Array.BYTES_PER_ELEMENT;
    Uint32Array: typeof globalThis.Uint32Array;
    Uint32ArrayLength: typeof Uint32Array.length;
    Uint32ArrayName: typeof Uint32Array.name;
    Uint32ArrayPrototype: typeof Uint32Array.prototype;
    Uint32ArrayBYTES_PER_ELEMENT:
        typeof Uint32Array.BYTES_PER_ELEMENT;
    Uint8Array: typeof globalThis.Uint8Array;
    Uint8ArrayLength: typeof Uint8Array.length;
    Uint8ArrayName: typeof Uint8Array.name;
    Uint8ArrayPrototype: typeof Uint8Array.prototype;
    Uint8ArrayBYTES_PER_ELEMENT:
        typeof Uint8Array.BYTES_PER_ELEMENT;
    Uint8ClampedArray: typeof globalThis.Uint8ClampedArray;
    Uint8ClampedArrayLength: typeof Uint8ClampedArray.length;
    Uint8ClampedArrayName: typeof Uint8ClampedArray.name;
    Uint8ClampedArrayPrototype: typeof Uint8ClampedArray.prototype;
    Uint8ClampedArrayBYTES_PER_ELEMENT:
        typeof Uint8ClampedArray.BYTES_PER_ELEMENT;
    WeakMap: typeof globalThis.WeakMap;
    WeakMapLength: typeof WeakMap.length;
    WeakMapName: typeof WeakMap.name;
    WeakMapPrototype: typeof WeakMap.prototype;
    WeakMapPrototypeDelete: UncurryThis<
        typeof WeakMap.prototype.delete
    >;
    WeakMapPrototypeGet: UncurryThis<typeof WeakMap.prototype.get>;
    WeakMapPrototypeSet: UncurryThis<typeof WeakMap.prototype.set>;
    WeakMapPrototypeHas: UncurryThis<typeof WeakMap.prototype.has>;
    WeakSet: typeof globalThis.WeakSet;
    WeakSetLength: typeof WeakSet.length;
    WeakSetName: typeof WeakSet.name;
    WeakSetPrototype: typeof WeakSet.prototype;
    WeakSetPrototypeDelete: UncurryThis<
        typeof WeakSet.prototype.delete
    >;
    WeakSetPrototypeHas: UncurryThis<typeof WeakSet.prototype.has>;
    WeakSetPrototypeAdd: UncurryThis<typeof WeakSet.prototype.add>;
    Promise: typeof globalThis.Promise;
    PromiseLength: typeof Promise.length;
    PromiseName: typeof Promise.name;
    PromisePrototype: typeof Promise.prototype;
    PromiseAll: typeof Promise.all;
    PromiseRace: typeof Promise.race;
    PromiseResolve: typeof Promise.resolve;
    PromiseReject: typeof Promise.reject;
    PromiseAllSettled: typeof Promise.allSettled;
    PromiseAny: typeof Promise.any;
    PromisePrototypeThen: UncurryThis<
        typeof Promise.prototype.then
    >;
    PromisePrototypeCatch: UncurryThis<
        typeof Promise.prototype.catch
    >;
    PromisePrototypeFinally: UncurryThis<
        typeof Promise.prototype.finally
    >;
}