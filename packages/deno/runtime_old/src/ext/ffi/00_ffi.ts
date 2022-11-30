// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import * as util from '../../runtime/js/06_util.js';

import type {
  PointerValue,
  UnsafeCallbackDefinition,
  UnsafeCallbackFunction,
  ForeignFunction,
  StaticForeignSymbolReturnType,
  ToNativeParameterTypes,
  ForeignLibraryInterface,
  StaticForeignLibraryInterface,
} from '../../types/index.js';

const {
  ObjectDefineProperty,
  ArrayPrototypeMap,
  Number,
  NumberIsSafeInteger,
  ArrayPrototypeJoin,
  ObjectPrototypeIsPrototypeOf,
  TypeError,
  Int32Array,
  Uint32Array,
  BigInt64Array,
  BigUint64Array,
  Function,
} = primordials;

const U32_BUFFER = new Uint32Array(2);
const U64_BUFFER = new BigUint64Array(U32_BUFFER.buffer);
const I64_BUFFER = new BigInt64Array(U32_BUFFER.buffer);

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * An unsafe pointer view to a memory location as specified by the `pointer`
 * value. The `UnsafePointerView` API follows the standard built in interface
 * {@linkcode DataView} for accessing the underlying types at an memory
 * location (numbers, strings and raw bytes).
 *
 * @category FFI
 */
export class UnsafePointerView {
  pointer: PointerValue;

  constructor(pointer: PointerValue) {
    this.pointer = pointer;
  }

  /** Gets a boolean at the specified byte offset from the pointer. */
  getBool(offset: number = 0): boolean {
    return ops.op_ffi_read_bool(
      this.pointer,
      offset,
    );
  }

  /** Gets an unsigned 8-bit integer at the specified byte offset from the
     * pointer. */
  getUint8(offset: number = 0): number {
    return ops.op_ffi_read_u8(
      this.pointer,
      offset,
    );
  }

  /** Gets a signed 8-bit integer at the specified byte offset from the
     * pointer. */
  getInt8(offset: number = 0): number {
    return ops.op_ffi_read_i8(
      this.pointer,
      offset,
    );
  }

  /** Gets an unsigned 16-bit integer at the specified byte offset from the
     * pointer. */
  getUint16(offset: number = 0): number {
    return ops.op_ffi_read_u16(
      this.pointer,
      offset,
    );
  }

  /** Gets a signed 16-bit integer at the specified byte offset from the
     * pointer. */
  getInt16(offset: number = 0): number {
    return ops.op_ffi_read_i16(
      this.pointer,
      offset,
    );
  }

  /** Gets an unsigned 32-bit integer at the specified byte offset from the
     * pointer. */
  getUint32(offset: number = 0): number {
    return ops.op_ffi_read_u32(
      this.pointer,
      offset,
    );
  }

  /** Gets a signed 32-bit integer at the specified byte offset from the
     * pointer. */
  getInt32(offset: number = 0): number {
    return ops.op_ffi_read_i32(
      this.pointer,
      offset,
    );
  }

  /** Gets an unsigned 64-bit integer at the specified byte offset from the
     * pointer. */
  getBigUint64(offset: number = 0): PointerValue {
    ops.op_ffi_read_u64(
      this.pointer,
      offset,
      U32_BUFFER,
    );
    return U64_BUFFER[0];
  }

  /** Gets a signed 64-bit integer at the specified byte offset from the
     * pointer. */
  getBigInt64(offset: number = 0): PointerValue {
    ops.op_ffi_read_i64(
      this.pointer,
      offset,
      U32_BUFFER,
    );
    return I64_BUFFER[0];
  }

  /** Gets a signed 32-bit float at the specified byte offset from the
     * pointer. */
  getFloat32(offset: number = 0): number {
    return ops.op_ffi_read_f32(
      this.pointer,
      offset,
    );
  }

  /** Gets a signed 64-bit float at the specified byte offset from the
     * pointer. */
  getFloat64(offset: number = 0): number {
    return ops.op_ffi_read_f64(
      this.pointer,
      offset,
    );
  }

  /** Gets a C string (`null` terminated string) at the specified byte offset
     * from the pointer. */
  getCString(offset: number = 0): string {
    return ops.op_ffi_cstr_read(
      this.pointer,
      offset,
    );
  }

  /** Gets a C string (`null` terminated string) at the specified byte offset
     * from the specified pointer. */
  static getCString(pointer: PointerValue, offset: number = 0): string {
    return ops.op_ffi_cstr_read(
      pointer,
      offset,
    );
  }

  /** Gets an `ArrayBuffer` of length `byteLength` at the specified byte
     * offset from the pointer. */
  getArrayBuffer(byteLength: number, offset: number = 0): ArrayBuffer {
    return ops.op_ffi_get_buf(
      this.pointer,
      offset,
      byteLength,
    );
  }

  /** Gets an `ArrayBuffer` of length `byteLength` at the specified byte
     * offset from the specified pointer. */
  static getArrayBuffer(pointer: PointerValue, byteLength: number, offset: number = 0): ArrayBuffer {
    return ops.op_ffi_get_buf(
      pointer,
      offset,
      byteLength,
    );
  }

