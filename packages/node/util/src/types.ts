// util.types module — native type checking, replaces npm is-* packages

export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

export function isMap(value: unknown): value is Map<any, any> {
  return value instanceof Map;
}

export function isSet(value: unknown): value is Set<any> {
  return value instanceof Set;
}

export function isWeakMap(value: unknown): value is WeakMap<any, any> {
  return value instanceof WeakMap;
}

export function isWeakSet(value: unknown): value is WeakSet<any> {
  return value instanceof WeakSet;
}

export function isPromise(value: unknown): value is Promise<any> {
  return value instanceof Promise;
}

export function isGeneratorFunction(value: unknown): boolean {
  if (typeof value !== 'function') return false;
  const constructor = value.constructor;
  if (!constructor) return false;
  return constructor.name === 'GeneratorFunction' || constructor.name === 'AsyncGeneratorFunction';
}

export function isGeneratorObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  if (!proto) return false;
  const ctor = proto.constructor;
  if (!ctor) return false;
  return ctor.name === 'GeneratorFunction' || ctor.name === 'AsyncGeneratorFunction';
}

export function isAsyncFunction(value: unknown): boolean {
  if (typeof value !== 'function') return false;
  return value.constructor?.name === 'AsyncFunction';
}

export function isTypedArray(value: unknown): boolean {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function isUint16Array(value: unknown): value is Uint16Array {
  return value instanceof Uint16Array;
}

export function isUint32Array(value: unknown): value is Uint32Array {
  return value instanceof Uint32Array;
}

export function isInt8Array(value: unknown): value is Int8Array {
  return value instanceof Int8Array;
}

export function isInt16Array(value: unknown): value is Int16Array {
  return value instanceof Int16Array;
}

export function isInt32Array(value: unknown): value is Int32Array {
  return value instanceof Int32Array;
}

export function isFloat32Array(value: unknown): value is Float32Array {
  return value instanceof Float32Array;
}

export function isFloat64Array(value: unknown): value is Float64Array {
  return value instanceof Float64Array;
}

export function isBigInt64Array(value: unknown): value is BigInt64Array {
  return value instanceof BigInt64Array;
}

export function isBigUint64Array(value: unknown): value is BigUint64Array {
  return value instanceof BigUint64Array;
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

export function isDataView(value: unknown): value is DataView {
  return value instanceof DataView;
}

export function isNativeError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isMapIterator(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  // Check for the Map Iterator prototype
  const mapIterProto = Object.getPrototypeOf(new Map()[Symbol.iterator]());
  return proto === mapIterProto;
}

export function isSetIterator(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  const setIterProto = Object.getPrototypeOf(new Set()[Symbol.iterator]());
  return proto === setIterProto;
}

export function isStringObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && value instanceof String;
}

export function isNumberObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && value instanceof Number;
}

export function isBooleanObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && value instanceof Boolean;
}

export function isSymbolObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.toString.call(value) === '[object Symbol]';
}

export function isArgumentsObject(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object Arguments]';
}

export function isBoxedPrimitive(value: unknown): boolean {
  return isStringObject(value) || isNumberObject(value) || isBooleanObject(value) || isSymbolObject(value);
}
