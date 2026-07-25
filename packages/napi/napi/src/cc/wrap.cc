// SPDX-License-Identifier: MIT
// @gjsify/napi — §5d wrap/unwrap/external/type tags: the uniform
// Reference-based lifecycle over the two-tier InstanceState design.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT) —
// v8impl::Wrap/Unwrap (cc:339-374, 525-586), napi_create_external
// (cc:2679-2708), type tags (cc:2710-2799). Two-tier storage (Bun's shape):
//  - FAST TIER: instances of napi_define_class classes + externals carry
//    reserved slot 0 = JS::PrivateValue(InstanceState*), freed by a
//    FOREGROUND finalize hook that frees memory ONLY (no JSAPI, no user
//    callbacks — legal during GC, incl. nursery deaths). Pattern: GJS
//    cwrapper.h reserved slots + gi/object.cpp:3404-3407 foreground
//    finalize.
//  - FALLBACK TIER: foreign objects get the same InstanceState via an
//    env-held WeakMap (JS::NewWeakMapObject/Get/SetWeakMapEntry,
//    js/WeakMap.h) whose value is a hostdata_class carrier — ephemeron
//    semantics keep the carrier (and so the InstanceState) alive exactly as
//    long as the wrapped object, invisible to script.
// Lifecycle is uniform and lives in the wrap Reference, not the map: death
// → §5b weak sweep → §5c queue; the class finalize hook only frees the
// InstanceState struct.

#include "common.h"

namespace gjsify_napi {

// Frees memory only — runs during GC sweeping (JSFinalizeOp gets a
// JS::GCContext*, js/Class.h:301; foreground = main thread).
static void instance_state_finalize(JS::GCContext* /* gcx */, JSObject* obj) {
    const JS::Value slot = JS::GetReservedSlot(obj, kInstanceSlotState);
    if (!slot.isUndefined()) {
        delete static_cast<InstanceState*>(slot.toPrivate());
    }
}

static const JSClassOps instance_state_class_ops = {
    nullptr,                  // addProperty
    nullptr,                  // delProperty
    nullptr,                  // enumerate
    nullptr,                  // newEnumerate
    nullptr,                  // resolve
    nullptr,                  // mayResolve
    instance_state_finalize,  // finalize
    nullptr,                  // call
    nullptr,                  // construct
    nullptr,                  // trace
};

const JSClass instance_class = {
    "GjsifyNapiInstance",
    JSCLASS_HAS_RESERVED_SLOTS(1) | JSCLASS_FOREGROUND_FINALIZE,
    &instance_state_class_ops,
};

const JSClass external_class = {
    "GjsifyNapiExternal",
    JSCLASS_HAS_RESERVED_SLOTS(1) | JSCLASS_FOREGROUND_FINALIZE,
    &instance_state_class_ops,
};

const JSClass hostdata_class = {
    "GjsifyNapiHostData",
    JSCLASS_HAS_RESERVED_SLOTS(1) | JSCLASS_FOREGROUND_FINALIZE,
    &instance_state_class_ops,
};

static bool has_state_slot(JSObject* obj) {
    const JSClass* cls = JS::GetClass(obj);
    return cls == &instance_class || cls == &external_class ||
           cls == &hostdata_class;
}

static InstanceState* state_from_slot(JSObject* obj, bool create) {
    const JS::Value slot = JS::GetReservedSlot(obj, kInstanceSlotState);
    if (!slot.isUndefined()) {
        return static_cast<InstanceState*>(slot.toPrivate());
    }
    if (!create) {
        return nullptr;
    }
    auto* state = new InstanceState();
    JS::SetReservedSlot(obj, kInstanceSlotState, JS::PrivateValue(state));
    return state;
}

napi_status get_instance_state(napi_env env, JS::HandleObject obj,
                               bool create, InstanceState** out) {
    *out = nullptr;
    if (has_state_slot(obj)) {
        *out = state_from_slot(obj, create);
        return napi_ok;
    }
    // Foreign object → WeakMap tier.
    if (!env->wrap_map) {
        if (!create) {
            return napi_ok;
        }
        JSObject* map = JS::NewWeakMapObject(env->cx);
        if (map == nullptr) {
            return set_last_error(env, napi_generic_failure);
        }
        env->wrap_map = map;
    }
    JS::RootedObject map(env->cx, env->wrap_map);
    JS::RootedValue key(env->cx, JS::ObjectValue(*obj));
    JS::RootedValue carrier_v(env->cx);
    if (!JS::GetWeakMapEntry(env->cx, map, key, &carrier_v)) {
        return set_last_error(env, napi_generic_failure);
    }
    if (carrier_v.isObject()) {
        *out = state_from_slot(&carrier_v.toObject(), create);
        return napi_ok;
    }
    if (!create) {
        return napi_ok;
    }
    JS::RootedObject carrier(
        env->cx, JS_NewObjectWithGivenProto(env->cx, &hostdata_class,
                                            nullptr));
    if (!carrier) {
        return set_last_error(env, napi_generic_failure);
    }
    auto* state = new InstanceState();
    JS::SetReservedSlot(carrier, kInstanceSlotState, JS::PrivateValue(state));
    JS::RootedValue carrier_val(env->cx, JS::ObjectValue(*carrier));
    if (!JS::SetWeakMapEntry(env->cx, map, key, carrier_val)) {
        // Slot ownership already with the carrier; it dies unreferenced and
        // its finalize hook frees the state.
        return set_last_error(env, napi_generic_failure);
    }
    *out = state;
    return napi_ok;
}

}  // namespace gjsify_napi

