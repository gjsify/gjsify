// SPDX-License-Identifier: MIT
// @gjsify/napi — minimal value surface for the P0.0 load gate.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT)
// for per-function argument checks, status codes and string semantics
// (napi_get_value_string_utf8: cc:2558-2568 WriteUtf8V2 kReplaceInvalidUtf8).
// Reimplemented for GJS/SpiderMonkey via JSAPI.

#include "common.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include <mozilla/Maybe.h>
#include <mozilla/Span.h>

napi_status NAPI_CDECL napi_get_undefined(napi_env env, napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::arena_push(env, JS::UndefinedValue());
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_null(napi_env env, napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::arena_push(env, JS::NullValue());
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_boolean(napi_env env, bool value,
                                        napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::arena_push(env, JS::BooleanValue(value));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_global(napi_env env, napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    // The realm global captured at env creation (Node: context()->Global()).
    JSObject* global = env->global;
    if (global == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*global));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_object(napi_env env, napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JSObject* obj = JS_NewPlainObject(env->cx);
    if (obj == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*obj));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_string_utf8(napi_env env, const char* str,
                                               size_t length,
                                               napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, str != nullptr, napi_invalid_arg);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, length == NAPI_AUTO_LENGTH || length <= INT32_MAX,
        napi_invalid_arg);
    const size_t len = (length == NAPI_AUTO_LENGTH) ? strlen(str) : length;
    JSString* js_str =
        JS_NewStringCopyUTF8N(env->cx, JS::UTF8Chars(str, len));
    if (js_str == nullptr) {
        // Invalid UTF-8 or OOM sets a pending exception; the create_* class
        // has no preamble, so surface as generic failure and clear the
        // engine state (Node's V8 path replaces invalid sequences lossily
        // and never throws here — parity item for P0.2's string slice).
        if (JS_IsExceptionPending(env->cx)) {
            JS_ClearPendingException(env->cx);
        }
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::StringValue(js_str));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_string_utf8(napi_env env,
                                                  napi_value value, char* buf,
                                                  size_t bufsize,
                                                  size_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isString(), napi_string_expected);
    JSString* str = v.toString();

    if (buf == nullptr) {
        // Query: UTF-8 byte length, excluding the NUL terminator.
        GJSIFY_NAPI_CHECK_ARG(env, result);
        JSLinearString* linear = JS_EnsureLinearString(env->cx, str);
        if (linear == nullptr) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        *result = JS::GetDeflatedUTF8StringLength(linear);
    } else if (bufsize != 0) {
        // Write at most bufsize-1 bytes + NUL, truncating at code-point
        // boundaries, lone surrogates → U+FFFD. Node semantics
        // (WriteUtf8V2 kReplaceInvalidUtf8 | kNullTerminate) match
        // JS_EncodeStringToUTF8BufferPartial (TextEncoder.encodeInto).
        mozilla::Maybe<std::tuple<size_t, size_t>> encoded =
            JS_EncodeStringToUTF8BufferPartial(
                env->cx, str, mozilla::Span<char>(buf, bufsize - 1));
        if (encoded.isNothing()) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        const size_t written = std::get<1>(*encoded);
        buf[written] = '\0';
        if (result != nullptr) {
            *result = written;
        }
    } else if (result != nullptr) {
        *result = 0;
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_set_named_property(napi_env env, napi_value object,
                                               const char* utf8name,
                                               napi_value value) {
    GJSIFY_NAPI_PREAMBLE(env);  // property sets can run JS (setters/proxies)
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, utf8name);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    JS::Value target = gjsify_napi::napi_value_to_js(object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, target.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &target.toObject());
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    if (!JS_SetProperty(env->cx, obj, utf8name, v)) {
        // §6 must-not-abort contract: a JS throw stays pending; a false
        // return without a pending exception (OOM/over-recursion) is the SM
        // analog of V8 termination.
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    return napi_ok;  // preamble already cleared last_error
}

napi_status NAPI_CDECL napi_get_named_property(napi_env env, napi_value object,
                                               const char* utf8name,
                                               napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);  // property gets can run JS (getters/proxies)
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, utf8name);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value target = gjsify_napi::napi_value_to_js(object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, target.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &target.toObject());
    JS::RootedValue v(env->cx);
    if (!JS_GetProperty(env->cx, obj, utf8name, &v)) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, v);
    return napi_ok;
}

// ---- number create (js_native_api_v8.cc: plain CHECK_ENV/ARG, no
// preamble — number creation cannot run JS) ----

