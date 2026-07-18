// SPDX-License-Identifier: MIT
// GjsPrivate-mirroring helpers: the structured-log writer func + the
// bind_property_full / BindingGroup.bind_full transform trampolines.
//
// Reference: refs/gjs/libgjs-private/gjs-util.c (gjs_log_set_writer_func /
// gjs_log_writer_func_wrapper / gjs_log_set_writer_default /
// gjs_g_object_bind_property_full / gjs_g_binding_group_bind_full). GJS routes
// these APIs through a private C library instead of introspection because:
//   • a GLogWriterFunc can fire on ANY thread, but JS only runs on the thread
//     that registered the writer — off-thread logs must fall back to the default
//     writer in C, before any JS is entered;
//   • the GLogField array (key + length-or-NUL-terminated value) is not
//     generically introspectable — the C wrapper converts it field-by-field;
//   • the binding transform's `to_value` is a WRITE-BACK GValue pre-initialised
//     to the target property's type; a marshaled GClosure (which unboxes GValue
//     params, per gjs's own closure marshal) cannot reach it, so gjs — and we —
//     use plain C transform callbacks with g_object_bind_property_full.
// node-gi mirrors that architecture 1:1 so the JS-visible contract matches gjs
// byte-for-byte (verified: scratch gold runs vs gjs 1.88 — see the test file).

#include <cstring>

#include "common.h"

namespace nodegi {

// ---- GLib.log_set_writer_func ----------------------------------------------
//
// Process-global writer state, mirroring gjs-util.c's statics. GLib enforces at
// most ONE g_log_set_writer_func call per process (a second call is a fatal
// g_error — gjs behaves identically), so a single static slot is faithful.
static bool g_logWriterCleared = false;
static napi_env g_logWriterEnv = nullptr;
static napi_ref g_logWriterFn = nullptr;
static GThread* g_logWriterThread = nullptr;

// Env teardown with the writer still installed: logs after this point must go to
// the default writer, and the napi_ref must not be touched on a dead env.
static void LogWriterEnvCleanup(void* arg) {
  if (g_logWriterEnv != static_cast<napi_env>(arg)) return;
  g_logWriterCleared = true;
  // Deleting the ref during env cleanup is safe (the env is still tearing down,
  // not freed); afterwards the wrapper never dereferences it again.
  if (g_logWriterFn != nullptr) {
    napi_delete_reference(g_logWriterEnv, g_logWriterFn);
    g_logWriterFn = nullptr;
  }
  g_logWriterEnv = nullptr;
}

// The C writer installed into GLib — the twin of gjs_log_writer_func_wrapper.
// Converts the GLogField array to a plain JS object whose values match gjs's
// `{...stringFields.recursiveUnpack()}` shape exactly (verified vs gjs 1.88):
//   length < 0 (NUL-terminated) → Uint8Array of strlen bytes
//   length > 0 (binary)         → Uint8Array of length bytes
//   length == 0                 → null (gjs packs a maybe-nothing → null)
// and calls the JS writer as (logLevel: number, fields: object) expecting a
// GLib.LogWriterOutput number back; UNHANDLED (or a throw, or an off-thread /
// cleared / teardown call) falls back to g_log_writer_default.
static GLogWriterOutput NodeGiLogWriterWrapper(GLogLevelFlags log_level, const GLogField* fields,
                                               gsize n_fields, gpointer /*user_data*/) {
  if (g_logWriterCleared || g_thread_self() != g_logWriterThread || g_logWriterFn == nullptr ||
      g_logWriterEnv == nullptr) {
    return g_log_writer_default(log_level, fields, n_fields, nullptr);
  }
  napi_env env = g_logWriterEnv;
  if (!NodeGiJsAvailable(env)) {
    return g_log_writer_default(log_level, fields, n_fields, nullptr);
  }
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);

