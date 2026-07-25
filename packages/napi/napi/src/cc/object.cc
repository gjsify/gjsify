// SPDX-License-Identifier: MIT
// @gjsify/napi — property/element ops, descriptors, arrays, misc object API.
//
// Reference: refs/node/src/js_native_api_v8.cc (Node.js contributors, MIT) —
// napi_define_properties (cc:1748-1824), property/element ops (cc:1826-2131),
// napi_get_all_property_names (cc:1602-1746), napi_object_freeze/seal
// (cc:1826-1860), napi_get_prototype, napi_instanceof (cc:3032-3062),
// napi_run_script (cc:3704-3730), napi_strict_equals. Reimplemented for
// SpiderMonkey: keys via js::GetPropertyKeys (jsfriendapi.h:441 — the
// Reflect.ownKeys analog), descriptors via JS_GetOwnPropertyDescriptorById,
// evaluation via JS::Evaluate + JS::SourceText.

#include "common.h"

#include <cstring>

namespace gjsify_napi {

// Shared JSAPI-false → napi_status mapping honoring the §6 contract.
static napi_status status_from_false(napi_env env) {
    return set_last_error(env, JS_IsExceptionPending(env->cx)
                                   ? napi_pending_exception
                                   : napi_generic_failure);
}

// ToObject coercion matching Node's CHECK_TO_OBJECT: primitives box,
// null/undefined throw TypeError → napi_object_expected with the exception
// left pending (V8-Node's TryCatch re-sets it at exit; SM keeps it).
static napi_status coerce_object_arg(napi_env env, napi_value value,
                                     JS::MutableHandleObject out) {
    JS::RootedValue v(env->cx, napi_value_to_js(value));
    JSObject* obj = JS::ToObject(env->cx, v);
    if (obj == nullptr) {
        return set_last_error(env, napi_object_expected);
    }
    out.set(obj);
    return napi_ok;
}

napi_status property_key_to_id(napi_env env, const char* utf8name,
                               napi_value name, JS::MutableHandleId id) {
    if (utf8name != nullptr) {
        JSString* str =
            new_string_utf8_lossy(env->cx, utf8name, strlen(utf8name));
        if (str == nullptr) {
            return set_last_error(env, napi_generic_failure);
        }
        JS::RootedString rooted(env->cx, str);
        if (!JS_StringToId(env->cx, rooted, id)) {
            return status_from_false(env);
        }
        return napi_ok;
    }
    if (name == nullptr) {
        return set_last_error(env, napi_name_expected);
    }
    JS::RootedValue name_v(env->cx, napi_value_to_js(name));
    if (!name_v.isString() && !name_v.isSymbol()) {
        return set_last_error(env, napi_name_expected);
    }
    if (!JS_ValueToId(env->cx, name_v, id)) {
        return status_from_false(env);
    }
    return napi_ok;
}

napi_status apply_property_descriptor(napi_env env, JS::HandleObject target,
                                      const napi_property_descriptor& p) {
    JS::RootedId id(env->cx);
    napi_status status = property_key_to_id(env, p.utf8name, p.name, &id);
    if (status != napi_ok) {
        return status;
    }

    // napi attrs → JSPROP inverses (PropertyDescriptor.h:36-47):
    // enumerable → JSPROP_ENUMERATE; !configurable → JSPROP_PERMANENT;
    // !writable → JSPROP_READONLY (data properties only).
    unsigned attrs = 0;
    if (p.attributes & napi_enumerable) {
        attrs |= JSPROP_ENUMERATE;
    }
    if (!(p.attributes & napi_configurable)) {
        attrs |= JSPROP_PERMANENT;
    }

    if (p.getter != nullptr || p.setter != nullptr) {
        // Accessors via the function-object overload (JSPROP_GETTER/SETTER
        // no longer exist in 140 — passing the functions expresses it).
        JS::RootedObject getter(env->cx);
        JS::RootedObject setter(env->cx);
        if (p.getter != nullptr) {
            getter = new_bundle_function(env, p.utf8name, NAPI_AUTO_LENGTH,
                                         p.getter, p.data, 0, false);
            if (!getter) {
                return set_last_error(env, napi_generic_failure);
            }
        }
        if (p.setter != nullptr) {
            setter = new_bundle_function(env, p.utf8name, NAPI_AUTO_LENGTH,
                                         p.setter, p.data, 0, false);
            if (!setter) {
                return set_last_error(env, napi_generic_failure);
            }
        }
        if (!JS_DefinePropertyById(env->cx, target, id, getter, setter,
                                   attrs)) {
            return status_from_false(env);
        }
        return napi_ok;
    }
    if (p.method != nullptr) {
        JS::RootedObject method(
            env->cx, new_bundle_function(env, p.utf8name, NAPI_AUTO_LENGTH,
                                         p.method, p.data, 0, false));
        if (!method) {
            return set_last_error(env, napi_generic_failure);
        }
        if (!(p.attributes & napi_writable)) {
            attrs |= JSPROP_READONLY;
        }
        JS::RootedValue method_v(env->cx, JS::ObjectValue(*method));
        if (!JS_DefinePropertyById(env->cx, target, id, method_v, attrs)) {
            return status_from_false(env);
        }
        return napi_ok;
    }
    // Data property.
    if (p.value == nullptr) {
        return set_last_error(env, napi_invalid_arg);
    }
    if (!(p.attributes & napi_writable)) {
        attrs |= JSPROP_READONLY;
    }
    JS::RootedValue value(env->cx, napi_value_to_js(p.value));
    if (!JS_DefinePropertyById(env->cx, target, id, value, attrs)) {
        return status_from_false(env);
    }
    return napi_ok;
}

}  // namespace gjsify_napi

