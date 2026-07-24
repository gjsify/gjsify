// SPDX-License-Identifier: MIT
// @gjsify/napi — buffers, arraybuffers, typed arrays, dataviews, promises,
// dates, bigint uint64 (P0.4).
//
// Reference: refs/node/src/{js_native_api_v8.cc,node_api.cc} (Node.js
// contributors, MIT) for per-function argument checks + status codes; realized
// over JSAPI.
//
// §5f — THE moving-GC data-pointer trap (the "works in the demo, corrupts in
// production" bug): SpiderMonkey stores SMALL ArrayBuffer contents INLINE in
// the movable GC cell, so a naive data pointer silently goes stale when a GC
// relocates the owning object — while the buffer is still alive. V8 never does
// this (out-of-line backing stores), so addons assume stability. Two
// mitigations, applied here:
//   1. Buffers WE create (napi_create_buffer(_copy), napi_create_arraybuffer)
//      always get malloc'd, OUT-OF-LINE contents via
//      JS::NewArrayBufferWithContents — inherently stable across GC.
//   2. For FOREIGN views (created in JS, possibly inline), every
//      napi_get_*_info pins the contents out-of-line with
//      JS::EnsureNonInlineArrayBufferOrView (js/experimental/TypedData.h:308,
//      confirmed present in mozjs-140) BEFORE handing out any pointer.
// Zero-copy external buffers ride JS::NewExternalArrayBuffer; the SM free
// callback must not call GC-capable JSAPI (js/ArrayBuffer.h), so the user's
// napi_finalize runs later on the loop via the §5b/§5c Reference death path
// (Node runs Buffer finalizers on the loop too, not in the GC free callback).

#include "common.h"

#include <js/ArrayBuffer.h>
#include <js/Date.h>
#include <js/Promise.h>
#include <js/ScalarType.h>
#include <js/experimental/TypedData.h>

#include <mozilla/UniquePtr.h>

#include <cstring>
#include <utility>

namespace gjsify_napi {

// ---- shared helpers ----

// Re-parent a freshly created Uint8Array to globalThis.Buffer.prototype when
// gjsify's Buffer (a Uint8Array subclass) is installed, so JS-side
// Buffer.isBuffer holds on the result. No-op (plain Uint8Array) when Buffer is
// absent. Never fails the caller — a hiccup just leaves the plain prototype.
static void adopt_buffer_prototype(napi_env env, JS::HandleObject view) {
    if (env->global == nullptr) {
        return;
    }
    JS::RootedObject g(env->cx, env->global);
    JS::RootedValue buffer_ctor(env->cx);
    if (!JS_GetProperty(env->cx, g, "Buffer", &buffer_ctor)) {
        JS_ClearPendingException(env->cx);
        return;
    }
    if (!buffer_ctor.isObject()) {
        return;
    }
    JS::RootedObject ctor(env->cx, &buffer_ctor.toObject());
    JS::RootedValue proto_v(env->cx);
    if (!JS_GetProperty(env->cx, ctor, "prototype", &proto_v)) {
        JS_ClearPendingException(env->cx);
        return;
    }
    if (!proto_v.isObject()) {
        return;
    }
    JS::RootedObject proto(env->cx, &proto_v.toObject());
    if (!JS_SetPrototype(env->cx, view, proto)) {
        JS_ClearPendingException(env->cx);
    }
}

// Create an ArrayBuffer whose contents are malloc'd and OUT-OF-LINE (§5f
// stability), zero-filled (v8::ArrayBuffer::New parity). Returns nullptr on
// OOM (caller sets last_error). *out_data receives the stable backing pointer
// (nullptr for a zero-length buffer). The explicit-void*+CallerMustFreeMemory
// overload makes ownership unambiguous: transferred iff a buffer is returned.
static JSObject* new_stable_arraybuffer(napi_env env, size_t length,
                                        void** out_data) {
    void* contents = nullptr;
    if (length > 0) {
        contents = js_calloc(length);
        if (contents == nullptr) {
            return nullptr;
        }
    }
    JSObject* ab = JS::NewArrayBufferWithContents(
        env->cx, length, contents,
        JS::NewArrayBufferOutOfMemory::CallerMustFreeMemory);
    if (ab == nullptr) {
        js_free(contents);  // ownership NOT transferred on failure
        return nullptr;
    }
    if (out_data != nullptr) {
        *out_data = contents;
    }
    return ab;
}

// Wrap a (rooted) stable-contents ArrayBuffer as a Node Buffer: a full-length
// Uint8Array view with globalThis.Buffer.prototype.
static napi_status finish_buffer(napi_env env, JS::HandleObject ab,
                                 void* backing, void** out_data,
                                 napi_value* result) {
    JSObject* view = JS_NewUint8ArrayWithBuffer(env->cx, ab, 0, -1);
    if (view == nullptr) {
        return set_last_error(env, napi_generic_failure);
    }
    JS::RootedObject view_r(env->cx, view);
    adopt_buffer_prototype(env, view_r);
    if (out_data != nullptr) {
        *out_data = backing;
    }
    *result = arena_push(env, JS::ObjectValue(*view_r));
    return napi_ok;
}

// The external-buffer free callback: MUST NOT call GC-capable JSAPI and may run
// on any thread (js/ArrayBuffer.h). It frees NOTHING — the user's data is owned
// by the user and released by their napi_finalize on the loop (see the file
// header). SM merely drops its reference to the contents when the buffer dies.
static void external_buffer_noop_free(void* /* contents */, void* /* user */) {}

// JS::Scalar::Type → napi_typedarray_type (js_native_api_v8.cc get-info order).
static napi_typedarray_type scalar_to_napi(JS::Scalar::Type type) {
    switch (type) {
        case JS::Scalar::Int8:
            return napi_int8_array;
        case JS::Scalar::Uint8:
            return napi_uint8_array;
        case JS::Scalar::Uint8Clamped:
            return napi_uint8_clamped_array;
        case JS::Scalar::Int16:
            return napi_int16_array;
        case JS::Scalar::Uint16:
            return napi_uint16_array;
        case JS::Scalar::Int32:
            return napi_int32_array;
        case JS::Scalar::Uint32:
            return napi_uint32_array;
        case JS::Scalar::Float32:
            return napi_float32_array;
        case JS::Scalar::Float64:
            return napi_float64_array;
        case JS::Scalar::BigInt64:
            return napi_bigint64_array;
        case JS::Scalar::BigUint64:
            return napi_biguint64_array;
        case JS::Scalar::Float16:
            return napi_float16_array;
        default:
            return napi_uint8_array;  // unreachable for a real typed array
    }
}

}  // namespace gjsify_napi

