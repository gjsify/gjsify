// SPDX-License-Identifier: MIT
// @gjsify/napi P0.2 gate addon — raw C Node-API, no node-addon-api.
//
// ObjectWrap-style class via napi_define_class (constructor wraps native
// state through the reserved-slot fast tier, instance method, instance
// accessor, static method), property/array/element round-trips, the full
// error/throw surface (incl. `code` + thrown-null must-not-abort),
// napi_instanceof, napi_run_script, napi_strict_equals. Built with stock
// node-gyp against Node's own headers (NAPI_VERSION=10).

#define NAPI_VERSION 10
#include <node_api.h>

#include <stdlib.h>
#include <string.h>

#define OK_OR_NULL(call)                                                       \
  do {                                                                         \
    if ((call) != napi_ok) return NULL;                                        \
  } while (0)

// ---- Counter class (the better-sqlite3 ObjectWrap shape) ----

typedef struct {
  int32_t count;
} Counter;

static napi_value CounterCtor(napi_env env, napi_callback_info info) {
  napi_value new_target = NULL;
  OK_OR_NULL(napi_get_new_target(env, info, &new_target));
  if (new_target == NULL) {
    // Plain call — reject like better-sqlite3's IsConstructCall guard.
    napi_throw_type_error(env, "ERR_NEW_REQUIRED",
                          "Class constructors cannot be invoked without 'new'");
    return NULL;
  }
  size_t argc = 1;
  napi_value arg, this_arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, &this_arg, NULL));
  int32_t initial = 0;
  if (argc > 0) {
    napi_valuetype t;
    OK_OR_NULL(napi_typeof(env, arg, &t));
    if (t == napi_number) {
      OK_OR_NULL(napi_get_value_int32(env, arg, &initial));
    }
  }
  Counter* state = malloc(sizeof(Counter));
  if (state == NULL) return NULL;
  state->count = initial;
  if (napi_wrap(env, this_arg, state, NULL, NULL, NULL) != napi_ok) {
    free(state);
    return NULL;
  }
  return this_arg;
}

static Counter* unwrap_counter(napi_env env, napi_callback_info info,
                               napi_value* this_out) {
  napi_value this_arg;
  if (napi_get_cb_info(env, info, NULL, NULL, &this_arg, NULL) != napi_ok)
    return NULL;
  void* state = NULL;
  if (napi_unwrap(env, this_arg, &state) != napi_ok) {
    napi_throw_type_error(env, "ERR_ILLEGAL_INVOCATION", "Illegal invocation");
    return NULL;
  }
  if (this_out != NULL) *this_out = this_arg;
  return (Counter*)state;
}

static napi_value CounterIncrement(napi_env env, napi_callback_info info) {
  Counter* state = unwrap_counter(env, info, NULL);
  if (state == NULL) return NULL;
  state->count++;
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, state->count, &out));
  return out;
}

static napi_value CounterGetValue(napi_env env, napi_callback_info info) {
  Counter* state = unwrap_counter(env, info, NULL);
  if (state == NULL) return NULL;
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, state->count, &out));
  return out;
}

static napi_value CounterSetValue(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  Counter* state = unwrap_counter(env, info, NULL);
  if (state == NULL) return NULL;
  OK_OR_NULL(napi_get_value_int32(env, arg, &state->count));
  return NULL;
}

static napi_value CounterDispose(napi_env env, napi_callback_info info) {
  napi_value this_arg;
  Counter* state = unwrap_counter(env, info, &this_arg);
  if (state == NULL) return NULL;
  void* removed = NULL;
  OK_OR_NULL(napi_remove_wrap(env, this_arg, &removed));
  free(removed);
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, removed == state, &out));
  return out;
}

static napi_value CounterDescribe(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_create_string_utf8(env, "Counter", NAPI_AUTO_LENGTH, &out));
  return out;
}

