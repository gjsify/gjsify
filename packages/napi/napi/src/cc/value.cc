// SPDX-License-Identifier: MIT
// @gjsify/napi — minimal value surface for the P0.0 load gate.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT)
// for per-function argument checks, status codes and string semantics
// (napi_get_value_string_utf8: cc:2558-2568 WriteUtf8V2 kReplaceInvalidUtf8).
// Reimplemented for GJS/SpiderMonkey via JSAPI.

#include "common.h"

#include <algorithm>
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