napi_status NAPI_CDECL napi_define_properties(
    napi_env env, napi_value object, size_t property_count,
    const napi_property_descriptor* properties) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    if (property_count > 0) {
        GJSIFY_NAPI_CHECK_ARG(env, properties);
    }
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    for (size_t i = 0; i < property_count; i++) {
        status = gjsify_napi::apply_property_descriptor(env, obj,
                                                        properties[i]);
        if (status != napi_ok) {
            return status;
        }
    }
    return napi_ok;
}

// ---- generic-key property ops ----

napi_status NAPI_CDECL napi_set_property(napi_env env, napi_value object,
                                         napi_value key, napi_value value) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, key);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedId id(env->cx);
    JS::RootedValue key_v(env->cx, gjsify_napi::napi_value_to_js(key));
    if (!JS_ValueToId(env->cx, key_v, &id)) {
        return gjsify_napi::status_from_false(env);
    }
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    if (!JS_SetPropertyById(env->cx, obj, id, v)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_get_property(napi_env env, napi_value object,
                                         napi_value key, napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, key);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedId id(env->cx);
    JS::RootedValue key_v(env->cx, gjsify_napi::napi_value_to_js(key));
    if (!JS_ValueToId(env->cx, key_v, &id)) {
        return gjsify_napi::status_from_false(env);
    }
    JS::RootedValue v(env->cx);
    if (!JS_GetPropertyById(env->cx, obj, id, &v)) {
        return gjsify_napi::status_from_false(env);
    }
    *result = gjsify_napi::arena_push(env, v);
    return napi_ok;
}