// ---- wrap / unwrap / remove_wrap (uniform lifecycle, cc:525-586) ----

napi_status NAPI_CDECL napi_wrap(napi_env env, napi_value js_object,
                                 void* native_object,
                                 node_api_basic_finalize basic_finalize_cb,
                                 void* finalize_hint, napi_ref* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, js_object);
    auto finalize_cb = reinterpret_cast<napi_finalize>(basic_finalize_cb);
    JS::Value v = gjsify_napi::napi_value_to_js(js_object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    if (result != nullptr) {
        // The returned reference should be deleted via napi_delete_reference
        // ONLY in response to the finalize callback — so one is required
        // (cc:546-556).
        GJSIFY_NAPI_CHECK_ARG(env, finalize_cb);
    }
    gjsify_napi::InstanceState* state = nullptr;
    napi_status status =
        gjsify_napi::get_instance_state(env, obj, /* create = */ true, &state);
    if (status != napi_ok) {
        return status;
    }
    // Double-wrap = napi_invalid_arg (cc:540-544).
    if (state->wrap != nullptr) {
        return gjsify_napi::set_last_error(env, napi_invalid_arg);
    }
    JS::RootedValue obj_v(env->cx, v);
    gjsify_napi::Reference* ref = gjsify_napi::Reference::New(
        env, obj_v, 0,
        result != nullptr ? gjsify_napi::ReferenceOwnership::kUserland
                          : gjsify_napi::ReferenceOwnership::kRuntime,
        finalize_cb, native_object, finalize_hint);
    state->wrap = ref;
    if (result != nullptr) {
        *result = reinterpret_cast<napi_ref>(ref);
    }
    return napi_ok;  // preamble already cleared last_error
}