static napi_value DefineCounterClass(napi_env env) {
  napi_property_descriptor props[] = {
      {"increment", NULL, CounterIncrement, NULL, NULL, NULL,
       napi_default_method, NULL},
      {"value", NULL, NULL, CounterGetValue, CounterSetValue, NULL,
       napi_enumerable, NULL},
      {"dispose", NULL, CounterDispose, NULL, NULL, NULL, napi_default_method,
       NULL},
      {"describe", NULL, CounterDescribe, NULL, NULL, NULL,
       (napi_property_attributes)(napi_default_method | napi_static), NULL},
  };
  napi_value ctor = NULL;
  if (napi_define_class(env, "Counter", NAPI_AUTO_LENGTH, CounterCtor, NULL,
                        sizeof(props) / sizeof(*props), props,
                        &ctor) != napi_ok)
    return NULL;
  return ctor;
}

// ---- call / construct / must-not-abort ----

// callAndCatch(fn): napi_call_function; a thrown value (incl. null) is
// caught + returned as { threw, value }.
static napi_value CallAndCatch(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  napi_value recv;
  OK_OR_NULL(napi_get_undefined(env, &recv));
  napi_value call_result = NULL;
  napi_status s = napi_call_function(env, recv, args[0],
                                     argc > 1 ? 1 : 0, &args[1], &call_result);
  napi_value out, threw, value;
  OK_OR_NULL(napi_create_object(env, &out));
  if (s == napi_pending_exception) {
    OK_OR_NULL(napi_get_and_clear_last_exception(env, &value));
    OK_OR_NULL(napi_get_boolean(env, true, &threw));
  } else if (s == napi_ok) {
    value = call_result;
    OK_OR_NULL(napi_get_boolean(env, false, &threw));
  } else {
    return NULL;  // unexpected status
  }
  OK_OR_NULL(napi_set_named_property(env, out, "threw", threw));
  OK_OR_NULL(napi_set_named_property(env, out, "value", value));
  return out;
}

// callStatus(nonFn): status int of napi_call_function on a non-function.
static napi_value CallStatus(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_value recv;
  OK_OR_NULL(napi_get_undefined(env, &recv));
  napi_status s = napi_call_function(env, recv, arg, 0, NULL, NULL);
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)s, &out));
  return out;
}

// construct(ctor, arg): napi_new_instance.
static napi_value Construct(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  napi_value instance = NULL;
  OK_OR_NULL(napi_new_instance(env, args[0], argc > 1 ? 1 : 0, &args[1],
                               &instance));
  return instance;
}

// ---- property / element / array ops ----

static napi_value PropsExercise(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_create_object(env, &out));

  // Generic-key property ops on a fresh object.
  napi_value obj, key, val, got;
  OK_OR_NULL(napi_create_object(env, &obj));
  OK_OR_NULL(napi_create_string_utf8(env, "answer", NAPI_AUTO_LENGTH, &key));
  OK_OR_NULL(napi_create_int32(env, 42, &val));
  OK_OR_NULL(napi_set_property(env, obj, key, val));
  bool has = false, has_own = false, deleted = false, has_after = true;
  OK_OR_NULL(napi_has_property(env, obj, key, &has));
  OK_OR_NULL(napi_has_own_property(env, obj, key, &has_own));
  OK_OR_NULL(napi_get_property(env, obj, key, &got));
  int32_t got_i32 = 0;
  OK_OR_NULL(napi_get_value_int32(env, got, &got_i32));
  OK_OR_NULL(napi_delete_property(env, obj, key, &deleted));
  OK_OR_NULL(napi_has_property(env, obj, key, &has_after));

  // Element ops on an array.
  napi_value arr;
  OK_OR_NULL(napi_create_array_with_length(env, 3, &arr));
  for (uint32_t i = 0; i < 3; i++) {
    napi_value elem;
    OK_OR_NULL(napi_create_uint32(env, (i + 1) * 10, &elem));
    OK_OR_NULL(napi_set_element(env, arr, i, elem));
  }
  napi_value elem1;
  uint32_t elem1_u32 = 0, length = 0;
  OK_OR_NULL(napi_get_element(env, arr, 1, &elem1));
  OK_OR_NULL(napi_get_value_uint32(env, elem1, &elem1_u32));
  bool has_elem2 = false, deleted_elem = false, has_elem2_after = true,
       is_arr = false;
  OK_OR_NULL(napi_has_element(env, arr, 2, &has_elem2));
  OK_OR_NULL(napi_delete_element(env, arr, 2, &deleted_elem));
  OK_OR_NULL(napi_has_element(env, arr, 2, &has_elem2_after));
  OK_OR_NULL(napi_get_array_length(env, arr, &length));
  OK_OR_NULL(napi_is_array(env, arr, &is_arr));

  bool all_ok = has && has_own && got_i32 == 42 && deleted && !has_after &&
                elem1_u32 == 20 && has_elem2 && deleted_elem &&
                !has_elem2_after && length == 3 && is_arr;
  napi_value ok_v;
  OK_OR_NULL(napi_get_boolean(env, all_ok, &ok_v));
  OK_OR_NULL(napi_set_named_property(env, out, "ok", ok_v));
  OK_OR_NULL(napi_set_named_property(env, out, "arr", arr));
  return out;
}