  // Field values are plain Uint8Arrays (NOT Node Buffers): gjs's recursiveUnpack
  // of the maybe-bytestring fields yields Uint8Array — and e.g. JSON.stringify of
  // the two differs, so the distinction is observable byte-for-byte.
  auto bytesValue = [&](const void* data, size_t len) -> Napi::Value {
    Napi::Uint8Array arr = Napi::Uint8Array::New(env, len);
    if (len > 0) memcpy(arr.Data(), data, len);
    return arr;
  };
  Napi::Object obj = Napi::Object::New(napiEnv);
  for (gsize i = 0; i < n_fields; i++) {
    const GLogField* field = &fields[i];
    if (field->key == nullptr) continue;
    Napi::Value value;
    if (field->length < 0) {
      const char* s = static_cast<const char*>(field->value);
      value = bytesValue(s, s != nullptr ? strlen(s) : 0);
    } else if (field->length > 0) {
      value = bytesValue(field->value, static_cast<size_t>(field->length));
    } else {
      value = napiEnv.Null();
    }
    obj.Set(field->key, value);
  }

  napi_value fn = nullptr;
  if (napi_get_reference_value(env, g_logWriterFn, &fn) != napi_ok || fn == nullptr) {
    return g_log_writer_default(log_level, fields, n_fields, nullptr);
  }
  napi_value global = nullptr;
  napi_get_global(env, &global);
  napi_value args[2] = {Napi::Number::New(napiEnv, static_cast<double>(log_level)), obj};
  napi_value ret = nullptr;
  napi_status st = napi_make_callback(env, nullptr, global, fn, 2, args, &ret);
  if (st != napi_ok || napiEnv.IsExceptionPending()) {
    // A throwing writer must never wedge the logging path (nor leave a pending
    // exception across the C boundary): surface + clear, then default-write.
    SurfacePendingException(env, "GLib log writer func");
    return g_log_writer_default(log_level, fields, n_fields, nullptr);
  }
  GLogWriterOutput output =
      static_cast<GLogWriterOutput>(NodeGiToInt32(Napi::Value(env, ret)));
  if (output == G_LOG_WRITER_UNHANDLED) {
    return g_log_writer_default(log_level, fields, n_fields, nullptr);
  }
  return output;
}

// logSetWriterFunc(fn | null) -> void. Installs the wrapper into GLib (a second
// call aborts inside GLib itself — "g_log_set_writer_func() called multiple
// times" — exactly as under gjs). fn == null re-arms the default fallback.
Napi::Value LogSetWriterFunc(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Value fn = info.Length() >= 1 ? info[0] : env.Null();

  // Replace any previous JS-side state (the GLib-side wrapper can only ever be
  // installed once; the JS fn/env slots are ours to swap).
  if (g_logWriterFn != nullptr && g_logWriterEnv != nullptr) {
    napi_delete_reference(g_logWriterEnv, g_logWriterFn);
    g_logWriterFn = nullptr;
  }
  g_logWriterEnv = env;
  g_logWriterThread = g_thread_self();
  g_logWriterCleared = false;
  if (fn.IsFunction()) {
    napi_create_reference(env, fn, 1, &g_logWriterFn);
  }
  // The cleanup hook is registered once (adding an identical fn+arg pair twice is
  // an N-API fatal). GLib itself enforces at most one g_log_set_writer_func call
  // per process, so a single hook covers every reachable state.
  static bool hookAdded = false;
  if (!hookAdded) {
    napi_add_env_cleanup_hook(env, LogWriterEnvCleanup, env);
    hookAdded = true;
  }
  g_log_set_writer_func(NodeGiLogWriterWrapper, nullptr, nullptr);
  return env.Undefined();
}

// logSetWriterDefault() -> void. The twin of gjs_log_set_writer_default: the
// GLib-side writer stays installed (it can never be swapped back), but every
// subsequent log is routed to g_log_writer_default by the cleared flag.
Napi::Value LogSetWriterDefault(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_logWriterFn != nullptr && g_logWriterEnv != nullptr) {
    napi_delete_reference(g_logWriterEnv, g_logWriterFn);
    g_logWriterFn = nullptr;
  }
  g_logWriterEnv = nullptr;
  g_logWriterThread = g_thread_self();
  g_logWriterCleared = true;
  return env.Undefined();
}

// ---- bind_property_full / BindingGroup.bind_full ---------------------------
//
// The twin of gjs_g_object_bind_property_full: the JS transform functions are
// held per binding and driven by plain C GBindingTransformFunc trampolines. The
// JS contract (gjs gold standard, verified vs gjs 1.88):
//   (binding, sourceValue) => [ok: boolean, targetValue]
// — sourceValue arrives UNPACKED, a truthy ok writes targetValue into the
// pre-initialised target GValue, [false, …] leaves the target unchanged, and a
// non-Array return is reported (gjs logs "returned unexpected value, expecting
// an Array") and treated as no-transform.
struct NodeGiBindingTransforms {
  napi_env env;
  napi_ref toFn;    // nullptr when no transform-to
  napi_ref fromFn;  // nullptr when no transform-from
};

