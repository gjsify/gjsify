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

// ---- P0.0 stubs ----
//
// Not yet implemented, but defined so (a) the pre-promotion collision probe
// (module.cc) has a canonical symbol to compare against and (b) an addon
// reaching past the P0.0 surface fails loud with a status, not a crash.
// Every stub returns napi_generic_failure + sets last_error (§2 posture).

#define GJSIFY_NAPI_STUB_BODY(env)                                   \
    do {                                                             \
        GJSIFY_NAPI_CHECK_ENV(env);                                  \
        return gjsify_napi::set_last_error((env), napi_generic_failure); \
    } while (0)

napi_status NAPI_CDECL napi_create_reference(napi_env env, napi_value value,
                                             uint32_t initial_refcount,
                                             napi_ref* result) {
    (void)value;
    (void)initial_refcount;
    (void)result;
    GJSIFY_NAPI_STUB_BODY(env);
}

napi_status NAPI_CDECL napi_delete_reference(napi_env env, napi_ref ref) {
    (void)ref;
    GJSIFY_NAPI_STUB_BODY(env);
}

napi_status NAPI_CDECL napi_reference_ref(napi_env env, napi_ref ref,
                                          uint32_t* result) {
    (void)ref;
    (void)result;
    GJSIFY_NAPI_STUB_BODY(env);
}

napi_status NAPI_CDECL napi_reference_unref(napi_env env, napi_ref ref,
                                            uint32_t* result) {
    (void)ref;
    (void)result;
    GJSIFY_NAPI_STUB_BODY(env);
}

napi_status NAPI_CDECL napi_get_reference_value(napi_env env, napi_ref ref,
                                                napi_value* result) {
    (void)ref;
    (void)result;
    GJSIFY_NAPI_STUB_BODY(env);
}