// names(obj): napi_get_property_names (for-in style, protos, no symbols).
static napi_value Names(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_get_property_names(env, arg, &out));
  return out;
}

// ownNames(obj): all own keys incl. non-enumerable, numbers kept.
static napi_value OwnNames(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_get_all_property_names(env, arg, napi_key_own_only,
                                         napi_key_all_properties,
                                         napi_key_keep_numbers, &out));
  return out;
}

static napi_value Freeze(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  OK_OR_NULL(napi_object_freeze(env, arg));
  return arg;
}

static napi_value Seal(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  OK_OR_NULL(napi_object_seal(env, arg));
  return arg;
}

static napi_value Proto(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_get_prototype(env, arg, &out));
  return out;
}

// ---- errors ----

static napi_value MakeError(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_create_error(env, args[0], args[1], &out));
  return out;
}

static napi_value MakeTypeError(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_create_type_error(env, args[0], args[1], &out));
  return out;
}

static napi_value MakeRangeError(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_create_range_error(env, args[0], args[1], &out));
  return out;
}

static napi_value MakeSyntaxError(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  napi_value out;
  OK_OR_NULL(node_api_create_syntax_error(env, args[0], args[1], &out));
  return out;
}

static napi_value ThrowCoded(napi_env env, napi_callback_info info) {
  napi_throw_error(env, "ERR_GATE", "coded throw");
  return NULL;
}

static napi_value ThrowRange(napi_env env, napi_callback_info info) {
  napi_throw_range_error(env, "ERR_RANGE", "range throw");
  return NULL;
}

static napi_value IsError(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  bool is_err = false;
  OK_OR_NULL(napi_is_error(env, arg, &is_err));
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, is_err, &out));
  return out;
}

// errorWhilePending(): napi_create_error MUST work while an exception is
// pending (the better-sqlite3 SqliteError path). Throws, builds an error
// while pending, clears, returns the built error.
static napi_value ErrorWhilePending(napi_env env, napi_callback_info info) {
  napi_value pending_v, code, msg, built, cleared;
  OK_OR_NULL(napi_create_string_utf8(env, "pending", NAPI_AUTO_LENGTH,
                                     &pending_v));
  OK_OR_NULL(napi_throw(env, pending_v));
  bool is_pending = false;
  OK_OR_NULL(napi_is_exception_pending(env, &is_pending));
  if (!is_pending) return NULL;
  OK_OR_NULL(napi_create_string_utf8(env, "ERR_WHILE_PENDING",
                                     NAPI_AUTO_LENGTH, &code));
  OK_OR_NULL(napi_create_string_utf8(env, "built while pending",
                                     NAPI_AUTO_LENGTH, &msg));
  if (napi_create_error(env, code, msg, &built) != napi_ok) {
    napi_get_and_clear_last_exception(env, &cleared);
    return NULL;
  }
  OK_OR_NULL(napi_get_and_clear_last_exception(env, &cleared));
  return built;
}

// ---- instanceof / run_script / strict_equals ----

static napi_value InstanceOf(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  bool is_instance = false;
  OK_OR_NULL(napi_instanceof(env, args[0], args[1], &is_instance));
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, is_instance, &out));
  return out;
}