static gboolean NodeGiBindingTransformInvoke(GBinding* binding, const GValue* from_value,
                                             GValue* to_value, NodeGiBindingTransforms* data,
                                             napi_ref fnRef) {
  if (data == nullptr || fnRef == nullptr) return FALSE;
  napi_env env = data->env;
  // A binding transform fired at env teardown (a dispose cascade) must not enter
  // JS — treat as no-transform, like the signal/callback teardown gates.
  if (!NodeGiJsAvailable(env)) return FALSE;
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);

  napi_value fn = nullptr;
  if (napi_get_reference_value(env, fnRef, &fn) != napi_ok || fn == nullptr) return FALSE;

  napi_value args[2] = {WrapGObject(napiEnv, G_OBJECT(binding), GI_TRANSFER_NOTHING),
                        GValueToJs(napiEnv, from_value)};
  if (napiEnv.IsExceptionPending()) {
    SurfacePendingException(env, "property binding transform");
    return FALSE;
  }
  napi_value global = nullptr;
  napi_get_global(env, &global);
  napi_value ret = nullptr;
  napi_status st = napi_make_callback(env, nullptr, global, fn, 2, args, &ret);
  if (st != napi_ok || napiEnv.IsExceptionPending()) {
    SurfacePendingException(env, "property binding transform");
    return FALSE;
  }
  Napi::Value retVal(env, ret);
  if (!retVal.IsArray()) {
    // gjs: "Call to unnamed function (GjsPrivate.BindingTransformFunc) returned
    // unexpected value, expecting an Array" — logged, transform treated as FALSE.
    g_printerr("\n(node-gi) property binding transform returned unexpected value, "
               "expecting an Array [ok, value]\n");
    return FALSE;
  }
  Napi::Array arr = retVal.As<Napi::Array>();
  if (!NodeGiToBool(arr.Get(uint32_t{0}))) return FALSE;
  if (!JsToGValue(napiEnv, arr.Get(uint32_t{1}), to_value)) {
    SurfacePendingException(env, "property binding transform");
    return FALSE;
  }
  return TRUE;
}

static gboolean NodeGiBindingTransformTo(GBinding* binding, const GValue* from_value,
                                         GValue* to_value, gpointer user_data) {
  NodeGiBindingTransforms* data = static_cast<NodeGiBindingTransforms*>(user_data);
  return NodeGiBindingTransformInvoke(binding, from_value, to_value, data,
                                      data != nullptr ? data->toFn : nullptr);
}

static gboolean NodeGiBindingTransformFrom(GBinding* binding, const GValue* from_value,
                                           GValue* to_value, gpointer user_data) {
  NodeGiBindingTransforms* data = static_cast<NodeGiBindingTransforms*>(user_data);
  return NodeGiBindingTransformInvoke(binding, from_value, to_value, data,
                                      data != nullptr ? data->fromFn : nullptr);
}

// GDestroyNotify for the transforms — runs when the binding is destroyed
// (unbind / source finalized). Deleting a napi_ref needs a live env; at real env
// teardown the refs are reclaimed with the env, so skipping is leak-free.
static void NodeGiBindingTransformsFree(gpointer user_data) {
  NodeGiBindingTransforms* data = static_cast<NodeGiBindingTransforms*>(user_data);
  if (data == nullptr) return;
  if (NodeGiJsAvailable(data->env)) {
    if (data->toFn != nullptr) napi_delete_reference(data->env, data->toFn);
    if (data->fromFn != nullptr) napi_delete_reference(data->env, data->fromFn);
  }
  delete data;
}