// ---- node::Buffer slice (node_api.cc:1055-1160) ----

napi_status NAPI_CDECL napi_create_buffer(napi_env env, size_t length,
                                          void** data, napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    void* backing = nullptr;
    JS::RootedObject ab(env->cx,
                        gjsify_napi::new_stable_arraybuffer(env, length,
                                                            &backing));
    if (!ab) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    return gjsify_napi::finish_buffer(env, ab, backing, data, result);
}

napi_status NAPI_CDECL napi_create_buffer_copy(napi_env env, size_t length,
                                               const void* data,
                                               void** result_data,
                                               napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    void* backing = nullptr;
    JS::RootedObject ab(env->cx,
                        gjsify_napi::new_stable_arraybuffer(env, length,
                                                            &backing));
    if (!ab) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    if (length > 0 && data != nullptr) {
        memcpy(backing, data, length);  // independent copy (own backing)
    }
    return gjsify_napi::finish_buffer(env, ab, backing, result_data, result);
}

napi_status NAPI_CDECL napi_create_external_buffer(
    napi_env env, size_t length, void* data,
    node_api_basic_finalize basic_finalize_cb, void* finalize_hint,
    napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    auto finalize_cb = reinterpret_cast<napi_finalize>(basic_finalize_cb);
    // Zero-copy external ArrayBuffer over the user's data. The SM deleter frees
    // nothing (external_buffer_noop_free) — the user's finalize_cb owns the
    // data and runs on the loop via the Reference death path below.
    mozilla::UniquePtr<void, JS::BufferContentsDeleter> contents(
        data, JS::BufferContentsDeleter(
                  gjsify_napi::external_buffer_noop_free, nullptr));
    JS::RootedObject ab(
        env->cx,
        JS::NewExternalArrayBuffer(env->cx, length, std::move(contents)));
    if (!ab) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    JSObject* view = JS_NewUint8ArrayWithBuffer(env->cx, ab, 0, -1);
    if (view == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    JS::RootedObject view_r(env->cx, view);
    gjsify_napi::adopt_buffer_prototype(env, view_r);
    if (finalize_cb != nullptr) {
        // kRuntime weak refcount-0 ReferenceWithFinalizer on the Buffer object
        // — the uniform §5b weak-sweep + §5c drain runs the user callback on
        // the loop when the buffer becomes unreachable.
        JS::RootedValue view_v(env->cx, JS::ObjectValue(*view_r));
        gjsify_napi::Reference::New(env, view_v, 0,
                                    gjsify_napi::ReferenceOwnership::kRuntime,
                                    finalize_cb, data, finalize_hint);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*view_r));
    return napi_ok;
}

