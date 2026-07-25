// SPDX-License-Identifier: MIT
// @gjsify/napi — callback trampoline, functions, classes, calls, wrap slice.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT) —
// FunctionCallbackWrapper (cc:424-523), napi_create_function (cc:944-968),
// napi_define_class (cc:970-1064), napi_get_cb_info (cc:2133-2162),
// napi_get_new_target (cc:2164-2176 + GetNewTarget cc:502-509),
// napi_call_function (cc:2178-2208), napi_new_instance (cc:3004-3030),
// napi_wrap/unwrap/remove_wrap (cc:339-374, 525-586). Natives-with-data via
// js::NewFunctionWithReserved follow GJS's own pattern
// (refs/gjs/gjs/jsapi-dynamic-class.cpp:152-159; GNOME contributors,
// MIT/LGPLv2+). `JS_New` is gone in mozjs-140 — construction goes through
// JS::Construct (js/CallAndConstruct.h:125).

#include "common.h"

#include <algorithm>

namespace gjsify_napi {

JSObject* new_bundle_function(napi_env env, const char* utf8name,
                              size_t length, napi_callback cb, void* data,
                              unsigned flags, bool construct_as_class) {
    std::string name;
    if (utf8name != nullptr) {
        name = (length == NAPI_AUTO_LENGTH) ? std::string(utf8name)
                                            : std::string(utf8name, length);
    }
    auto* bundle = new CallbackBundle{env, cb, data, construct_as_class};
    JSFunction* fn = js::NewFunctionWithReserved(
        env->cx, function_trampoline, 0, flags, name.c_str());
    if (fn == nullptr) {
        delete bundle;
        return nullptr;
    }
    JSObject* fn_obj = JS_GetFunctionObject(fn);
    js::SetFunctionNativeReserved(fn_obj, 0, JS::PrivateValue(bundle));

    // A plain napi function (napi_create_function or a napi_define_properties
    // method) is constructible and, like every V8 function Node hands back,
    // owns a `.prototype` object — SpiderMonkey natives get none, so `new fn()`
    // and `class X extends fn` (test_new_target) would fault on a missing/
    // undefined prototype. Give it the standard function-prototype shape
    // (writable, non-enumerable, non-configurable) plus the `.constructor`
    // back-reference. napi_define_class (construct_as_class) is skipped: it
    // wires its own ctor.prototype ↔ proto.constructor pair afterwards.
    if ((flags & JSFUN_CONSTRUCTOR) && !construct_as_class) {
        JS::RootedObject fn_rooted(env->cx, fn_obj);
        JS::RootedObject proto(env->cx, JS_NewPlainObject(env->cx));
        if (proto == nullptr ||
            !JS_DefineProperty(env->cx, fn_rooted, "prototype", proto,
                               JSPROP_PERMANENT) ||
            !JS_DefineProperty(env->cx, proto, "constructor", fn_rooted, 0)) {
            delete bundle;
            return nullptr;
        }
        env->bundles.push_back(bundle);
        return fn_rooted;
    }
    env->bundles.push_back(bundle);
    return fn_obj;
}

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
    // Early-teardown guard: bundles outlive teardown() (freed only in the
    // env destructor at context dispose), so this dereference is safe and a
    // call into a torn-down addon env fails as a JS error, not a UAF.
    if (env->torn_down) {
        JS_ReportErrorUTF8(
            cx, "gjsify-napi: addon environment has been torn down");
        return false;
    }

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
    info.data = bundle->data;

    // `this` construction. SM natives get no auto-created instance, so the
    // constructor path builds one from new.target.prototype (V8 semantics);
    // class instances use the fast-tier JSClass (§5d).
    JS::RootedObject constructed_this(cx);
    if (args.isConstructing()) {
        JS::RootedObject new_target(cx, &args.newTarget().toObject());
        JS::RootedValue proto_v(cx);
        if (!JS_GetProperty(cx, new_target, "prototype", &proto_v)) {
            napi_close_handle_scope(env, scope);
            return false;
        }
        JS::RootedObject proto(
            cx, proto_v.isObject() ? &proto_v.toObject() : nullptr);
        constructed_this = JS_NewObjectWithGivenProto(
            cx, bundle->construct_as_class ? &instance_class : nullptr, proto);
        if (!constructed_this) {
            napi_close_handle_scope(env, scope);
            return false;
        }
        info.this_arg = arena_push(env, JS::ObjectValue(*constructed_this));
        info.new_target = arena_push(env, args.newTarget());
    } else {
        // v8::FunctionCallbackInfo::This() parity: undefined/null receiver
        // (sloppy call) → the global proxy; primitive receivers are boxed.
        JS::RootedValue thisv(cx, args.thisv());
        if (thisv.isNullOrUndefined()) {
            thisv = JS::ObjectValue(*env->global);
        } else if (!thisv.isObject()) {
            JSObject* boxed = JS::ToObject(cx, thisv);
            if (boxed == nullptr) {
                napi_close_handle_scope(env, scope);
                return false;
            }
            thisv = JS::ObjectValue(*boxed);
        }
        info.this_arg = arena_push(env, thisv);
        info.new_target = nullptr;
    }

    napi_value result =
        bundle->cb(env, reinterpret_cast<napi_callback_info>(&info));