static napi_value RunScript(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_value out;
  OK_OR_NULL(napi_run_script(env, arg, &out));
  return out;
}

static napi_value StrictEquals(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  bool eq = false;
  OK_OR_NULL(napi_strict_equals(env, args[0], args[1], &eq));
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, eq, &out));
  return out;
}

// lossyUtf8(): invalid byte 0xFF must fold to U+FFFD (Node lossy semantics).
static napi_value LossyUtf8(napi_env env, napi_callback_info info) {
  const char bytes[] = {(char)0xFF, 'h', 'i'};
  napi_value out;
  OK_OR_NULL(napi_create_string_utf8(env, bytes, sizeof(bytes), &out));
  return out;
}

// propertyKey(): node_api_create_property_key_utf16 round-trip.
static napi_value PropertyKey(napi_env env, napi_callback_info info) {
  static const char16_t key[] = u"pk";
  napi_value out;
  OK_OR_NULL(node_api_create_property_key_utf16(env, key, 2, &out));
  return out;
}

// thisKind(): non-constructor `this` parity — 'global' | 'boxed:<typeof>'.
static napi_value ThisKind(napi_env env, napi_callback_info info) {
  napi_value this_arg, global;
  OK_OR_NULL(napi_get_cb_info(env, info, NULL, NULL, &this_arg, NULL));
  OK_OR_NULL(napi_get_global(env, &global));
  bool is_global = false;
  OK_OR_NULL(napi_strict_equals(env, this_arg, global, &is_global));
  napi_value out;
  if (is_global) {
    OK_OR_NULL(napi_create_string_utf8(env, "global", NAPI_AUTO_LENGTH, &out));
  } else {
    napi_valuetype t;
    OK_OR_NULL(napi_typeof(env, this_arg, &t));
    OK_OR_NULL(napi_create_string_utf8(
        env, t == napi_object ? "boxed:object" : "other", NAPI_AUTO_LENGTH,
        &out));
  }
  return out;
}

// ---- registration ----

static napi_status set_fn(napi_env env, napi_value exports, const char* name,
                          napi_callback cb) {
  napi_value fn;
  napi_status s =
      napi_create_function(env, name, NAPI_AUTO_LENGTH, cb, NULL, &fn);
  if (s != napi_ok) return s;
  return napi_set_named_property(env, exports, name, fn);
}

static napi_value Init(napi_env env, napi_value exports) {
#define EXPORT_FN(js_name, fn)                                                 \
  do {                                                                         \
    if (set_fn(env, exports, js_name, fn) != napi_ok) return NULL;             \
  } while (0)
  napi_value counter_ctor = DefineCounterClass(env);
  if (counter_ctor == NULL) return NULL;
  if (napi_set_named_property(env, exports, "Counter", counter_ctor) !=
      napi_ok)
    return NULL;
  EXPORT_FN("callAndCatch", CallAndCatch);
  EXPORT_FN("callStatus", CallStatus);
  EXPORT_FN("construct", Construct);
  EXPORT_FN("propsExercise", PropsExercise);
  EXPORT_FN("names", Names);
  EXPORT_FN("ownNames", OwnNames);
  EXPORT_FN("freeze", Freeze);
  EXPORT_FN("seal", Seal);
  EXPORT_FN("proto", Proto);
  EXPORT_FN("makeError", MakeError);
  EXPORT_FN("makeTypeError", MakeTypeError);
  EXPORT_FN("makeRangeError", MakeRangeError);
  EXPORT_FN("makeSyntaxError", MakeSyntaxError);
  EXPORT_FN("throwCoded", ThrowCoded);
  EXPORT_FN("throwRange", ThrowRange);
  EXPORT_FN("isError", IsError);
  EXPORT_FN("errorWhilePending", ErrorWhilePending);
  EXPORT_FN("instanceOf", InstanceOf);
  EXPORT_FN("runScript", RunScript);
  EXPORT_FN("strictEquals", StrictEquals);
  EXPORT_FN("lossyUtf8", LossyUtf8);
  EXPORT_FN("propertyKey", PropertyKey);
  EXPORT_FN("thisKind", ThisKind);
#undef EXPORT_FN
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