napi_status NAPI_CDECL napi_is_buffer(napi_env env, napi_value value,
                                      bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    // node::Buffer::HasInstance == IsUint8Array (gjsify's Buffer is a Uint8Array
    // subclass, so both real Buffers and plain Uint8Arrays qualify, matching
    // Node). GetArrayBufferViewType's IsArrayBufferView precondition is met by
    // the short-circuited JS_IsTypedArrayObject check.
    *result = v.isObject() && JS_IsTypedArrayObject(&v.toObject()) &&
              JS_GetArrayBufferViewType(&v.toObject()) == JS::Scalar::Uint8;
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_buffer_info(napi_env env, napi_value value,
                                            void** data, size_t* length) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env,
        v.isObject() && JS_IsTypedArrayObject(&v.toObject()) &&
            JS_GetArrayBufferViewType(&v.toObject()) == JS::Scalar::Uint8,
        napi_invalid_arg);
    JS::RootedObject obj(env->cx, &v.toObject());
    // §5f: pin the contents out-of-line before handing out the pointer.
    if (!JS::EnsureNonInlineArrayBufferOrView(env->cx, obj)) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    if (length != nullptr) {
        *length = JS_GetArrayBufferViewByteLength(obj);
    }
    if (data != nullptr) {
        JS::AutoCheckCannotGC nogc;
        bool shared = false;
        *data = JS_GetArrayBufferViewData(obj, &shared, nogc);
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- ArrayBuffer (js_native_api_v8.cc) ----

napi_status NAPI_CDECL napi_is_arraybuffer(napi_env env, napi_value value,
                                           bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    *result = v.isObject() && JS::IsArrayBufferObject(&v.toObject());
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_arraybuffer(napi_env env, size_t byte_length,
                                               void** data,
                                               napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    void* backing = nullptr;
    JS::RootedObject ab(env->cx,
                        gjsify_napi::new_stable_arraybuffer(env, byte_length,
                                                            &backing));
    if (!ab) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    if (data != nullptr) {
        *data = backing;
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*ab));
    return napi_ok;
}

napi_status NAPI_CDECL napi_get_arraybuffer_info(napi_env env,
                                                 napi_value arraybuffer,
                                                 void** data,
                                                 size_t* byte_length) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, arraybuffer);
    JS::Value v = gjsify_napi::napi_value_to_js(arraybuffer);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, v.isObject() && JS::IsArrayBufferObject(&v.toObject()),
        napi_invalid_arg);
    JS::RootedObject obj(env->cx, &v.toObject());
    // §5f: pin out-of-line so the returned pointer survives a moving GC.
    if (!JS::EnsureNonInlineArrayBufferOrView(env->cx, obj)) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    size_t len = 0;
    bool shared = false;
    uint8_t* ptr = nullptr;
    JS::GetArrayBufferLengthAndData(obj, &len, &shared, &ptr);
    if (data != nullptr) {
        *data = ptr;
    }
    if (byte_length != nullptr) {
        *byte_length = len;
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_detach_arraybuffer(napi_env env,
                                               napi_value arraybuffer) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, arraybuffer);
    JS::Value v = gjsify_napi::napi_value_to_js(arraybuffer);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, v.isObject() && JS::IsArrayBufferObject(&v.toObject()),
        napi_arraybuffer_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    // A defined [[ArrayBufferDetachKey]] slot = not detachable (WASM/asm.js) —
    // Node's it->IsDetachable() check → napi_detachable_arraybuffer_expected.
    bool has_detach_key = false;
    if (!JS::HasDefinedArrayBufferDetachKey(env->cx, obj, &has_detach_key)) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, !has_detach_key,
                                       napi_detachable_arraybuffer_expected);
    if (!JS::DetachArrayBuffer(env->cx, obj)) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_is_detached_arraybuffer(napi_env env,
                                                    napi_value arraybuffer,
                                                    bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, arraybuffer);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(arraybuffer);
    *result = v.isObject() && JS::IsArrayBufferObject(&v.toObject()) &&
              JS::IsDetachedArrayBufferObject(&v.toObject());
    return gjsify_napi::clear_last_error(env);
}