  /** Copies the memory of the pointer into a typed array.
   *
   * Length is determined from the typed array's `byteLength`.
   *
   * Also takes optional byte offset from the pointer. */
  copyInto(destination: BufferSource, offset: number = 0): void {
    ops.op_ffi_buf_copy_into(
      this.pointer,
      offset,
      destination,
      destination.byteLength,
    );
  }

  /** Copies the memory of the specified pointer into a typed array.
   *
   * Length is determined from the typed array's `byteLength`.
   *
   * Also takes optional byte offset from the pointer. */
  static copyInto(pointer: PointerValue, destination, offset: number = 0): void {
    ops.op_ffi_buf_copy_into(
      pointer,
      offset,
      destination,
      destination.byteLength,
    );
  }
}

const OUT_BUFFER = new Uint32Array(2);
const OUT_BUFFER_64 = new BigInt64Array(OUT_BUFFER.buffer);


/** **UNSTABLE**: New API, yet to be vetted.
 *
 * An unsafe pointer to a memory location for passing and returning pointers
 * to and from the FFI.
 *
 * @category FFI
 */
export class UnsafePointer {
  /** Return the direct memory pointer to the typed array in memory. */
  static of(value: UnsafeCallback | BufferSource): PointerValue {
    if (ObjectPrototypeIsPrototypeOf(UnsafeCallbackPrototype, value)) {
      return (value as UnsafeCallback).pointer;
    }
    ops.op_ffi_ptr_of(value, OUT_BUFFER);
    const result = OUT_BUFFER[0] + 2 ** 32 * OUT_BUFFER[1];
    if (NumberIsSafeInteger(result)) {
      return result;
    }
    return OUT_BUFFER_64[0];
  }
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * An unsafe pointer to a function, for calling functions that are not present
 * as symbols.
 *
 * @category FFI
 */
export class UnsafeFnPointer<Fn extends ForeignFunction> {
  /** The pointer to the function. */
  pointer: PointerValue;
  /** The definition of the function. */
  definition: Fn;

  constructor(pointer: PointerValue, definition: Fn) {
    this.pointer = pointer;
    this.definition = definition;
  }