// Shared arg parsing + invocation for bindPropertyFull / bindingGroupBindFull.
// info: (sourceHandle|groupHandle, sourceProperty, targetHandle, targetProperty,
//        flags, toFn|null, fromFn|null)
static bool ParseBindFullArgs(const Napi::CallbackInfo& info, GObject** instance,
                              std::string* sourceProp, GObject** target, std::string* targetProp,
                              GBindingFlags* flags, NodeGiBindingTransforms** outData) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[1].IsString() || !info[3].IsString()) {
    Napi::TypeError::New(env,
                         "bindPropertyFull(handle, sourceProperty: string, targetHandle, "
                         "targetProperty: string, flags: number, transformTo?, transformFrom?)")
        .ThrowAsJavaScriptException();
    return false;
  }
  *instance = UnwrapGObject(env, info[0]);
  if (*instance == nullptr) return false;
  *sourceProp = info[1].As<Napi::String>().Utf8Value();
  *target = UnwrapGObject(env, info[2]);
  if (*target == nullptr) return false;
  *targetProp = info[3].As<Napi::String>().Utf8Value();
  *flags = static_cast<GBindingFlags>(NodeGiToInt32(info[4]));

  Napi::Value toFn = info.Length() >= 6 ? info[5] : env.Null();
  Napi::Value fromFn = info.Length() >= 7 ? info[6] : env.Null();
  bool hasTo = toFn.IsFunction();
  bool hasFrom = fromFn.IsFunction();
  NodeGiBindingTransforms* data = nullptr;
  if (hasTo || hasFrom) {
    data = new NodeGiBindingTransforms();
    data->env = env;
    data->toFn = nullptr;
    data->fromFn = nullptr;
    if (hasTo) napi_create_reference(env, toFn, 1, &data->toFn);
    if (hasFrom) napi_create_reference(env, fromFn, 1, &data->fromFn);
  }
  *outData = data;
  return true;
}

// bindPropertyFull(sourceHandle, sourceProperty, targetHandle, targetProperty,
//                  flags, transformTo|null, transformFrom|null) -> Binding handle
Napi::Value BindPropertyFull(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GObject* source = nullptr;
  GObject* target = nullptr;
  std::string sourceProp, targetProp;
  GBindingFlags flags = G_BINDING_DEFAULT;
  NodeGiBindingTransforms* data = nullptr;
  if (!ParseBindFullArgs(info, &source, &sourceProp, &target, &targetProp, &flags, &data)) {
    return env.Null();
  }
  GBinding* binding = g_object_bind_property_full(
      source, sourceProp.c_str(), target, targetProp.c_str(), flags,
      data != nullptr && data->toFn != nullptr ? NodeGiBindingTransformTo : nullptr,
      data != nullptr && data->fromFn != nullptr ? NodeGiBindingTransformFrom : nullptr, data,
      data != nullptr ? NodeGiBindingTransformsFree : nullptr);
  if (binding == nullptr) {
    // g_object_bind_property_full already freed `data` via the destroy notify on
    // its g_return_val_if_fail paths? It does NOT (precondition failures return
    // before adopting user_data) — free it here so a bad property name doesn't
    // leak the refs.
    NodeGiBindingTransformsFree(data);
    Napi::Error::New(env, "bind_property_full failed (unknown property?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // The binding return is (transfer none) — WrapGObject takes its own ref.
  return WrapGObject(env, G_OBJECT(binding), GI_TRANSFER_NOTHING);
}

// bindingGroupBindFull(groupHandle, sourceProperty, targetHandle, targetProperty,
//                      flags, transformTo|null, transformFrom|null) -> undefined
// The twin of gjs_g_binding_group_bind_full (GObject.BindingGroup.bind_full).
Napi::Value BindingGroupBindFull(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GObject* group = nullptr;
  GObject* target = nullptr;
  std::string sourceProp, targetProp;
  GBindingFlags flags = G_BINDING_DEFAULT;
  NodeGiBindingTransforms* data = nullptr;
  if (!ParseBindFullArgs(info, &group, &sourceProp, &target, &targetProp, &flags, &data)) {
    return env.Undefined();
  }
  if (!G_IS_BINDING_GROUP(group)) {
    NodeGiBindingTransformsFree(data);
    Napi::TypeError::New(env, "bind_full: expected a GObject.BindingGroup instance")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  g_binding_group_bind_full(
      G_BINDING_GROUP(group), sourceProp.c_str(), target, targetProp.c_str(), flags,
      data != nullptr && data->toFn != nullptr ? NodeGiBindingTransformTo : nullptr,
      data != nullptr && data->fromFn != nullptr ? NodeGiBindingTransformFrom : nullptr, data,
      data != nullptr ? NodeGiBindingTransformsFree : nullptr);
  return env.Undefined();
}

}  // namespace nodegi