// ---- typed arrays (js_native_api_v8.cc) ----

napi_status NAPI_CDECL napi_is_typedarray(napi_env env, napi_value value,
                                          bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    *result = v.isObject() && JS_IsTypedArrayObject(&v.toObject());
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_typedarray(napi_env env,
                                              napi_typedarray_type type,
                                              size_t length,
                                              napi_value arraybuffer,
                                              size_t byte_offset,
                                              napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, arraybuffer);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(arraybuffer);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, v.isObject() && JS::IsArrayBufferObject(&v.toObject()),
        napi_invalid_arg);
    JS::RootedObject buffer(env->cx, &v.toObject());
    const int64_t len = static_cast<int64_t>(length);
    JSObject* ta = nullptr;
    switch (type) {
        case napi_int8_array:
            ta = JS_NewInt8ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_uint8_array:
            ta = JS_NewUint8ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_uint8_clamped_array:
            ta = JS_NewUint8ClampedArrayWithBuffer(env->cx, buffer, byte_offset,
                                                   len);
            break;
        case napi_int16_array:
            ta = JS_NewInt16ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_uint16_array:
            ta = JS_NewUint16ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_int32_array:
            ta = JS_NewInt32ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_uint32_array:
            ta = JS_NewUint32ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_float32_array:
            ta = JS_NewFloat32ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_float64_array:
            ta = JS_NewFloat64ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        case napi_bigint64_array:
            ta = JS_NewBigInt64ArrayWithBuffer(env->cx, buffer, byte_offset,
                                               len);
            break;
        case napi_biguint64_array:
            ta = JS_NewBigUint64ArrayWithBuffer(env->cx, buffer, byte_offset,
                                                len);
            break;
        case napi_float16_array:
            ta = JS_NewFloat16ArrayWithBuffer(env->cx, buffer, byte_offset, len);
            break;
        default:
            return gjsify_napi::set_last_error(env, napi_invalid_arg);
    }
    if (ta == nullptr) {
        // Out-of-range offset/length throws a RangeError (Node's
        // CREATE_TYPED_ARRAY bounds check maps the same way).
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*ta));
    return napi_ok;
}

napi_status NAPI_CDECL napi_get_typedarray_info(napi_env env,
                                                napi_value typedarray,
                                                napi_typedarray_type* type,
                                                size_t* length, void** data,
                                                napi_value* arraybuffer,
                                                size_t* byte_offset) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, typedarray);
    JS::Value v = gjsify_napi::napi_value_to_js(typedarray);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, v.isObject() && JS_IsTypedArrayObject(&v.toObject()),
        napi_invalid_arg);
    JS::RootedObject obj(env->cx, &v.toObject());
    // §5f: pin out-of-line before returning a pointer into the data.
    if (!JS::EnsureNonInlineArrayBufferOrView(env->cx, obj)) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    if (type != nullptr) {
        *type = gjsify_napi::scalar_to_napi(JS_GetArrayBufferViewType(obj));
    }
    if (length != nullptr) {
        *length = JS_GetTypedArrayLength(obj);
    }
    if (byte_offset != nullptr) {
        *byte_offset = JS_GetArrayBufferViewByteOffset(obj);
    }
    if (data != nullptr || arraybuffer != nullptr) {
        // Materializing the buffer object may allocate/GC, so do it BEFORE the
        // no-GC data read (the out-of-line pointer is stable across it).
        bool shared = false;
        JS::RootedObject ab(
            env->cx, JS_GetArrayBufferViewBuffer(env->cx, obj, &shared));
        if (!ab) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        if (arraybuffer != nullptr) {
            *arraybuffer = gjsify_napi::arena_push(env, JS::ObjectValue(*ab));
        }
        if (data != nullptr) {
            JS::AutoCheckCannotGC nogc;
            // The view data pointer already includes the byte offset (= Node's
            // buffer->Data() + array->ByteOffset()).
            *data = JS_GetArrayBufferViewData(obj, &shared, nogc);
        }
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- DataView (js_native_api_v8.cc) ----

napi_status NAPI_CDECL napi_create_dataview(napi_env env, size_t byte_length,
                                            napi_value arraybuffer,
                                            size_t byte_offset,
                                            napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, arraybuffer);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(arraybuffer);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, v.isObject() && JS::IsArrayBufferObject(&v.toObject()),
        napi_invalid_arg);
    JS::RootedObject buffer(env->cx, &v.toObject());
    // Node throws ERR_NAPI_INVALID_DATAVIEW_ARGS on an out-of-range window.
    if (byte_length + byte_offset > JS::GetArrayBufferByteLength(buffer)) {
        napi_throw_range_error(
            env, "ERR_NAPI_INVALID_DATAVIEW_ARGS",
            "byte_offset + byte_length should be less than or equal to the "
            "size in bytes of the array passed in");
        return gjsify_napi::set_last_error(env, napi_pending_exception);
    }
    JSObject* dv = JS_NewDataView(env->cx, buffer, byte_offset, byte_length);
    if (dv == nullptr) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*dv));
    return napi_ok;
}