static napi_status unwrap_impl(napi_env env, napi_value js_object,
                               void** result, bool remove) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, js_object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(js_object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    gjsify_napi::InstanceState* state = nullptr;
    napi_status status = gjsify_napi::get_instance_state(
        env, obj, /* create = */ false, &state);
    if (status != napi_ok) {
        return status;
    }
    if (state == nullptr || state->wrap == nullptr) {
        return gjsify_napi::set_last_error(env, napi_invalid_arg);
    }
    gjsify_napi::Reference* ref = state->wrap;
    *result = ref->Data();
    if (remove) {
        state->wrap = nullptr;
        // kRuntime (no napi_ref handed out): the runtime owns it — delete
        // WITHOUT running the finalizer (the caller takes ownership back).
        // kUserland: the ref stays; userland deletes it (cc:365-374).
        if (ref->Ownership() == gjsify_napi::ReferenceOwnership::kRuntime) {
            delete ref;
        }
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_unwrap(napi_env env, napi_value obj,
                                   void** result) {
    return unwrap_impl(env, obj, result, /* remove = */ false);
}

napi_status NAPI_CDECL napi_remove_wrap(napi_env env, napi_value obj,
                                        void** result) {
    return unwrap_impl(env, obj, result, /* remove = */ true);
}

// ---- externals (cc:2679-2708) ----

napi_status NAPI_CDECL napi_create_external(napi_env env, void* data,
                                            node_api_basic_finalize
                                                basic_finalize_cb,
                                            void* finalize_hint,
                                            napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    auto finalize_cb = reinterpret_cast<napi_finalize>(basic_finalize_cb);
    JS::RootedObject external(
        env->cx, JS_NewObjectWithGivenProto(env->cx,
                                            &gjsify_napi::external_class,
                                            nullptr));
    if (!external) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    auto* state = new gjsify_napi::InstanceState();
    state->is_external = true;
    state->external_data = data;
    JS::SetReservedSlot(external, gjsify_napi::kInstanceSlotState,
                        JS::PrivateValue(state));
    if (finalize_cb != nullptr) {
        // kRuntime ReferenceWithFinalizer, weak refcount 0 — the uniform
        // §5b/§5c death path.
        JS::RootedValue ext_v(env->cx, JS::ObjectValue(*external));
        gjsify_napi::Reference::New(env, ext_v, 0,
                                    gjsify_napi::ReferenceOwnership::kRuntime,
                                    finalize_cb, data, finalize_hint);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*external));
    return napi_ok;
}

napi_status NAPI_CDECL napi_get_value_external(napi_env env, napi_value value,
                                               void** result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env,
        v.isObject() &&
            JS::GetClass(&v.toObject()) == &gjsify_napi::external_class,
        napi_invalid_arg);
    gjsify_napi::InstanceState* state =
        gjsify_napi::state_from_slot(&v.toObject(), /* create = */ false);
    *result = state != nullptr ? state->external_data : nullptr;
    return gjsify_napi::clear_last_error(env);
}

// ---- type tags (cc:2710-2799) ----

napi_status NAPI_CDECL napi_type_tag_object(napi_env env, napi_value object,
                                            const napi_type_tag* type_tag) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, type_tag);
    JS::Value v = gjsify_napi::napi_value_to_js(object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    gjsify_napi::InstanceState* state = nullptr;
    napi_status status =
        gjsify_napi::get_instance_state(env, obj, /* create = */ true, &state);
    if (status != napi_ok) {
        return status;
    }
    // Tag-once: re-tagging is napi_invalid_arg (cc:2725-2735).
    if (state->has_tag) {
        return gjsify_napi::set_last_error(env, napi_invalid_arg);
    }
    state->tag = *type_tag;
    state->has_tag = true;
    return napi_ok;
}

napi_status NAPI_CDECL napi_check_object_type_tag(napi_env env,
                                                  napi_value object,
                                                  const napi_type_tag* type_tag,
                                                  bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, type_tag);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    gjsify_napi::InstanceState* state = nullptr;
    napi_status status = gjsify_napi::get_instance_state(
        env, obj, /* create = */ false, &state);
    if (status != napi_ok) {
        return status;
    }
    // Compare both words; untagged → false (cc:2770-2799).
    *result = state != nullptr && state->has_tag &&
              state->tag.lower == type_tag->lower &&
              state->tag.upper == type_tag->upper;
    return gjsify_napi::clear_last_error(env);
}
