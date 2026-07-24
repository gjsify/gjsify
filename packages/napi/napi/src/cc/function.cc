// SPDX-License-Identifier: MIT
// @gjsify/napi — callback trampoline, napi_create_function, napi_get_cb_info.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT) —
// FunctionCallbackWrapper (cc:424-523), napi_create_function (cc:944-968),
// napi_get_cb_info (cc:2133-2162). Natives-with-data via
// js::NewFunctionWithReserved follow GJS's own pattern
// (refs/gjs/gjs/jsapi-dynamic-class.cpp:152-159; GNOME contributors,
// MIT/LGPLv2+).

#include "common.h"

#include <algorithm>

namespace gjsify_napi {

// The shared JSNative every napi-created function dispatches through
// (V8-Node's FunctionCallbackWrapper analog). Opens a handle scope around the
// napi callback, boxes args/this into scope-bound arena slots, applies the §6
// trampoline exit rule: pending exception ⇒ return false (SpiderMonkey
// propagates the already-set pending exception — no rethrow step), else set
// rval and return true.
bool function_trampoline(JSContext* cx, unsigned argc, JS::Value* vp) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, vp);
    const JS::Value bundle_val =
        js::GetFunctionNativeReserved(&args.callee(), 0);
    auto* bundle = static_cast<CallbackBundle*>(bundle_val.toPrivate());
    napi_env env = bundle->env;

    napi_handle_scope scope = nullptr;
    if (napi_open_handle_scope(env, &scope) != napi_ok) {
        JS_ReportErrorUTF8(cx, "gjsify-napi: failed to open handle scope");
        return false;
    }

    std::vector<napi_value> argv(args.length());
    for (unsigned i = 0; i < args.length(); i++) {
        argv[i] = arena_push(env, args[i]);
    }
    CallbackInfo info;
    info.argv = argv.data();
    info.argc = args.length();
    info.this_arg = arena_push(env, args.thisv());
    info.new_target = nullptr;  // constructor-call support lands in P0.2
    info.data = bundle->data;

    napi_value result =
        bundle->cb(env, reinterpret_cast<napi_callback_info>(&info));

    const bool pending = JS_IsExceptionPending(cx);
    if (!pending) {
        // Read the result BEFORE closing the scope (closing releases the
        // arena slot); args.rval() is rooted by the JS stack.
        args.rval().set(result != nullptr ? napi_value_to_js(result)
                                          : JS::UndefinedValue());
    }
    // Balance check: our scope must still be the top one. An imbalanced
    // callback is a fatal error in Node (CallIntoModule handle_exception);
    // match that hard stance.
    if (napi_close_handle_scope(env, scope) != napi_ok) {
        napi_fatal_error("gjsify_napi::function_trampoline", NAPI_AUTO_LENGTH,
                         "handle scope imbalance after native callback",
                         NAPI_AUTO_LENGTH);
    }
    return !pending;
}

}  // namespace gjsify_napi

napi_status NAPI_CDECL napi_create_function(napi_env env, const char* utf8name,
                                            size_t length, napi_callback cb,
                                            void* callback_data,
                                            napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_CHECK_ARG(env, cb);

    std::string name;
    if (utf8name != nullptr) {
        name = (length == NAPI_AUTO_LENGTH) ? std::string(utf8name)
                                            : std::string(utf8name, length);
    }

    auto* bundle = new gjsify_napi::CallbackBundle{env, cb, callback_data};
    JSFunction* fn = js::NewFunctionWithReserved(
        env->cx, gjsify_napi::function_trampoline, 0, 0, name.c_str());
    if (fn == nullptr) {
        delete bundle;
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    JSObject* fn_obj = JS_GetFunctionObject(fn);
    js::SetFunctionNativeReserved(fn_obj, 0, JS::PrivateValue(bundle));
    env->bundles.push_back(bundle);

    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*fn_obj));
    return napi_ok;  // preamble already cleared last_error
}

napi_status NAPI_CDECL napi_get_cb_info(napi_env env, napi_callback_info cbinfo,
                                        size_t* argc, napi_value* argv,
                                        napi_value* this_arg, void** data) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, cbinfo);
    auto* info = reinterpret_cast<gjsify_napi::CallbackInfo*>(cbinfo);

    if (argv != nullptr) {
        GJSIFY_NAPI_CHECK_ARG(env, argc);
        const size_t provided = std::min(*argc, info->argc);
        std::copy(info->argv, info->argv + provided, argv);
        if (provided < *argc) {
            // Pad missing arguments with undefined (cc:2146-2153).
            napi_value undefined =
                gjsify_napi::arena_push(env, JS::UndefinedValue());
            std::fill(argv + provided, argv + *argc, undefined);
        }
    }
    if (argc != nullptr) {
        *argc = info->argc;
    }
    if (this_arg != nullptr) {
        *this_arg = info->this_arg;
    }
    if (data != nullptr) {
        *data = info->data;
    }
    return gjsify_napi::clear_last_error(env);
}
