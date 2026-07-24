// SPDX-License-Identifier: MIT
// @gjsify/napi — napi_status bookkeeping + exception mapping (§6).
//
// Design: SpiderMonkey's own pending-exception slot IS the env exception
// state — no env-side mirror, no TryCatch dance. V8-Node needs the mirror
// because v8::TryCatch swallows the engine state at each napi boundary and
// rethrows at CallIntoModule exit; on SM a pending exception set on the
// JSContext simply stays there across C calls until cleared.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT) —
// error_messages table (cc:889-914, copied verbatim), napi_get_last_error_info
// (cc:916-939), napi_throw (cc:2219-2229), napi_is_exception_pending
// (cc:3064-3072), napi_get_and_clear_last_exception (cc:3074-3090).

#include "common.h"

#include <cstdio>
#include <cstring>

namespace gjsify_napi {

napi_status set_last_error(napi_env env, napi_status status,
                           uint32_t engine_error_code, void* engine_reserved) {
    env->last_error.error_code = status;
    env->last_error.engine_error_code = engine_error_code;
    env->last_error.engine_reserved = engine_reserved;
    env->last_error.error_message = nullptr;  // filled lazily on request
    return status;
}

napi_status clear_last_error(napi_env env) {
    return set_last_error(env, napi_ok);
}

}  // namespace gjsify_napi

// Copied verbatim from refs/node/src/js_native_api_v8.cc (error_messages).
// Warning: keep in-sync with the napi_status enum.
static const char* error_messages[] = {
    nullptr,
    "Invalid argument",
    "An object was expected",
    "A string was expected",
    "A string or symbol was expected",
    "A function was expected",
    "A number was expected",
    "A boolean was expected",
    "An array was expected",
    "Unknown failure",
    "An exception is pending",
    "The async work item was cancelled",
    "napi_escape_handle already called on scope",
    "Invalid handle scope usage",
    "Invalid callback scope usage",
    "Thread-safe function queue is full",
    "Thread-safe function handle is closing",
    "A bigint was expected",
    "A date was expected",
    "An arraybuffer was expected",
    "A detachable arraybuffer was expected",
    "Main thread would deadlock",
    "External buffers are not allowed",
    "Cannot run JavaScript",
};

napi_status NAPI_CDECL napi_get_last_error_info(
    node_api_basic_env basic_env, const napi_extended_error_info** result) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);

    // Must reference the LAST message in napi_status (no napi_status_last in
    // the ABI — mirror of js_native_api_v8.cc:925-930).
    constexpr int last_status = napi_cannot_run_js;
    static_assert(sizeof(error_messages) / sizeof(*error_messages) ==
                      last_status + 1,
                  "Count of error messages must match count of error values");

    const napi_status code = env->last_error.error_code;
    env->last_error.error_message =
        (code >= 0 && code <= last_status) ? error_messages[code] : nullptr;
    if (code == napi_ok) {
        gjsify_napi::clear_last_error(env);
    }
    *result = &env->last_error;
    return napi_ok;
}

napi_status NAPI_CDECL napi_throw(napi_env env, napi_value error) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, error);
    // ANY value may be thrown, including null/undefined (the contract
    // better-sqlite3 depends on — never normalize, never abort).
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(error));
    JS_SetPendingException(env->cx, v);  // ExceptionStackBehavior::Capture
    return napi_ok;  // preamble already cleared last_error
}

napi_status NAPI_CDECL napi_is_exception_pending(napi_env env, bool* result) {
    // No preamble — must work WHILE an exception is pending.
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = JS_IsExceptionPending(env->cx);
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_and_clear_last_exception(napi_env env,
                                                         napi_value* result) {
    // No preamble — must work WHILE an exception is pending.
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    if (!JS_IsExceptionPending(env->cx)) {
        *result = gjsify_napi::arena_push(env, JS::UndefinedValue());
    } else {
        JS::RootedValue exc(env->cx);
        JS_GetPendingException(env->cx, &exc);
        JS_ClearPendingException(env->cx);
        *result = gjsify_napi::arena_push(env, exc);
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- error construction (§6) ----
//
// The create_* family has NO preamble and must work WHILE an exception is
// pending (better-sqlite3 builds SqliteErrors on error paths). JS::CreateError
// (js/ErrorReport.h:553) constructs the error object directly — no JS runs,
// so pending state is never disturbed.

namespace gjsify_napi {

static napi_status create_error_object(napi_env env, JSExnType type,
                                       napi_value code, napi_value msg,
                                       napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, msg);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value msg_v = napi_value_to_js(msg);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, msg_v.isString(),
                                       napi_string_expected);
    // `code` must be a string when given (set_error_code, cc:2231-2260).
    JS::Value code_v = JS::UndefinedValue();
    if (code != nullptr) {
        code_v = napi_value_to_js(code);
        GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, code_v.isString(),
                                           napi_string_expected);
    }

    JS::RootedString msg_str(env->cx, msg_v.toString());
    JS::RootedObject stack(env->cx);
    // fileName must be a real (empty) string — ErrorObject::create
    // dereferences it (null handle segfaults, mozjs-140 finding).
    JS::RootedString file_name(env->cx, JS_GetEmptyString(env->cx));
    JS::Rooted<mozilla::Maybe<JS::Value>> cause(env->cx, mozilla::Nothing());
    JS::RootedValue error(env->cx);
    if (!JS::CreateError(env->cx, type, stack, file_name, 0,
                         JS::ColumnNumberOneOrigin(), nullptr, msg_str, cause,
                         &error)) {
        // OOM: don't clobber a pending exception the caller may hold.
        return set_last_error(env, napi_generic_failure);
    }
    if (code != nullptr) {
        JS::RootedObject error_obj(env->cx, &error.toObject());
        JS::RootedValue code_rooted(env->cx, code_v);
        // Plain data property on a fresh error object — no JS runs
        // (assignment-equivalent attributes: enumerable+writable+configurable).
        if (!JS_DefineProperty(env->cx, error_obj, "code", code_rooted,
                               JSPROP_ENUMERATE)) {
            return set_last_error(env, napi_generic_failure);
        }
    }
    *result = arena_push(env, error);
    return clear_last_error(env);
}

// throw_* helpers build the message/code from C strings (lossy UTF-8) and
// set the pending exception; PREAMBLE applies (throwing over a pending
// exception is an error, matching Node).
static napi_status throw_error_with_code(napi_env env, JSExnType type,
                                         const char* code, const char* msg) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, msg);
    JSString* msg_str = new_string_utf8_lossy(env->cx, msg, strlen(msg));
    if (msg_str == nullptr) {
        return set_last_error(env, napi_generic_failure);
    }
    napi_value msg_v = arena_push(env, JS::StringValue(msg_str));
    napi_value code_v = nullptr;
    if (code != nullptr) {
        JSString* code_str = new_string_utf8_lossy(env->cx, code, strlen(code));
        if (code_str == nullptr) {
            return set_last_error(env, napi_generic_failure);
        }
        code_v = arena_push(env, JS::StringValue(code_str));
    }
    napi_value error = nullptr;
    napi_status status = create_error_object(env, type, code_v, msg_v, &error);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedValue error_v(env->cx, napi_value_to_js(error));
    JS_SetPendingException(env->cx, error_v);
    return napi_ok;
}

}  // namespace gjsify_napi