  /** Call the foreign function. */
  call<T extends ForeignFunction>(...parameters: ToNativeParameterTypes<T["parameters"]>): StaticForeignSymbolReturnType<T> {
    if (this.definition.nonblocking) {
      return core.opAsync(
        "op_ffi_call_ptr_nonblocking",
        this.pointer,
        this.definition,
        parameters,
      ) as StaticForeignSymbolReturnType<T>;
    } else {
      return ops.op_ffi_call_ptr(
        this.pointer,
        this.definition,
        parameters,
      ) as StaticForeignSymbolReturnType<T>;
    }
  }
}

function isReturnedAsBigInt(type) {
  return type === "buffer" || type === "pointer" || type === "function" ||
    type === "u64" || type === "i64" ||
    type === "usize" || type === "isize";
}

function isI64(type) {
  return type === "i64" || type === "isize";
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * An unsafe function pointer for passing JavaScript functions as C function
 * pointers to foreign function calls.
 *
 * The function pointer remains valid until the `close()` method is called.
 *
 * The callback can be explicitly referenced via `ref()` and dereferenced via
 * `deref()` to stop Deno's process from exiting.
 *
 * @category FFI
 */
export class UnsafeCallback<
Definition extends UnsafeCallbackDefinition = UnsafeCallbackDefinition,
> {
  #refcount;
  // Internal promise only meant to keep Deno from exiting
  #refpromise;
  #rid;

  /** The pointer to the unsafe callback. */
  pointer: PointerValue;
  /** The definition of the unsafe callback. */
  definition: Definition;
  /** The callback function. */
  callback: UnsafeCallbackFunction<
    Definition["parameters"],
    Definition["result"]
  >;

  constructor(definition: Definition, callback: UnsafeCallbackFunction<
    Definition["parameters"],
    Definition["result"]
  >) {
    // @ts-ignore
    if (definition.nonblocking) {
      throw new TypeError(
        "Invalid UnsafeCallback, cannot be nonblocking",
      );
    }
    const [rid, pointer] = ops.op_ffi_unsafe_callback_create(
      definition,
      callback,
    );
    this.#refcount = 0;
    this.#rid = rid;
    this.pointer = pointer;
    this.definition = definition;
    this.callback = callback;
  }

  /**
   * Adds one to this callback's reference counting and returns the new
   * reference count.
   *
   * If the callback's reference count is non-zero, it will keep Deno's
   * process from exiting.
   */
  ref(): number {
    if (this.#refcount++ === 0) {
      this.#refpromise = core.opAsync(
        "op_ffi_unsafe_callback_ref",
        this.#rid,
      );
    }
    return this.#refcount;
  }

  /**
   * Removes one from this callback's reference counting and returns the new
   * reference count.
   *
   * If the callback's reference counter is zero, it will no longer keep
   * Deno's process from exiting.
   */
  unref(): number {
    // Only decrement refcount if it is positive, and only
    // unref the callback if refcount reaches zero.
    if (this.#refcount > 0 && --this.#refcount === 0) {
      ops.op_ffi_unsafe_callback_unref(this.#rid);
    }
    return this.#refcount;
  }

  /**
   * Removes the C function pointer associated with this instance.
   *
   * Continuing to use the instance after calling this object will lead to
   * errors and crashes.
   *
   * Calling this method will also immediately set the callback's reference
   * counting to zero and it will no longer keep Deno's process from exiting.
   */
  close(): void {
    this.#refcount = 0;
    core.close(this.#rid);
  }
}

const UnsafeCallbackPrototype = UnsafeCallback.prototype;

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A dynamic library resource.  Use {@linkcode Deno.dlopen} to load a dynamic
 * library and return this interface.
 *
 * @category FFI
 */
class DynamicLibrary<S extends ForeignLibraryInterface> {
  #rid: number;
  symbols: StaticForeignLibraryInterface<S> = {} as StaticForeignLibraryInterface<S>;

  constructor(path: string, symbols: S) {
    // @ts-ignore
    [this.#rid, this.symbols] = ops.op_ffi_load({ path, symbols });
    for (const symbol in symbols) {
      if ("type" in symbols[symbol]) {
        // @ts-ignore
        const type = symbols[symbol].type;
        if (type === "void") {
          throw new TypeError(
            "Foreign symbol of type 'void' is not supported.",
          );
        }

        const name = symbols[symbol].name || symbol;
        const value = ops.op_ffi_get_static(
          this.#rid,
          name,
          type,
        );
        ObjectDefineProperty(
          this.symbols,
          symbol,
          {
            configurable: false,
            enumerable: true,
            value,
            writable: false,
          },
        );
        continue;
      }
      // @ts-ignore
      const resultType = symbols[symbol].result;
      const needsUnpacking = isReturnedAsBigInt(resultType);

      // @ts-ignore
      const isNonBlocking = symbols[symbol].nonblocking;
      if (isNonBlocking) {
        ObjectDefineProperty(
          this.symbols,
          symbol,
          {
            configurable: false,
            enumerable: true,
            value: (...parameters) => {
              return core.opAsync(
                "op_ffi_call_nonblocking",
                this.#rid,
                symbol,
                parameters,
              );
            },
            writable: false,
          },
        );
      }

      if (needsUnpacking && !isNonBlocking) {
        const call = this.symbols[symbol];
        // @ts-ignore
        const parameters = symbols[symbol].parameters;
        const vi = new Int32Array(2);
        const vui = new Uint32Array(vi.buffer);
        const b = new BigInt64Array(vi.buffer);

        const params = ArrayPrototypeJoin(
          ArrayPrototypeMap(parameters, (_, index) => `p${index}`),
          ", ",
        );
        // Make sure V8 has no excuse to not optimize this function.
        this.symbols[symbol] = new Function(
          "vi",
          "vui",
          "b",
          "call",
          "NumberIsSafeInteger",
          "Number",
          `return function (${params}) {
          call(${params}${parameters.length > 0 ? ", " : ""}vi);
          ${
            isI64(resultType)
              ? `const n1 = Number(b[0])`
              : `const n1 = vui[0] + 2 ** 32 * vui[1]` // Faster path for u64
          };
          if (NumberIsSafeInteger(n1)) return n1;
          return b[0];
        }`,
        )(vi, vui, b, call, NumberIsSafeInteger, Number);
      }
    }
  }

  close() {
    core.close(this.#rid);
  }
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * Opens an external dynamic library and registers symbols, making foreign
 * functions available to be called.
 *
 * Requires `allow-ffi` permission. Loading foreign dynamic libraries can in
 * theory bypass all of the sandbox permissions. While it is a separate
 * permission users should acknowledge in practice that is effectively the
 * same as running with the `allow-all` permission.
 *
 * An example, given a C library which exports a foreign function named
 * `add()`:
 *
 * ```ts
 * // Determine library extension based on
 * // your OS.
 * let libSuffix = "";
 * switch (Deno.build.os) {
 *   case "windows":
 *     libSuffix = "dll";
 *     break;
 *   case "darwin":
 *     libSuffix = "dylib";
 *     break;
 *   default:
 *     libSuffix = "so";
 *     break;
 * }
 *
 * const libName = `./libadd.${libSuffix}`;
 * // Open library and define exported symbols
 * const dylib = Deno.dlopen(
 *   libName,
 *   {
 *     "add": { parameters: ["isize", "isize"], result: "isize" },
 *   } as const,
 * );
 *
 * // Call the symbol `add`
 * const result = dylib.symbols.add(35, 34); // 69
 *
 * console.log(`Result from external addition of 35 and 34: ${result}`);
 * ```
 *
 * @tags allow-ffi
 * @category FFI
 */
export function dlopen<S extends ForeignLibraryInterface>(path: string | URL, symbols: S) {
  // URL support is progressively enhanced by util in `runtime/js`.
  const pathFromURL = util.pathFromURL ?? ((p) => p as string);
  return new DynamicLibrary(pathFromURL(path), symbols);
}