napi_status NAPI_CDECL napi_has_property(napi_env env, napi_value object,
                                         napi_value key, bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, key);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedId id(env->cx);
    JS::RootedValue key_v(env->cx, gjsify_napi::napi_value_to_js(key));
    if (!JS_ValueToId(env->cx, key_v, &id)) {
        return gjsify_napi::status_from_false(env);
    }
    if (!JS_HasPropertyById(env->cx, obj, id, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_delete_property(napi_env env, napi_value object,
                                            napi_value key, bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, key);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedId id(env->cx);
    JS::RootedValue key_v(env->cx, gjsify_napi::napi_value_to_js(key));
    if (!JS_ValueToId(env->cx, key_v, &id)) {
        return gjsify_napi::status_from_false(env);
    }
    JS::ObjectOpResult op_result;
    if (!JS_DeletePropertyById(env->cx, obj, id, op_result)) {
        return gjsify_napi::status_from_false(env);
    }
    if (result != nullptr) {
        *result = op_result.ok();  // non-strict delete result
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_has_own_property(napi_env env, napi_value object,
                                             napi_value key, bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, key);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    // Key must be a string or symbol (cc: napi_name_expected).
    JS::RootedValue key_v(env->cx, gjsify_napi::napi_value_to_js(key));
    if (!key_v.isString() && !key_v.isSymbol()) {
        return gjsify_napi::set_last_error(env, napi_name_expected);
    }
    JS::RootedId id(env->cx);
    if (!JS_ValueToId(env->cx, key_v, &id)) {
        return gjsify_napi::status_from_false(env);
    }
    if (!JS_HasOwnPropertyById(env->cx, obj, id, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

// ---- named-property convenience (utf8 keys) ----
// napi_set/get_named_property live in value.cc since P0.0; napi_has_named_
// property completes the trio here.

napi_status NAPI_CDECL napi_has_named_property(napi_env env, napi_value object,
                                               const char* utf8name,
                                               bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, utf8name);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedId id(env->cx);
    status = gjsify_napi::property_key_to_id(env, utf8name, nullptr, &id);
    if (status != napi_ok) {
        return status;
    }
    if (!JS_HasPropertyById(env->cx, obj, id, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

// ---- element ops ----

napi_status NAPI_CDECL napi_set_element(napi_env env, napi_value object,
                                        uint32_t index, napi_value value) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    if (!JS_SetElement(env->cx, obj, index, v)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_get_element(napi_env env, napi_value object,
                                        uint32_t index, napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedValue v(env->cx);
    if (!JS_GetElement(env->cx, obj, index, &v)) {
        return gjsify_napi::status_from_false(env);
    }
    *result = gjsify_napi::arena_push(env, v);
    return napi_ok;
}

napi_status NAPI_CDECL napi_has_element(napi_env env, napi_value object,
                                        uint32_t index, bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    if (!JS_HasElement(env->cx, obj, index, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_delete_element(napi_env env, napi_value object,
                                           uint32_t index, bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::ObjectOpResult op_result;
    if (!JS_DeleteElement(env->cx, obj, index, op_result)) {
        return gjsify_napi::status_from_false(env);
    }
    if (result != nullptr) {
        *result = op_result.ok();
    }
    return napi_ok;
}

// ---- arrays ----

napi_status NAPI_CDECL napi_create_array(napi_env env, napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JSObject* arr = JS::NewArrayObject(env->cx, 0);
    if (arr == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*arr));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_create_array_with_length(napi_env env,
                                                     size_t length,
                                                     napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    // Match V8's Array::New(length): set the length WITHOUT pre-allocating the
    // backing store. JS::NewArrayObject(cx, length) reserves `length` dense
    // slots, so a documented large length (up to 2^32-1) OOMs; create an empty
    // array and set its length property instead → a sparse array like Node.
    JS::RootedObject arr(env->cx, JS::NewArrayObject(env->cx, 0));
    if (arr == nullptr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    if (length > 0 &&
        !JS::SetArrayLength(env->cx, arr, static_cast<uint32_t>(length))) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*arr));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_is_array(napi_env env, napi_value value,
                                     bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    if (!JS::IsArrayObject(env->cx, v, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_array_length(napi_env env, napi_value value,
                                             uint32_t* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value v = gjsify_napi::napi_value_to_js(value);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_array_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    bool is_array = false;
    if (!JS::IsArrayObject(env->cx, obj, &is_array)) {
        return gjsify_napi::status_from_false(env);
    }
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, is_array, napi_array_expected);
    if (!JS::GetArrayLength(env->cx, obj, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

// ---- prototype / freeze / seal ----

napi_status NAPI_CDECL napi_get_prototype(napi_env env, napi_value object,
                                          napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }
    JS::RootedObject proto(env->cx);
    if (!JS_GetPrototype(env->cx, obj, &proto)) {
        return gjsify_napi::status_from_false(env);
    }
    *result = gjsify_napi::arena_push(
        env, proto ? JS::ObjectValue(*proto) : JS::NullValue());
    return napi_ok;
}

napi_status NAPI_CDECL napi_object_freeze(napi_env env, napi_value object) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    JS::Value v = gjsify_napi::napi_value_to_js(object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    JS::RootedObject obj(env->cx, &v.toObject());
    if (!JS_FreezeObject(env->cx, obj)) {  // SetIntegrityLevel(kFrozen)
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_object_seal(napi_env env, napi_value object) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    JS::Value v = gjsify_napi::napi_value_to_js(object);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    // No public JSAPI SetIntegrityLevel(kSealed) in 140 — delegate to the
    // builtin Object.seal (spec SetIntegrityLevel; we run under preamble
    // like Node's napi_object_seal).
    JS::RootedObject global(env->cx, env->global);
    JS::RootedValue object_ctor(env->cx);
    JS::RootedValue seal_fn(env->cx);
    if (!JS_GetProperty(env->cx, global, "Object", &object_ctor) ||
        !object_ctor.isObject()) {
        return gjsify_napi::status_from_false(env);
    }
    JS::RootedObject object_ctor_obj(env->cx, &object_ctor.toObject());
    if (!JS_GetProperty(env->cx, object_ctor_obj, "seal", &seal_fn)) {
        return gjsify_napi::status_from_false(env);
    }
    JS::RootedValue target(env->cx, v);
    JS::RootedValue rval(env->cx);
    if (!JS::Call(env->cx, object_ctor, seal_fn,
                  JS::HandleValueArray(target), &rval)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

// ---- property names ----

static bool id_matches_filter(napi_env env, JS::HandleObject owner,
                              JS::HandleId id, napi_key_filter filter,
                              bool* matches) {
    *matches = true;
    if (id.isSymbol()) {
        if (filter & napi_key_skip_symbols) {
            *matches = false;
            return true;
        }
    } else if (filter & napi_key_skip_strings) {
        // Node's kSkipStrings also skips integer indices converted from
        // numbers only when key conversion keeps them as strings — mirror
        // V8 PropertyFilter: ONLY_/SKIP_ classify by name kind.
        *matches = false;
        return true;
    }
    if (!(filter &
          (napi_key_writable | napi_key_enumerable | napi_key_configurable))) {
        return true;
    }
    JS::Rooted<mozilla::Maybe<JS::PropertyDescriptor>> desc(env->cx);
    if (!JS_GetOwnPropertyDescriptorById(env->cx, owner, id, &desc)) {
        return false;
    }
    if (desc.isNothing()) {
        *matches = false;
        return true;
    }
    const JS::PropertyDescriptor& d = *desc.get();
    if ((filter & napi_key_writable) &&
        !(d.isDataDescriptor() ? d.writable() : d.hasSetter())) {
        *matches = false;
    }
    if ((filter & napi_key_enumerable) && !d.enumerable()) {
        *matches = false;
    }
    if ((filter & napi_key_configurable) && !d.configurable()) {
        *matches = false;
    }
    return true;
}

napi_status NAPI_CDECL napi_get_all_property_names(
    napi_env env, napi_value object, napi_key_collection_mode key_mode,
    napi_key_filter key_filter, napi_key_conversion key_conversion,
    napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env,
        key_mode == napi_key_include_prototypes || key_mode == napi_key_own_only,
        napi_invalid_arg);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env,
        key_conversion == napi_key_keep_numbers ||
            key_conversion == napi_key_numbers_to_strings,
        napi_invalid_arg);
    JS::RootedObject obj(env->cx);
    napi_status status = gjsify_napi::coerce_object_arg(env, object, &obj);
    if (status != napi_ok) {
        return status;
    }

    // Collect own keys per prototype-chain level (Reflect.ownKeys flags:
    // OWNONLY|HIDDEN|SYMBOLS — filtered below), deduped across levels via
    // js::AppendUnique. Own-only mode stops after the first level.
    JS::RootedIdVector keys(env->cx);
    JS::RootedObject current(env->cx, obj);
    while (current) {
        JS::RootedIdVector level_keys(env->cx);
        if (!js::GetPropertyKeys(env->cx, current,
                                 JSITER_OWNONLY | JSITER_HIDDEN |
                                     JSITER_SYMBOLS,
                                 &level_keys)) {
            return gjsify_napi::status_from_false(env);
        }
        JS::RootedIdVector filtered(env->cx);
        for (size_t i = 0; i < level_keys.length(); i++) {
            JS::RootedId id(env->cx, level_keys[i]);
            bool matches = false;
            if (!id_matches_filter(env, current, id, key_filter,
                                                &matches)) {
                return gjsify_napi::status_from_false(env);
            }
            if (matches && !filtered.append(id)) {
                return gjsify_napi::set_last_error(env, napi_generic_failure);
            }
        }
        if (!js::AppendUnique(env->cx, &keys, filtered)) {
            return gjsify_napi::set_last_error(env, napi_generic_failure);
        }
        if (key_mode == napi_key_own_only) {
            break;
        }
        JS::RootedObject proto(env->cx);
        if (!JS_GetPrototype(env->cx, current, &proto)) {
            return gjsify_napi::status_from_false(env);
        }
        current = proto;
    }

    JS::RootedObject arr(env->cx, JS::NewArrayObject(env->cx, keys.length()));
    if (!arr) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    for (size_t i = 0; i < keys.length(); i++) {
        JS::RootedId id(env->cx, keys[i]);
        JS::RootedValue key_v(env->cx);
        if (!JS_IdToValue(env->cx, id, &key_v)) {
            return gjsify_napi::status_from_false(env);
        }
        if (key_v.isNumber() &&
            key_conversion == napi_key_numbers_to_strings) {
            JSString* str = JS::ToString(env->cx, key_v);
            if (str == nullptr) {
                return gjsify_napi::status_from_false(env);
            }
            key_v.setString(str);
        }
        if (!JS_SetElement(env->cx, arr, static_cast<uint32_t>(i), key_v)) {
            return gjsify_napi::status_from_false(env);
        }
    }
    *result = gjsify_napi::arena_push(env, JS::ObjectValue(*arr));
    return napi_ok;
}

napi_status NAPI_CDECL napi_get_property_names(napi_env env, napi_value object,
                                               napi_value* result) {
    // Enumerable string-keyed, walking the prototype chain, numbers as
    // strings — exactly Node's delegation (cc:1826-1835).
    return napi_get_all_property_names(
        env, object, napi_key_include_prototypes,
        static_cast<napi_key_filter>(napi_key_enumerable |
                                     napi_key_skip_symbols),
        napi_key_numbers_to_strings, result);
}

// ---- instanceof / run_script / strict_equals ----

napi_status NAPI_CDECL napi_instanceof(napi_env env, napi_value object,
                                       napi_value constructor, bool* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, object);
    GJSIFY_NAPI_CHECK_ARG(env, constructor);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = false;
    JS::Value ctor_v = gjsify_napi::napi_value_to_js(constructor);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, ctor_v.isObject(),
                                       napi_object_expected);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env,
                                       JS::IsCallable(&ctor_v.toObject()),
                                       napi_function_expected);
    JS::RootedObject ctor(env->cx, &ctor_v.toObject());
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(object));
    if (!JS_HasInstance(env->cx, ctor, v, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return napi_ok;
}

napi_status NAPI_CDECL napi_run_script(napi_env env, napi_value script,
                                       napi_value* result) {
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, script);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::Value script_v = gjsify_napi::napi_value_to_js(script);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, script_v.isString(),
                                       napi_string_expected);
    // Copy out the source (JS::SourceText borrows; the JSString could move).
    JS::RootedString str(env->cx, script_v.toString());
    JS::UniqueTwoByteChars chars(JS_CopyStringCharsZ(env->cx, str));
    if (!chars) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    const size_t source_len = JS_GetStringLength(str);
    JS::SourceText<char16_t> source;
    if (!source.init(env->cx, chars.get(), source_len,
                     JS::SourceOwnership::Borrowed)) {
        return gjsify_napi::status_from_false(env);
    }
    JS::CompileOptions options(env->cx);
    options.setFileAndLine("napi_run_script", 1);
    JS::RootedValue rval(env->cx);
    if (!JS::Evaluate(env->cx, options, source, &rval)) {
        return gjsify_napi::status_from_false(env);
    }
    *result = gjsify_napi::arena_push(env, rval);
    return napi_ok;
}

napi_status NAPI_CDECL napi_strict_equals(napi_env env, napi_value lhs,
                                          napi_value rhs, bool* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, lhs);
    GJSIFY_NAPI_CHECK_ARG(env, rhs);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue a(env->cx, gjsify_napi::napi_value_to_js(lhs));
    JS::RootedValue b(env->cx, gjsify_napi::napi_value_to_js(rhs));
    if (!JS::StrictlyEqual(env->cx, a, b, result)) {
        return gjsify_napi::status_from_false(env);
    }
    return gjsify_napi::clear_last_error(env);
}
