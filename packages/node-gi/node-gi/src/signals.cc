// SPDX-License-Identifier: MIT
// Signals: JS closures, connect/emit/disconnect + the Gtk.Widget composite-template callback scope.

#include "common.h"

namespace nodegi {

// ---- signals (milestone 1) ----
//
// A GClosure that wraps a JS callback. The callback is held by a strong
// napi_ref; the closure's finalize notifier drops it. The generic marshal
// converts the signal's GValue params to JS — the EMITTER instance (param 0)
// first, then the signal's own params (1..n), matching GJS — and the JS return
// into the signal return GValue.
//
// Narrowed-leak semantics (with the toggle-ref bridge): a handler that does NOT
// close over its own object is now collectable once C is the sole owner
// (toggle-down → weak → GC). A handler that DOES close over its object forms a
// GObject -> GClosure -> napi_ref -> callback -> wrapper -> handle cycle the GC
// cannot break across C, so it keeps the object alive until disconnect — which is
// the GJS-faithful contract (a connected self-referential handler is a reason to
// stay alive). disconnect drops the closure's napi_ref (JsClosureFinalize),
// breaking the cycle so the next GC collects the object. The callback ref stays
// STRONG while connected (a connected handler must fire). Verified by the
// signal-cycle case in test/gc-identity.test.mjs.

struct JsClosureData {
  napi_env env;
  napi_ref callback;
};

static void JsClosureFinalize(gpointer data, GClosure* /*closure*/) {
  JsClosureData* jc = static_cast<JsClosureData*>(data);
  if (jc == nullptr) return;
  if (jc->callback != nullptr) napi_delete_reference(jc->env, jc->callback);
  g_free(jc);
}

static void JsClosureMarshalImpl(GClosure* closure, GValue* return_value, guint n_param_values,
                                 const GValue* param_values, bool unboxNestedValues) {
  JsClosureData* jc = static_cast<JsClosureData*>(closure->data);
  if (jc == nullptr || jc->callback == nullptr) return;
  // ENV-TEARDOWN GATE: a signal emitted by a dispose cascade at env teardown (or
  // on a terminating worker) reaches this marshal when the env may no longer
  // enter JS; the GValue marshalling / napi_call_function would then abort via
  // node-addon-api's noexcept throw path. Skip the handler — GJS likewise never
  // dispatches JS during GC/context teardown (see toggle.cc NodeGiJsAvailable).
  if (!NodeGiJsAvailable(jc->env)) {
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("signal closure skipped: JS unavailable on env %p (teardown/terminate)",
                           static_cast<void*>(jc->env));
    // The probe is also false when a JS exception is PENDING on a live env. Keep
    // the pre-existing depth semantics: a loop-dispatched closure (depth 0)
    // surfaces + clears so the pump stays alive; a synchronous emit leaves it
    // pending for the JS emit() caller. At real teardown Surface... is a no-op
    // (nothing pending / napi reads fail gracefully).
    if (g_syncEmitDepth == 0) SurfacePendingException(jc->env, "signal handler");
    return;
  }
  Napi::Env env(jc->env);
  Napi::HandleScope scope(env);

  napi_value cbv = nullptr;
  if (napi_get_reference_value(jc->env, jc->callback, &cbv) != napi_ok || cbv == nullptr) return;

  // GJS parity: the JS handler receives the EMITTER (the object the signal was
  // emitted on, param_values[0]) as its first argument, then the signal's own
  // parameters (param_values[1..n]). GJS passes the emitter first (refs/gjs
  // gi/value.cpp / object signal invocation), so a positional handler such as
  // `(listbox, row) => …` / `_onRowSelected(_listbox, row)` binds correctly. For
  // a `notify::x` emission the args are therefore (object, pspec), as in GJS.
  std::vector<napi_value> args;
  args.reserve(n_param_values);
  for (guint i = 0; i < n_param_values; i++) {
    // Generic (IN-arg) closures mirror gjs's closure marshal (refs/gjs/gi/
    // value.cpp gjs_value_from_g_value): a G_TYPE_VALUE-boxed param is UNBOXED to
    // the contained value (recursively), so e.g. GIMarshallingTests-style
    // `g_closure_invoke` consumers hand the JS function plain values, exactly as
    // GJS does. Signal closures keep the existing param conversion untouched.
    const GValue* pv = &param_values[i];
    if (unboxNestedValues) {
      while (G_VALUE_HOLDS(pv, G_TYPE_VALUE)) {
        const GValue* inner = static_cast<const GValue*>(g_value_get_boxed(pv));
        if (inner == nullptr) break;
        pv = inner;
      }
    }
    Napi::Value v = GValueToJs(env, pv);
    if (env.IsExceptionPending()) {
      // An arg-marshal failure: propagate to a synchronous emit() caller, or
      // surface + clear when dispatched from the loop (see g_syncEmitDepth).
      if (g_syncEmitDepth == 0) SurfacePendingException(jc->env, "signal handler");
      return;
    }
    args.push_back(v);
  }

  napi_value result = nullptr;
  napi_status st = napi_call_function(jc->env, env.Undefined(), cbv, args.size(), args.data(), &result);
  if (st != napi_ok) {
    // The handler threw. A synchronous emitSignal() (g_syncEmitDepth > 0) must
    // propagate it to the JS emit() caller (node-gi contract). At depth 0 there
    // is no JS caller to catch it, so it is surfaced + cleared (GJS-style) to keep
    // the GLib/libuv loop alive instead of wedging on the never-cleared pending
    // exception.
    //
    // BY DESIGN (GJS-aligned): depth 0 is NOT only the GLib loop's own dispatch (a
    // GTK click, a GtkBuilder template handler) — it ALSO covers synchronous-but-
    // not-emitSignal triggers: a notify:: from g_object_set / a property set, or an
    // inline C emit such as action.activate(). Those reach this marshal with no
    // emitSignal() frame on the stack (depth 0), so a handler throw is logged +
    // swallowed here rather than rethrown to the JS code that triggered the emit —
    // exactly as GJS reports an uncaught signal-handler exception (gjs_log_exception)
    // instead of surfacing it to the trigger site.
    if (g_syncEmitDepth == 0) SurfacePendingException(jc->env, "signal handler");
    return;
  }

  if (return_value != nullptr && (G_VALUE_TYPE(return_value) != G_TYPE_INVALID)) {
    JsToGValue(env, Napi::Value(jc->env, result), return_value);
    // The return marshal must never leave a pending JS exception across the
    // C boundary of a loop-dispatched invocation (same contract as the arg/call
    // paths above): surface + clear it so the GLib/libuv pump stays alive.
    if (env.IsExceptionPending() && g_syncEmitDepth == 0) {
      SurfacePendingException(jc->env, "signal handler");
    }
  }
}

// Signal-closure marshal (`.connect()`, template callbacks): params as-is.
static void JsClosureMarshal(GClosure* closure, GValue* return_value, guint n_param_values,
                             const GValue* param_values, gpointer /*invocation_hint*/,
                             gpointer /*marshal_data*/) {
  JsClosureMarshalImpl(closure, return_value, n_param_values, param_values, false);
}

// Generic-closure marshal (a JS fn marshalled as a GClosure IN-arg, invoked by
// arbitrary C via g_closure_invoke): identical to the signal marshal except that
// G_TYPE_VALUE-boxed params are unboxed to their contained value, mirroring gjs's
// gjs_value_from_g_value (see JsClosureMarshalImpl).
static void JsGenericClosureMarshal(GClosure* closure, GValue* return_value, guint n_param_values,
                                    const GValue* param_values, gpointer /*invocation_hint*/,
                                    gpointer /*marshal_data*/) {
  JsClosureMarshalImpl(closure, return_value, n_param_values, param_values, true);
}

// JS function → a floating marshaled GClosure (the engine's twin of GJS's
// Gjs::Closure::create_marshaled for "boxed" closure args — refs/gjs/gi/
// arg-cache.cpp GClosureInTransferNone::in). The closure holds a strong ref to
// the function; JsClosureFinalize drops it when the closure is invalidated /
// finalized (the callee released its last ref, or the invoke-site released the
// only ref because the callee never kept one). Ref/sink + release policy lives at
// the marshalling site (marshal.cc / calls.cc CreatedClosures).
GClosure* NodeGiMakeGenericJsClosure(Napi::Env env, Napi::Value fn) {
  JsClosureData* jc = g_new0(JsClosureData, 1);
  jc->env = env;
  napi_create_reference(env, fn, 1, &jc->callback);
  GClosure* closure = g_closure_new_simple(sizeof(GClosure), jc);
  g_closure_set_marshal(closure, JsGenericClosureMarshal);
  g_closure_add_finalize_notifier(closure, jc, JsClosureFinalize);
  return closure;
}

// connectSignal(handle, signalName, callback, after?) -> handlerId
Napi::Value ConnectSignal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsString() || !info[2].IsFunction()) {
    Napi::TypeError::New(env, "connectSignal(handle, signalName: string, callback: function, after?: boolean)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  // NodeGiToBool: terminate-safe (a swallowed coercion failure must not cascade
  // into Error::New(nullptr) — see common.h).
  bool after = info.Length() >= 4 && NodeGiToBool(info[3]);

  // Parse a possibly-detailed signal name ("notify::prop") into its signal id +
  // detail quark, so GJS-style detailed connects work (common for notify::).
  guint sigid = 0;
  GQuark detail = 0;
  if (!g_signal_parse_name(name.c_str(), G_OBJECT_TYPE(obj), &sigid, &detail, TRUE)) {
    Napi::Error::New(env, std::string("no signal '") + name + "' on " + G_OBJECT_TYPE_NAME(obj))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  JsClosureData* jc = g_new0(JsClosureData, 1);
  jc->env = env;
  napi_create_reference(env, info[2], 1, &jc->callback);

  GClosure* closure = g_closure_new_simple(sizeof(GClosure), jc);
  g_closure_set_marshal(closure, JsClosureMarshal);
  g_closure_add_finalize_notifier(closure, jc, JsClosureFinalize);

  // g_signal_connect_closure_by_id sinks the floating closure ref + owns it,
  // and honours the detail quark (the by-name variant cannot take a detail).
  gulong id = g_signal_connect_closure_by_id(obj, sigid, detail, closure, after);
  return Napi::Number::New(env, static_cast<double>(id));
}

// emitSignal(handle, signalName, args?) -> returnValue
Napi::Value EmitSignal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "emitSignal(handle, signalName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  GType gtype = G_OBJECT_TYPE(obj);
  guint sigid = g_signal_lookup(name.c_str(), gtype);
  if (sigid == 0) {
    Napi::Error::New(env, std::string("no signal '") + name + "' on " + G_OBJECT_TYPE_NAME(obj))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GSignalQuery query;
  g_signal_query(sigid, &query);

  guint n = query.n_params;
  std::vector<GValue> params(n + 1);  // [0] = instance
  g_value_init(&params[0], gtype);
  g_value_set_object(&params[0], obj);
  guint initialised = 1;
  bool ok = true;
  for (guint i = 0; i < n; i++) {
    GType pt = query.param_types[i] & ~G_SIGNAL_TYPE_STATIC_SCOPE;
    g_value_init(&params[i + 1], pt);
    initialised = i + 2;
    Napi::Value v = i < args.Length() ? args.Get(i) : env.Undefined();
    // An EMPTY v is the residue of a swallowed args.Get() failure (terminating
    // env / throwing getter): JsToGValue's coercions on it would abort via
    // Error::New(nullptr)'s fatal sites — bail before marshalling.
    if (v.IsEmpty() || !JsToGValue(env, v, &params[i + 1])) {
      ok = false;
      break;
    }
  }

  GType rt = query.return_type & ~G_SIGNAL_TYPE_STATIC_SCOPE;
  bool hasReturn = rt != G_TYPE_NONE && rt != G_TYPE_INVALID;
  GValue ret = G_VALUE_INIT;
  Napi::Value result = env.Undefined();
  if (ok) {
    if (hasReturn) g_value_init(&ret, rt);
    // Mark this as a SYNCHRONOUS emit so a handler exception propagates back to
    // this JS caller (JsClosureMarshal checks g_syncEmitDepth) rather than being
    // surfaced + swallowed like a loop-dispatched signal.
    g_syncEmitDepth++;
    g_signal_emitv(params.data(), sigid, 0, hasReturn ? &ret : nullptr);
    g_syncEmitDepth--;
    if (hasReturn && !env.IsExceptionPending()) {
      result = GValueToJs(env, &ret);
      g_value_unset(&ret);
    } else if (hasReturn) {
      g_value_unset(&ret);
    }
  }
  for (guint j = 0; j < initialised; j++) g_value_unset(&params[j]);
  return ok ? result : env.Null();
}

// disconnectSignal(handle, handlerId) -> void
Napi::Value DisconnectSignal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "disconnectSignal(handle, handlerId: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Undefined();
  gulong id = static_cast<gulong>(info[1].As<Napi::Number>().Int64Value());
  if (id != 0 && g_signal_handler_is_connected(obj, id)) {
    g_signal_handler_disconnect(obj, id);
  }
  return env.Undefined();
}

// GError domain for template-callback resolution failures surfaced to GtkBuilder.
static GQuark NodeGiBuilderErrorQuark() {
  static GQuark q = g_quark_from_static_string("node-gi-builder-error");
  return q;
}

// ---- Gtk.Widget composite-template callback dispatch -----------------------
//
// Mirrors GJS's TemplateBuilderScope (refs/gjs/modules/core/overrides/Gtk.js): a
// custom GtkBuilderScope is set on a templated widget class via
// gtk_widget_class_set_template_scope, so when GtkBuilder (run by init_template)
// hits a `<signal name="clicked" handler="on_click"/>` it asks the scope to
// create a closure for the handler NAME. We resolve that name to the instance's
// JS method and connect a closure that dispatches to it.
//
// Why a scope (generic resolver) and not gtk_widget_class_bind_template_callback
// (per-name C symbol): a GtkBuilderScope's create_closure returns a *GClosure*,
// which is signature-agnostic — GObject marshals the signal's GValue params into
// it at emit time, so one mechanism handles ANY signal shape without a per-signal
// libffi cif. A bound C-symbol callback would instead be invoked with the live
// signal ABI, which we cannot know at bind time. The returned closure reuses the
// existing JsClosure machinery (JsClosureMarshal/JsClosureFinalize), so the marshal
// + GValue→JS arg conversion + lifetime are identical to a normal `.connect()`.
//
// Handler name → JS method + `this`: create_closure calls the L1 resolver
// (gi.js resolveTemplateCallback) with the canonical wrapper of the widget being
// built (gtk_builder_get_current_object) and the handler name; L1 returns the
// user-prototype method already bound to that instance proxy (so `this` is the
// template widget — the same cached, toggle-ref-canonical L1 proxy the user holds)
// and wrapping each native signal arg into a chainable wrapper. The returned JS
// function is wrapped in a JsClosure here. arg marshalling: JsClosureMarshal skips
// the emitter (param 0, node-gi's signal convention) and passes the rest.

// The GtkBuilderScopeInterface vtable layout (stable public ABI — replicated so the
// addon needs no GTK headers; it only links girepository-2.0 and dlsym's GTK).
typedef GType (*NodeGiScopeTypeFromNameFn)(void*, void*, const char*);
typedef GType (*NodeGiScopeTypeFromFuncFn)(void*, void*, const char*);
typedef GClosure* (*NodeGiScopeCreateClosureFn)(void*, void*, const char*, guint, GObject*,
                                                GError**);
struct NodeGiBuilderScopeIface {
  GTypeInterface g_iface;
  NodeGiScopeTypeFromNameFn get_type_from_name;
  NodeGiScopeTypeFromFuncFn get_type_from_function;
  NodeGiScopeCreateClosureFn create_closure;
};

// create_closure: resolve `function_name` to the widget instance's JS method and
// return a JsClosure dispatching to it. Returns NULL + sets *error on any failure
// (handler not found, swapped flag, no env/resolver) so GtkBuilder aborts the build
// with a clear message instead of silently dropping the handler.
static GClosure* NodeGiScopeCreateClosure(void* selfScope, void* builder,
                                          const char* function_name, guint flags,
                                          GObject* object, GError** error) {
  const char* name = function_name != nullptr ? function_name : "?";
  // SWAPPED is unsupported (matches GJS's "_createClosure" guard).
  if (flags & 1u /* GTK_BUILDER_CLOSURE_SWAPPED */) {
    g_set_error(error, NodeGiBuilderErrorQuark(), 0,
                "node-gi: template signal flag 'swapped' is not supported (handler '%s')", name);
    return nullptr;
  }
  napi_env rawEnv = static_cast<napi_env>(
      g_object_get_qdata(G_OBJECT(selfScope), NodeGiScopeEnvQuark()));
  if (rawEnv == nullptr) {
    g_set_error(error, NodeGiBuilderErrorQuark(), 0,
                "node-gi: template scope has no live JS env to resolve handler '%s'", name);
    return nullptr;
  }
  const GtkTemplateApi* gtk = GetGtkTemplateApi();
  GObject* thisObj = object;
  if (thisObj == nullptr && gtk->builder_get_current_object != nullptr)
    thisObj = gtk->builder_get_current_object(builder);
  if (thisObj == nullptr) {
    g_set_error(error, NodeGiBuilderErrorQuark(), 0,
                "node-gi: no current object to bind template handler '%s'", name);
    return nullptr;
  }

  Napi::Env env(rawEnv);
  Napi::HandleScope hscope(env);

  NodeGiEnvData* d = EnvData(rawEnv);
  napi_value resolver = nullptr;
  if (d == nullptr || d->templateCallbackResolver == nullptr ||
      napi_get_reference_value(rawEnv, d->templateCallbackResolver, &resolver) != napi_ok ||
      resolver == nullptr) {
    g_set_error(error, NodeGiBuilderErrorQuark(), 0,
                "node-gi: no template-callback resolver registered (handler '%s')", name);
    return nullptr;
  }

  Napi::Value handleVal = WrapGObject(env, thisObj, GI_TRANSFER_NOTHING);
  napi_value args[2] = {handleVal, nullptr};
  napi_create_string_utf8(rawEnv, name, NAPI_AUTO_LENGTH, &args[1]);
  napi_value undef = nullptr;
  napi_get_undefined(rawEnv, &undef);
  napi_value resolved = nullptr;
  napi_status st = napi_call_function(rawEnv, undef, resolver, 2, args, &resolved);
  if (st != napi_ok) {
    // The resolver threw — never leave a pending JS exception across the return to
    // GTK (C). Clear it and fold its message into the GError so the build fails
    // cleanly.
    napi_value ex = nullptr;
    std::string detail;
    if (napi_get_and_clear_last_exception(rawEnv, &ex) == napi_ok && ex != nullptr) {
      napi_value msg = nullptr;
      if (napi_get_named_property(rawEnv, ex, "message", &msg) == napi_ok) {
        size_t len = 0;
        if (napi_get_value_string_utf8(rawEnv, msg, nullptr, 0, &len) == napi_ok) {
          detail.resize(len);
          napi_get_value_string_utf8(rawEnv, msg, detail.data(), len + 1, &len);
        }
      }
    }
    g_set_error(error, NodeGiBuilderErrorQuark(), 0,
                "node-gi: template handler '%s' resolver threw%s%s", name,
                detail.empty() ? "" : ": ", detail.c_str());
    return nullptr;
  }
  napi_valuetype rt = napi_undefined;
  napi_typeof(rawEnv, resolved, &rt);
  if (rt != napi_function) {
    g_set_error(error, NodeGiBuilderErrorQuark(), 0,
                "node-gi: no template handler '%s' defined on the instance", name);
    return nullptr;
  }

  // Wrap the resolved (instance-bound, arg-wrapping) JS function in a JsClosure —
  // the same closure type a `.connect()` produces. The closure owns a strong ref to
  // the function; g_object_watch_closure ties its lifetime to the widget (the
  // handler `this`) and invalidates it when the widget is finalized, exactly like
  // GtkBuilderCScope's own create_closure.
  JsClosureData* jc = g_new0(JsClosureData, 1);
  jc->env = rawEnv;
  napi_create_reference(rawEnv, resolved, 1, &jc->callback);
  GClosure* closure = g_closure_new_simple(sizeof(GClosure), jc);
  g_closure_set_marshal(closure, JsClosureMarshal);
  g_closure_add_finalize_notifier(closure, jc, JsClosureFinalize);
  g_object_watch_closure(thisObj, closure);
  return closure;
}

static void NodeGiBuilderScopeIfaceInit(gpointer g_iface, gpointer /*data*/) {
  // The per-type interface vtable is pre-filled with the GtkBuilderScope interface
  // defaults (get_type_from_name = g_type_from_name, etc.) before this runs, so we
  // only override create_closure — type resolution keeps GTK's default behaviour
  // (sufficient for templates whose object types are already registered).
  NodeGiBuilderScopeIface* iface = static_cast<NodeGiBuilderScopeIface*>(g_iface);
  iface->create_closure = NodeGiScopeCreateClosure;
}

// The GObject subtype implementing GtkBuilderScope (registered once). Returns 0 if
// the GTK scope API is unavailable (old/missing GTK) → callers skip the scope.
static GType NodeGiBuilderScopeGetType() {
  static GType type = 0;
  if (type != 0) return type;
  const GtkTemplateApi* gtk = GetGtkTemplateApi();
  if (gtk->builder_scope_get_type == nullptr || gtk->set_template_scope == nullptr) return 0;
  GType ifaceType = gtk->builder_scope_get_type();
  if (ifaceType == 0) return 0;

  GTypeInfo info = {};
  info.class_size = sizeof(GObjectClass);
  info.instance_size = sizeof(GObject);
  type = g_type_register_static(G_TYPE_OBJECT, "NodeGiBuilderScope", &info,
                                static_cast<GTypeFlags>(0));
  if (type == 0) return 0;
  GInterfaceInfo ifaceInfo = {NodeGiBuilderScopeIfaceInit, nullptr, nullptr};
  g_type_add_interface_static(type, ifaceType, &ifaceInfo);
  return type;
}

// Create the class's template-callback scope and install it (class_init). Holds the
// scope for the class lifetime (process-permanent, like NodeGiClassData) so its env
// qdata can be refreshed per construction. A no-op when the GTK scope API is absent.
void NodeGiInstallTemplateScopeOnClass(NodeGiClassData* cd, gpointer g_class) {
  const GtkTemplateApi* gtk = GetGtkTemplateApi();
  if (gtk->set_template_scope == nullptr) return;  // older GTK: callbacks unsupported
  GType scopeType = NodeGiBuilderScopeGetType();
  if (scopeType == 0) return;
  GObject* scope = static_cast<GObject*>(g_object_new(scopeType, nullptr));
  if (scope == nullptr) return;
  gtk->set_template_scope(g_class, scope);  // the class takes its own ref
  cd->templateScope = scope;                // our class-lifetime ref (env-refresh target)
}

// setTemplateCallbackResolver(fn) -> void. L1 registers the resolver that maps a
// (instanceHandle, handlerName) to the instance's bound JS method (see gi.js).
Napi::Value SetTemplateCallbackResolver(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "setTemplateCallbackResolver(resolver: function)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr) return env.Undefined();
  if (d->templateCallbackResolver != nullptr) {
    napi_delete_reference(env, d->templateCallbackResolver);
    d->templateCallbackResolver = nullptr;
  }
  napi_create_reference(env, info[0], 1, &d->templateCallbackResolver);
  return env.Undefined();
}

}  // namespace nodegi