napi_status NAPI_CDECL napi_is_dataview(napi_env env, napi_value value,
                                        bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    // A DataView is an ArrayBufferView that is not a typed array.
    *result = v.isObject() && JS_IsArrayBufferViewObject(&v.toObject()) &&
              !JS_IsTypedArrayObject(&v.toObject());
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_dataview_info(napi_env env, napi_value dataview,
                                              size_t* bytelength, void** data,
                                              napi_value* arraybuffer,
                                              size_t* byte_offset) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, dataview);
    JS::Value v = gjsify_napi::napi_value_to_js(dataview);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env,
        v.isObject() && JS_IsArrayBufferViewObject(&v.toObject()) &&
            !JS_IsTypedArrayObject(&v.toObject()),
        napi_invalid_arg);
    JS::RootedObject obj(env->cx, &v.toObject());
    if (!JS::EnsureNonInlineArrayBufferOrView(env->cx, obj)) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    if (bytelength != nullptr) {
        *bytelength = JS_GetArrayBufferViewByteLength(obj);
    }
    if (byte_offset != nullptr) {
        *byte_offset = JS_GetArrayBufferViewByteOffset(obj);
    }
    if (data != nullptr || arraybuffer != nullptr) {
        bool shared = false;
        JS::RootedObject ab(
            env->cx, JS_GetArrayBufferViewBuffer(env->cx, obj, &shared));
        if (!ab) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        if (arraybuffer != nullptr) {
            *arraybuffer = gjsify_napi::arena_push(env, JS::ObjectValue(*ab));
        }
        if (data != nullptr) {
            JS::AutoCheckCannotGC nogc;
            *data = JS_GetArrayBufferViewData(obj, &shared, nogc);
        }
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- Promises (js_native_api_v8.cc) ----
//
// SpiderMonkey has no Promise::Resolver object: JS::NewPromiseObject(cx,
// nullptr) creates a promise settled ONLY via JS::ResolvePromise/RejectPromise
// on the promise itself. The napi_deferred is therefore a strong Reference that
// keeps the promise alive until it is concluded; kRuntime so a never-concluded
// deferred drops its root at env teardown (before JS_DestroyContext) rather
// than leaking a live root past context dispose (the UAF class).
//
// A settle is NOT observable synchronously in the same native call — the
// reaction jobs run on GJS's microtask/job queue, which the caller must drain
// (an await or a main-context turn) before the resolved value/reason is seen.

napi_status NAPI_CDECL napi_create_promise(napi_env env, napi_deferred* deferred,
                                           napi_value* promise) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, deferred);
    GJSIFY_NAPI_CHECK_ARG(env, promise);
    JS::RootedObject promise_obj(env->cx,
                                 JS::NewPromiseObject(env->cx, nullptr));
    if (!promise_obj) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    JS::RootedValue promise_v(env->cx, JS::ObjectValue(*promise_obj));
    gjsify_napi::Reference* ref = gjsify_napi::Reference::New(
        env, promise_v, 1, gjsify_napi::ReferenceOwnership::kRuntime);
    *deferred = reinterpret_cast<napi_deferred>(ref);
    *promise = gjsify_napi::arena_push(env, promise_v);
    return napi_ok;
}