    const bool pending = JS_IsExceptionPending(cx);
    if (!pending) {
        // Read results BEFORE closing the scope (closing releases the arena
        // slots); args.rval() is rooted by the JS stack.
        if (args.isConstructing()) {
            // Construction result: the callback's returned object if it is
            // one, else the created `this` (V8 semantics).
            const JS::Value ret =
                result != nullptr ? napi_value_to_js(result) : JS::Value();
            args.rval().setObject(ret.isObject() ? ret.toObject()
                                                 : *constructed_this);
        } else {
            args.rval().set(result != nullptr ? napi_value_to_js(result)
                                              : JS::UndefinedValue());
        }
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
    // JSFUN_CONSTRUCTOR (jsapi.h:540): napi functions are constructible
    // (V8 FunctionTemplate default) — without it `new fn()` throws in SM.
    JSObject* fn_obj = gjsify_napi::new_bundle_function(
        env, utf8name, length, cb, callback_data, JSFUN_CONSTRUCTOR,
        /* construct_as_class = */ false);
    if (fn_obj == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
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

napi_status NAPI_CDECL napi_get_new_target(napi_env env,
                                           napi_callback_info cbinfo,
                                           napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, cbinfo);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    auto* info = reinterpret_cast<gjsify_napi::CallbackInfo*>(cbinfo);
    // nullptr when not constructing (GetNewTarget, cc:502-509).
    *result = info->new_target;
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_call_function(napi_env env, napi_value recv,
                                          napi_value func, size_t argc,
                                          const napi_value* argv,
                                          napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, recv);
    GJSIFY_NAPI_CHECK_ARG(env, func);
    if (argc > 0) {
        GJSIFY_NAPI_CHECK_ARG(env, argv);
    }
    JS::Value fn_v = gjsify_napi::napi_value_to_js(func);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, fn_v.isObject() && JS::IsCallable(&fn_v.toObject()),
        napi_function_expected);

    // Rooted contiguous copy of the arguments: the arena slots themselves
    // are traced, but HandleValueArray needs contiguous rooted storage.
    JS::RootedVector<JS::Value> call_args(env->cx);
    for (size_t i = 0; i < argc; i++) {
        GJSIFY_NAPI_CHECK_ARG(env, argv[i]);
        if (!call_args.append(gjsify_napi::napi_value_to_js(argv[i]))) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
    }
    JS::RootedValue this_v(env->cx, gjsify_napi::napi_value_to_js(recv));
    JS::RootedValue fn_rooted(env->cx, fn_v);
    JS::RootedValue rval(env->cx);
    if (!JS::Call(env->cx, this_v, fn_rooted, JS::HandleValueArray(call_args),
                  &rval)) {
        // §6 must-not-abort contract: a JS throw (ANY value, including
        // null/undefined) stays pending and is never normalized; a false
        // return WITHOUT a pending exception (OOM/over-recursion — SM's
        // analog of V8 termination) is napi_generic_failure, never a crash.
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    if (result != nullptr) {
        *result = gjsify_napi::arena_push(env, rval);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_new_instance(napi_env env, napi_value constructor,
                                         size_t argc, const napi_value* argv,
                                         napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, constructor);
    if (argc > 0) {
        GJSIFY_NAPI_CHECK_ARG(env, argv);
    }
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value ctor_v = gjsify_napi::napi_value_to_js(constructor);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, ctor_v.isObject() && JS::IsCallable(&ctor_v.toObject()),
        napi_function_expected);

    JS::RootedVector<JS::Value> call_args(env->cx);
    for (size_t i = 0; i < argc; i++) {
        GJSIFY_NAPI_CHECK_ARG(env, argv[i]);
        if (!call_args.append(gjsify_napi::napi_value_to_js(argv[i]))) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
    }
    JS::RootedValue ctor_rooted(env->cx, ctor_v);
    JS::RootedObject instance(env->cx);
    // JS_New is gone in mozjs-140; JS::Construct implements [[Construct]].
    if (!JS::Construct(env->cx, ctor_rooted, JS::HandleValueArray(call_args),
                       &instance)) {
        return gjsify_napi::set_last_error(
            env, JS_IsExceptionPending(env->cx) ? napi_pending_exception
                                                : napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*instance));
    return napi_ok;
}

napi_status NAPI_CDECL napi_define_class(
    napi_env env, const char* utf8name, size_t length,
    napi_callback constructor, void* callback_data, size_t property_count,
    const napi_property_descriptor* properties, napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_CHECK_ARG(env, constructor);
    GJSIFY_NAPI_CHECK_ARG(env, utf8name);
    if (property_count > 0) {
        GJSIFY_NAPI_CHECK_ARG(env, properties);
    }

    JS::RootedObject ctor_obj(
        env->cx,
        gjsify_napi::new_bundle_function(env, utf8name, length, constructor,
                                         callback_data, JSFUN_CONSTRUCTOR,
                                         /* construct_as_class = */ true));
    if (!ctor_obj) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    JS::RootedObject proto(env->cx, JS_NewPlainObject(env->cx));
    if (!proto) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    // Wire ctor.prototype ↔ proto.constructor like a normal JS function:
    // prototype = writable, non-enumerable, non-configurable; constructor =
    // writable, non-enumerable, configurable.
    if (!JS_DefineProperty(env->cx, ctor_obj, "prototype", proto,
                           JSPROP_PERMANENT) ||
        !JS_DefineProperty(env->cx, proto, "constructor", ctor_obj, 0)) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }

    // Non-static descriptors go on the prototype, napi_static ones on the
    // constructor (cc:1048-1061), through the napi_define_properties path.
    for (size_t i = 0; i < property_count; i++) {
        const napi_property_descriptor& p = properties[i];
        JS::RootedObject target(env->cx, (p.attributes & napi_static)
                                             ? ctor_obj.get()
                                             : proto.get());
        napi_status status =
            gjsify_napi::apply_property_descriptor(env, target, p);
        if (status != napi_ok) {
            return status;  // last_error already set
        }
    }

    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*ctor_obj));
    return napi_ok;
}