napi_status NAPI_CDECL napi_create_double(napi_env env, double value,
                                          napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::arena_push(env, JS::NumberValue(value));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_int32(napi_env env, int32_t value,
                                         napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::arena_push(env, JS::Int32Value(value));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_uint32(napi_env env, uint32_t value,
                                          napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::arena_push(env, JS::NumberValue(value));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_int64(napi_env env, int64_t value,
                                         napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    // Node: v8::Number::New(double) — precision loss beyond 2^53 is the
    // documented napi_create_int64 behavior.
    *result = gjsify_napi::arena_push(
        env, JS::NumberValue(static_cast<double>(value)));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_bigint_int64(napi_env env, int64_t value,
                                                napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    // Public wrapper over JS::detail::BigIntFromInt64 (js/BigInt.h:124-127).
    JS::BigInt* bi = JS::NumberToBigInt(env->cx, value);
    if (bi == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::BigIntValue(bi));
    return gjsify_napi::clear_last_error(env);
}

// ---- number extract (exact V8-Node truncation semantics) ----

napi_status NAPI_CDECL napi_get_value_double(napi_env env, napi_value value,
                                             double* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isNumber(),
                                       napi_number_expected);
    *result = v.toNumber();
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_int32(napi_env env, napi_value value,
                                            int32_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    if (v.isInt32()) {
        *result = v.toInt32();
    } else {
        GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isNumber(),
                                           napi_number_expected);
        // ECMA ToInt32 on the double: modulo 2^32, NaN/±Inf → 0 — exactly
        // V8's Int32Value (js_native_api_v8.cc:2340-2360).
        *result = JS::ToInt32(v.toDouble());
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_uint32(napi_env env, napi_value value,
                                             uint32_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    if (v.isInt32()) {
        *result = static_cast<uint32_t>(v.toInt32());
    } else {
        GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isNumber(),
                                           napi_number_expected);
        *result = JS::ToUint32(v.toDouble());  // ECMA ToUint32
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_int64(napi_env env, napi_value value,
                                            int64_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    if (v.isInt32()) {
        *result = v.toInt32();
        return gjsify_napi::clear_last_error(env);
    }
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isNumber(),
                                       napi_number_expected);
    // V8-Node semantics (js_native_api_v8.cc:2383-2413): NaN/±Inf → 0
    // (special-cased), finite → v8 IntegerValue = truncate toward zero,
    // SATURATING at the int64 range (not ECMA-modular like JS::ToInt64).
    const double d = v.toDouble();
    if (!std::isfinite(d)) {
        *result = 0;
    } else if (d >= static_cast<double>(INT64_MAX)) {
        *result = INT64_MAX;
    } else if (d <= static_cast<double>(INT64_MIN)) {
        *result = INT64_MIN;
    } else {
        *result = static_cast<int64_t>(d);
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_bool(napi_env env, napi_value value,
                                           bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isBoolean(),
                                       napi_boolean_expected);
    *result = v.toBoolean();
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_bigint_int64(napi_env env,
                                                   napi_value value,
                                                   int64_t* result,
                                                   bool* lossless) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_CHECK_ARG(env, lossless);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isBigInt(),
                                       napi_bigint_expected);
    JS::BigInt* bi = v.toBigInt();
    // Public wrapper over JS::detail::BigIntIsInt64 (js/BigInt.h:208).
    if (JS::BigIntFits(bi, result)) {
        *lossless = true;
    } else {
        // v8::BigInt::Int64Value: two's-complement truncation, lossless=false.
        *lossless = false;
        *result = JS::ToBigInt64(bi);
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- more string creates (§8 exact Node semantics) ----

napi_status NAPI_CDECL napi_create_string_latin1(napi_env env, const char* str,
                                                 size_t length,
                                                 napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, str != nullptr || length == 0, napi_invalid_arg);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, length == NAPI_AUTO_LENGTH || length <= INT32_MAX,
        napi_invalid_arg);
    const size_t len = (length == NAPI_AUTO_LENGTH) ? strlen(str) : length;
    // Narrow copy = Latin-1 storage in SpiderMonkey (js/String.h:63) —
    // exactly the byte-preserving semantic v8::String::NewFromOneByte has.
    JSString* js_str = JS_NewStringCopyN(env->cx, str, len);
    if (js_str == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::StringValue(js_str));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_string_utf16(napi_env env,
                                                const char16_t* str,
                                                size_t length,
                                                napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, str != nullptr || length == 0, napi_invalid_arg);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, length == NAPI_AUTO_LENGTH || length <= INT32_MAX,
        napi_invalid_arg);
    const size_t len = (length == NAPI_AUTO_LENGTH)
                           ? std::char_traits<char16_t>::length(str)
                           : length;
    JSString* js_str = JS_NewUCStringCopyN(env->cx, str, len);
    if (js_str == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::StringValue(js_str));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_symbol(napi_env env, napi_value description,
                                          napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedString desc(env->cx);
    if (description != nullptr) {
        JS::Value d = gjsify_napi::napi_value_to_js(description);
        GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, d.isString(),
                                           napi_string_expected);
        desc = d.toString();
    }
    JS::Symbol* sym = JS::NewSymbol(env->cx, desc);
    if (sym == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::SymbolValue(sym));
    return gjsify_napi::clear_last_error(env);
}

// ---- more string extracts (exact Node write/NUL/length semantics,
// js_native_api_v8.cc:2508-2536 latin1, 2584-2617 utf16) ----

napi_status NAPI_CDECL napi_get_value_string_latin1(napi_env env,
                                                    napi_value value,
                                                    char* buf, size_t bufsize,
                                                    size_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isString(),
                                       napi_string_expected);
    JSString* str = v.toString();

    if (buf == nullptr) {
        GJSIFY_NAPI_CHECK_ARG(env, result);
        *result = JS_GetStringLength(str);  // code units, like str->Length()
    } else if (bufsize != 0) {
        const size_t length =
            std::min(bufsize - 1, JS_GetStringLength(str));
        JSLinearString* linear = JS_EnsureLinearString(env->cx, str);
        if (linear == nullptr) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        {
            JS::AutoCheckCannotGC nogc;
            if (JS::LinearStringHasLatin1Chars(linear)) {
                const JS::Latin1Char* chars =
                    JS::GetLatin1LinearStringChars(nogc, linear);
                memcpy(buf, chars, length);
            } else {
                // WriteOneByteV2 semantics: UTF-16 units truncated to the
                // low byte.
                const char16_t* chars =
                    JS::GetTwoByteLinearStringChars(nogc, linear);
                for (size_t i = 0; i < length; i++) {
                    buf[i] = static_cast<char>(chars[i] & 0xFF);
                }
            }
        }
        buf[length] = '\0';
        if (result != nullptr) {
            *result = length;
        }
    } else if (result != nullptr) {
        *result = 0;
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_value_string_utf16(napi_env env,
                                                   napi_value value,
                                                   char16_t* buf,
                                                   size_t bufsize,
                                                   size_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isString(),
                                       napi_string_expected);
    JSString* str = v.toString();

    if (buf == nullptr) {
        GJSIFY_NAPI_CHECK_ARG(env, result);
        *result = JS_GetStringLength(str);  // 2-byte code units
    } else if (bufsize != 0) {
        const size_t length =
            std::min(bufsize - 1, JS_GetStringLength(str));
        JSLinearString* linear = JS_EnsureLinearString(env->cx, str);
        if (linear == nullptr) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        {
            JS::AutoCheckCannotGC nogc;
            if (JS::LinearStringHasLatin1Chars(linear)) {
                const JS::Latin1Char* chars =
                    JS::GetLatin1LinearStringChars(nogc, linear);
                for (size_t i = 0; i < length; i++) {
                    buf[i] = static_cast<char16_t>(chars[i]);
                }
            } else {
                const char16_t* chars =
                    JS::GetTwoByteLinearStringChars(nogc, linear);
                memcpy(buf, chars, length * sizeof(char16_t));
            }
        }
        buf[length] = u'\0';
        if (result != nullptr) {
            *result = length;
        }
    } else if (result != nullptr) {
        *result = 0;
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- coercions (NAPI_PREAMBLE like Node — all but ToBoolean can run JS,
// js_native_api_v8.cc:2619-2651) ----

napi_status NAPI_CDECL napi_coerce_to_bool(napi_env env, napi_value value,
                                           napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    *result =
        gjsify_napi::arena_push(env, JS::BooleanValue(JS::ToBoolean(v)));
    return napi_ok;  // preamble already cleared last_error
}

napi_status NAPI_CDECL napi_coerce_to_number(napi_env env, napi_value value,
                                             napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    double d;
    if (!JS::ToNumber(env->cx, v, &d)) {
        // valueOf/toString threw, or ToNumber(symbol/bigint) TypeError.
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::NumberValue(d));
    return napi_ok;
}

napi_status NAPI_CDECL napi_coerce_to_object(napi_env env, napi_value value,
                                             napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    JSObject* obj = JS::ToObject(env->cx, v);
    if (obj == nullptr) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*obj));
    return napi_ok;
}

napi_status NAPI_CDECL napi_coerce_to_string(napi_env env, napi_value value,
                                             napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    JSString* str = JS::ToString(env->cx, v);
    if (str == nullptr) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::StringValue(str));
    return napi_ok;
}

napi_status NAPI_CDECL napi_typeof(napi_env env, napi_value value,
                                   napi_valuetype* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    if (v.isNumber()) {
        *result = napi_number;
    } else if (v.isBigInt()) {
        *result = napi_bigint;
    } else if (v.isString()) {
        *result = napi_string;
    } else if (v.isBoolean()) {
        *result = napi_boolean;
    } else if (v.isUndefined()) {
        *result = napi_undefined;
    } else if (v.isSymbol()) {
        *result = napi_symbol;
    } else if (v.isNull()) {
        *result = napi_null;
    } else if (v.isObject()) {
        // napi_external joins in P0.3 with the external JSClass.
        *result = JS::IsCallable(&v.toObject()) ? napi_function : napi_object;
    } else {
        // Mirror the V8 impl's defensive default (js_native_api_v8.cc).
        return gjsify_napi::set_last_error(env, napi_invalid_arg);
    }
    return gjsify_napi::clear_last_error(env);
}