napi_status NAPI_CDECL napi_create_error(napi_env env, napi_value code,
                                         napi_value msg, napi_value* result) {
    return gjsify_napi::create_error_object(env, JSEXN_ERR, code, msg, result);
}

napi_status NAPI_CDECL napi_create_type_error(napi_env env, napi_value code,
                                              napi_value msg,
                                              napi_value* result) {
    return gjsify_napi::create_error_object(env, JSEXN_TYPEERR, code, msg,
                                            result);
}

napi_status NAPI_CDECL napi_create_range_error(napi_env env, napi_value code,
                                               napi_value msg,
                                               napi_value* result) {
    return gjsify_napi::create_error_object(env, JSEXN_RANGEERR, code, msg,
                                            result);
}

napi_status NAPI_CDECL node_api_create_syntax_error(napi_env env,
                                                    napi_value code,
                                                    napi_value msg,
                                                    napi_value* result) {
    return gjsify_napi::create_error_object(env, JSEXN_SYNTAXERR, code, msg,
                                            result);
}

napi_status NAPI_CDECL napi_throw_error(napi_env env, const char* code,
                                        const char* msg) {
    return gjsify_napi::throw_error_with_code(env, JSEXN_ERR, code, msg);
}

napi_status NAPI_CDECL napi_throw_type_error(napi_env env, const char* code,
                                             const char* msg) {
    return gjsify_napi::throw_error_with_code(env, JSEXN_TYPEERR, code, msg);
}

napi_status NAPI_CDECL napi_throw_range_error(napi_env env, const char* code,
                                              const char* msg) {
    return gjsify_napi::throw_error_with_code(env, JSEXN_RANGEERR, code, msg);
}

napi_status NAPI_CDECL node_api_throw_syntax_error(napi_env env,
                                                   const char* code,
                                                   const char* msg) {
    return gjsify_napi::throw_error_with_code(env, JSEXN_SYNTAXERR, code, msg);
}

napi_status NAPI_CDECL napi_is_error(napi_env env, napi_value value,
                                     bool* result) {
    // No preamble — must work while an exception is pending.
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    if (!v.isObject()) {
        *result = false;
        return gjsify_napi::clear_last_error(env);
    }
    JS::RootedObject obj(env->cx, &v.toObject());
    js::ESClass cls = js::ESClass::Other;
    if (!JS::GetBuiltinClass(env->cx, obj, &cls)) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = (cls == js::ESClass::Error);  // IsNativeError analog
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_fatal_exception(napi_env env, napi_value err) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, err);
    // Node triggers 'uncaughtException' (default: process exit). We have no
    // process-level handler chain in a GJS host — report loudly to stderr
    // and keep the host alive (documented deviation; a GUI app should not
    // die from an addon's background error).
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(err));
    JSString* str = JS::ToString(env->cx, v);
    if (str != nullptr) {
        JS::UniqueChars utf8 = JS_EncodeStringToUTF8(
            env->cx, JS::RootedString(env->cx, str));
        fprintf(stderr, "[gjsify-napi] napi_fatal_exception: %s\n",
                utf8 ? utf8.get() : "<unprintable>");
    } else {
        JS_ClearPendingException(env->cx);  // ToString threw — swallow
        fprintf(stderr,
                "[gjsify-napi] napi_fatal_exception: <unstringifiable>\n");
    }
    fflush(stderr);
    return gjsify_napi::clear_last_error(env);
}

// The not-yet-implemented remainder of the ABI lives in stubs.cc (loud
// napi_generic_failure + last_error for every declared symbol).