namespace gjsify_napi {

static napi_status conclude_deferred(napi_env env, napi_deferred deferred,
                                     napi_value result, bool resolve) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, deferred);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    auto* ref = reinterpret_cast<Reference*>(deferred);
    JS::RootedValue promise_v(env->cx);
    const bool have = ref->GetValue(&promise_v);  // strong: always live
    JS::RootedObject promise(
        env->cx, have && promise_v.isObject() ? &promise_v.toObject()
                                              : nullptr);
    JS::RootedValue resolution(env->cx, napi_value_to_js(result));
    bool ok = promise &&
              (resolve ? JS::ResolvePromise(env->cx, promise, resolution)
                       : JS::RejectPromise(env->cx, promise, resolution));
    // Node deletes the deferred's persistent regardless of settle success; the
    // delete unlinks the kRuntime Reference from the env list (so teardown's
    // FinalizeAll won't revisit it).
    delete ref;
    if (!ok) {
        return set_last_error(env, JS_IsExceptionPending(env->cx)
                                       ? napi_pending_exception
                                       : napi_generic_failure);
    }
    return napi_ok;  // preamble already cleared last_error
}

}  // namespace gjsify_napi

napi_status NAPI_CDECL napi_resolve_deferred(napi_env env,
                                             napi_deferred deferred,
                                             napi_value resolution) {
    return gjsify_napi::conclude_deferred(env, deferred, resolution,
                                          /* resolve = */ true);
}

napi_status NAPI_CDECL napi_reject_deferred(napi_env env, napi_deferred deferred,
                                            napi_value rejection) {
    return gjsify_napi::conclude_deferred(env, deferred, rejection,
                                          /* resolve = */ false);
}

napi_status NAPI_CDECL napi_is_promise(napi_env env, napi_value value,
                                       bool* is_promise) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, is_promise);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    if (v.isObject()) {
        JS::RootedObject obj(env->cx, &v.toObject());
        *is_promise = JS::IsPromiseObject(obj);
    } else {
        *is_promise = false;
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- Dates (js_native_api_v8.cc) ----

napi_status NAPI_CDECL napi_create_date(napi_env env, double time,
                                        napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JSObject* date = JS::NewDateObject(env->cx, JS::TimeClip(time));
    if (date == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*date));
    return napi_ok;
}

napi_status NAPI_CDECL napi_is_date(napi_env env, napi_value value,
                                    bool* is_date) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, is_date);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    bool d = false;
    if (v.isObject()) {
        JS::RootedObject obj(env->cx, &v.toObject());
        if (!JS::ObjectIsDate(env->cx, obj, &d)) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
    }
    *is_date = d;
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_date_value(napi_env env, napi_value value,
                                           double* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    JS::RootedObject obj(env->cx, v.isObject() ? &v.toObject() : nullptr);
    bool is_date = false;
    if (obj) {
        if (!JS::ObjectIsDate(env->cx, obj, &is_date)) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
    }
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, is_date, napi_date_expected);
    // mozjs-140 exposes no public [[DateValue]] getter — Date.prototype.valueOf
    // returns the same time value as v8::Date::ValueOf (NaN for an invalid
    // date).
    JS::RootedValue rval(env->cx);
    if (!JS_CallFunctionName(env->cx, obj, "valueOf",
                             JS::HandleValueArray::empty(), &rval)) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = rval.toNumber();
    return napi_ok;
}

// ---- BigInt uint64 (js_native_api_v8.cc; public JS::BigInt* wrappers) ----

napi_status NAPI_CDECL napi_create_bigint_uint64(napi_env env, uint64_t value,
                                                 napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    // Public wrapper: NumberToBigInt<uint64_t> dispatches to
    // JS::detail::BigIntFromUint64 (js/BigInt.h:35,54-60).
    JS::BigInt* bi = JS::NumberToBigInt(env->cx, value);
    if (bi == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::BigIntValue(bi));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_bigint_uint64(napi_env env,
                                                    napi_value value,
                                                    uint64_t* result,
                                                    bool* lossless) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_CHECK_ARG(env, lossless);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isBigInt(), napi_bigint_expected);
    JS::BigInt* bi = v.toBigInt();
    // BigIntFits<uint64_t> → BigIntIsUint64 (js/BigInt.h). Out of range =
    // v8::BigInt::Uint64Value two's-complement truncation, lossless=false.
    if (JS::BigIntFits(bi, result)) {
        *lossless = true;
    } else {
        *lossless = false;
        *result = JS::ToBigUint64(bi);
    }
    return gjsify_napi::clear_last_error(env);
}
