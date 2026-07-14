// SPDX-License-Identifier: MIT
// GI invocation: JS callbacks (ffi closures), GError -> GLib.Error, the shared invoke core + call entry points.

#include "common.h"

namespace nodegi {

// Shared invocation core: marshal the JS args into a GIArgument vector (the
// instance prepended for methods), call gi_function_info_invoke, marshal the
// return + any OUT/INOUT values. IN is passed by value; OUT/INOUT route through
// a per-arg storage slot whose address the invoker hands the C callee. The JS
// return follows the GJS convention (see InvokeFunctionInfo).
// ---- callbacks (JS function -> GI callback via an ffi closure) ----
//
// A JS function passed where a GI callback is expected (e.g. GLib.timeout_add's
// GSourceFunc) is wrapped in an ffi closure created by girepository
// (gi_callable_info_create_closure). When the C library invokes it, the
// trampoline marshals the C args to JS, calls the function, and marshals the
// return back. The function's associated user_data slot carries the wrapper
// pointer and the destroy-notify slot frees it (scope = notified); call-scope
// closures are freed by the caller after the invoke; async closures free
// themselves after the first call. Reference: refs/node-gtk src/callback.cc.
struct NodeGiCallback {
  napi_env env;
  napi_ref jsFn;
  GICallableInfo* info;  // the callback type (owned)
  ffi_cif cif;
  ffi_closure* closure;  // from gi_callable_info_create_closure
  gpointer native;       // executable trampoline address
  GIScopeType scope;
};

static void NodeGiCallbackFree(NodeGiCallback* cb) {
  if (cb == nullptr) return;
  if (cb->jsFn != nullptr) napi_delete_reference(cb->env, cb->jsFn);
  if (cb->closure != nullptr) gi_callable_info_destroy_closure(cb->info, cb->closure);
  if (cb->info != nullptr) gi_base_info_unref(cb->info);
  delete cb;
}

// GDestroyNotify for scope=notified callbacks; user_data is the NodeGiCallback*.
static void NodeGiCallbackDestroyNotify(gpointer user_data) {
  NodeGiCallbackFree(static_cast<NodeGiCallback*>(user_data));
}

// One-shot GSourceFunc that frees a scope=async callback AFTER its single
// invocation. A GAsyncReadyCallback fires exactly once and has no destroy-notify,
// so the trampoline schedules this on the main loop once the call returns —
// freeing it inline would destroy the ffi closure's own executable trampoline
// while it is still on the call stack (UB). See NodeGiCallbackTrampoline tail.
static gboolean NodeGiCallbackFreeIdle(gpointer user_data) {
  NodeGiCallbackFree(static_cast<NodeGiCallback*>(user_data));
  return G_SOURCE_REMOVE;
}

// girepository-2.0's closure/destroy index getters are out-param + gboolean;
// return the index or -1 when the arg has no associated slot.
static int ArgClosureIndex(GIArgInfo* ai) {
  unsigned int idx = 0;
  return gi_arg_info_get_closure_index(ai, &idx) ? static_cast<int>(idx) : -1;
}
static int ArgDestroyIndex(GIArgInfo* ai) {
  unsigned int idx = 0;
  return gi_arg_info_get_destroy_index(ai, &idx) ? static_cast<int>(idx) : -1;
}

// Depth of a synchronous emitSignal() in progress on the (main) thread. While
// > 0, a signal-handler exception must PROPAGATE to the JS emit() caller (the
// node-gi contract — see test/signals.test.mjs "a handler exception propagates
// out of emit"). At depth 0 the closure was dispatched from the GLib main loop (a
// GTK signal, a notify::, a template handler) where there is NO JS caller to
// catch it, so it is surfaced + cleared (below) to keep the loop alive instead of
// wedging libuv on a never-cleared pending exception.
int g_syncEmitDepth = 0;

// Surface (log) + clear a pending JS exception left by a C-invoked callback so it
// cannot wedge the GLib/libuv main loop. A signal handler / idle / timeout that
// throws is reported to stderr (message + stack) and swallowed — mirroring how
// GJS reports an uncaught signal-handler exception (gjs_log_exception) instead of
// crashing the loop. Uses g_printerr, NOT g_warning, so a G_DEBUG=fatal-warnings
// test environment cannot turn a reported handler bug into an abort. No-op when
// nothing is pending. Returns true if it cleared an exception.
bool SurfacePendingException(napi_env env, const char* context) {
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) != napi_ok || !pending) return false;
  napi_value ex = nullptr;
  if (napi_get_and_clear_last_exception(env, &ex) != napi_ok || ex == nullptr) return false;

  // Prefer Error.stack (message + trace); fall back to String(ex).
  std::string text;
  napi_value field = nullptr;
  napi_valuetype vt = napi_undefined;
  if (napi_get_named_property(env, ex, "stack", &field) == napi_ok &&
      napi_typeof(env, field, &vt) == napi_ok && vt == napi_string) {
    size_t len = 0;
    if (napi_get_value_string_utf8(env, field, nullptr, 0, &len) == napi_ok) {
      text.resize(len);
      napi_get_value_string_utf8(env, field, text.data(), len + 1, &len);
    }
  }
  if (text.empty()) {
    napi_value str = nullptr;
    if (napi_coerce_to_string(env, ex, &str) == napi_ok) {
      size_t len = 0;
      if (napi_get_value_string_utf8(env, str, nullptr, 0, &len) == napi_ok) {
        text.resize(len);
        napi_get_value_string_utf8(env, str, text.data(), len + 1, &len);
      }
    }
  }
  g_printerr("\n(node-gi) Unhandled exception in %s:\n%s\n", context,
             text.empty() ? "<no message>" : text.c_str());

  // Building `text` above can itself run user JS — a throwing `stack` getter
  // (napi_get_named_property) or a throwing `toString` (napi_coerce_to_string) —
  // which leaves a NEW pending exception. If we returned now the caller would be
  // env-dirty and could wedge the loop exactly like the original throw. Re-check
  // and clear so the env is guaranteed clean on return.
  bool stillPending = false;
  if (napi_is_exception_pending(env, &stillPending) == napi_ok && stillPending) {
    napi_value ignored = nullptr;
    napi_get_and_clear_last_exception(env, &ignored);
  }
  return true;
}

// RAII: pin g_syncEmitDepth to 0 for the duration of a LOOP-DISPATCHED callback,
// restoring the prior value on scope exit. g_syncEmitDepth marks "a synchronous
// emitSignal() is on the stack" — but a synchronous handler may re-enter the GLib
// loop (a nested loop.run() / g_main_context_iteration, or a blocking GIO call that
// pumps the context). Any closure the NESTED loop dispatches (a notify:: from
// g_object_set inside a timeout, a GTK signal) is genuinely loop-dispatched and has
// no JS emit() caller to catch its throw, yet the global counter would still read
// > 0 and JsClosureMarshal would leave the exception PENDING → DrainMicrotasks
// early-returns → the libuv↔GLib pump wedges. Resetting to 0 across the loop-
// dispatch boundary makes those closures evaluate at depth 0 (surface + clear),
// while the OUTER synchronous emit() — resumed once the nested loop returns and the
// prior depth is restored — still propagates its own handler's throw.
struct SyncEmitDepthReset {
  int saved;
  SyncEmitDepthReset() : saved(g_syncEmitDepth) { g_syncEmitDepth = 0; }
  ~SyncEmitDepthReset() { g_syncEmitDepth = saved; }
};

// The ffi closure entry point: marshal C args -> JS, call the JS fn, marshal the
// JS return -> C. Runs on the main thread (the GLib loop the bridge pumps).
static void NodeGiCallbackTrampoline(ffi_cif* /*cif*/, void* result, void** args,
                                     gpointer user_data) {
  NodeGiCallback* cb = static_cast<NodeGiCallback*>(user_data);
  napi_env env = cb->env;
  // ENV-TEARDOWN GATE: an idle/timeout/async callback (or a destroy-notify-driven
  // one) can fire while the env may no longer enter JS (env cleanup, worker
  // terminate). Re-entering N-API then aborts via node-addon-api's noexcept throw
  // path — degrade to a no-op with a zeroed return slot instead (see toggle.cc).
  if (!NodeGiJsAvailable(env)) {
    if (result != nullptr) static_cast<GIArgument*>(result)->v_uint64 = 0;
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("GI callback skipped: JS unavailable on env %p (teardown/terminate)",
                           static_cast<void*>(env));
    // The probe is also false when a JS exception is PENDING on a live env. Keep
    // the pre-existing scope semantics: a loop-dispatched (non-CALL) callback
    // surfaces + clears so the pump stays alive; a CALL-scope callback leaves it
    // pending for the JS invoke caller. At real teardown Surface... is a no-op.
    if (cb->scope != GI_SCOPE_TYPE_CALL) {
      SurfacePendingException(env, "GI callback (idle/timeout/async)");
    }
    // scope=async frees exactly once via the trampoline (see below) — keep that
    // contract even when the JS dispatch is skipped, so the closure is not leaked.
    if (cb->scope == GI_SCOPE_TYPE_ASYNC) {
      g_idle_add_full(G_PRIORITY_DEFAULT, NodeGiCallbackFreeIdle, cb, nullptr);
    }
    return;
  }
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);
  // An idle/timeout/async (NOTIFIED/ASYNC scope) callback is dispatched FROM the
  // GLib loop. Pin the synchronous-emit depth to 0 so a signal this callback emits
  // (e.g. a notify:: from g_object_set) is treated as loop-dispatched even when a
  // synchronous emitSignal() is suspended higher on the stack across a nested loop.
  // A CALL-scope callback runs synchronously inside a JS-initiated GI invoke, so it
  // keeps the ambient depth (its exception must reach that JS caller).
  std::unique_ptr<SyncEmitDepthReset> depthReset;
  if (cb->scope != GI_SCOPE_TYPE_CALL) depthReset = std::make_unique<SyncEmitDepthReset>();

  GICallableInfo* ci = cb->info;
  unsigned int n = gi_callable_info_get_n_args(ci);
  std::vector<napi_value> jsArgs;
  jsArgs.reserve(n);
  bool ok = true;
  for (unsigned int i = 0; i < n; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    // ffi hands each argument's storage as args[i]; reinterpret as a GIArgument
    // union (a user_data/void arg marshals to undefined, which JS ignores).
    Napi::Value v = GIArgumentToJs(napiEnv, ti, static_cast<GIArgument*>(args[i]), GI_TRANSFER_NOTHING);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
    if (napiEnv.IsExceptionPending()) {
      ok = false;
      break;
    }
    jsArgs.push_back(v);
  }

  // Zero the result slot first (it is >= ffi_arg wide; narrow returns leave the
  // upper bytes indeterminate otherwise).
  if (result != nullptr) static_cast<GIArgument*>(result)->v_uint64 = 0;

  GITypeInfo* retType = gi_callable_info_get_return_type(ci);
  if (ok) {
    napi_value fn = nullptr;
    if (napi_get_reference_value(env, cb->jsFn, &fn) == napi_ok && fn != nullptr) {
      napi_value global = nullptr;
      napi_get_global(env, &global);
      napi_value ret = nullptr;
      // napi_make_callback drains nextTick/microtasks around the call.
      napi_status st = napi_make_callback(env, nullptr, global, fn, jsArgs.size(), jsArgs.data(), &ret);
      if (st == napi_ok && result != nullptr) {
        GITypeTag rtag = gi_type_info_get_tag(retType);
        if (rtag == GI_TYPE_TAG_UTF8 || rtag == GI_TYPE_TAG_FILENAME) {
          // Hand the caller an owned copy — a JsToGIArgument string would point
          // into a std::string that dies with this frame.
          Napi::Value rv(env, ret);
          static_cast<GIArgument*>(result)->v_string =
              rv.IsString() ? g_strdup(rv.As<Napi::String>().Utf8Value().c_str()) : nullptr;
        } else if (rtag != GI_TYPE_TAG_VOID) {
          std::string held;
          JsToGIArgument(napiEnv, Napi::Value(env, ret), retType, static_cast<GIArgument*>(result),
                         &held);
        }
      }
    }
  }
  gi_base_info_unref(retType);
  // A CALL-scope callback (e.g. a list `foreach`) runs synchronously inside a
  // JS-initiated GI invoke, so a pending exception must propagate to that JS
  // caller — leave it to surface at the invoke's N-API boundary. A NOTIFIED/ASYNC
  // callback (idle/timeout/GAsyncReadyCallback) is dispatched FROM the GLib loop
  // with no JS caller to catch it; a left-pending exception would wedge the
  // libuv↔GLib pump (DrainMicrotasks stops draining while one is pending). Surface
  // + clear it so the loop keeps running (GJS logs an uncaught callback exception
  // rather than stalling the loop).
  if (napiEnv.IsExceptionPending() && cb->scope != GI_SCOPE_TYPE_CALL) {
    SurfacePendingException(env, "GI callback (idle/timeout/async)");
  }

  // scope=async (e.g. a GAsyncReadyCallback) fires EXACTLY once and carries no
  // destroy-notify, so it is the trampoline's job to free it. It is NOT in
  // callScope (so it survived the invoke), and freeing it inline would destroy
  // this ffi closure's own executable trampoline mid-call — so defer the free to
  // the next main-loop iteration, when the closure is no longer on the stack.
  if (cb->scope == GI_SCOPE_TYPE_ASYNC) {
    g_idle_add_full(G_PRIORITY_DEFAULT, NodeGiCallbackFreeIdle, cb, nullptr);
  }
}

// Create an ffi closure wrapping a JS function for a GI callback-typed arg.
static NodeGiCallback* CreateCallback(Napi::Env env, Napi::Function fn, GICallableInfo* callbackInfo,
                                      GIScopeType scope) {
  NodeGiCallback* cb = new NodeGiCallback();
  cb->env = env;
  cb->info = reinterpret_cast<GICallableInfo*>(gi_base_info_ref(callbackInfo));
  cb->scope = scope;
  napi_create_reference(env, fn, 1, &cb->jsFn);
  cb->closure = gi_callable_info_create_closure(callbackInfo, &cb->cif, NodeGiCallbackTrampoline, cb);
  cb->native = gi_callable_info_get_closure_native_address(callbackInfo, cb->closure);
  if (cb->native == nullptr) cb->native = cb->closure;
  return cb;
}

// Whether `type` is a supported OUT/INOUT marshalling type for this milestone:
// fundamentals (numbers/bool), strings (utf8/filename), GObject/interface +
// enums/flags, struct/boxed/union (wrapped as boxed handles on return), and the
// containers (arrays, GList/GSList/GHashTable). GError (its own roadmap PR) is
// deferred: a clear error rather than silent mis-handling. *why receives a short
// type label on refusal. Declared in common.h — shared with the vfunc chain-up
// path (class.cc CallParentVfunc), which routes each OUT/INOUT vfunc arg the same
// way this function-invoke path does.
bool IsSupportedOutType(GITypeInfo* type, std::string* why) {
  switch (gi_type_info_get_tag(type)) {
    case GI_TYPE_TAG_BOOLEAN:
    case GI_TYPE_TAG_INT8:
    case GI_TYPE_TAG_UINT8:
    case GI_TYPE_TAG_INT16:
    case GI_TYPE_TAG_UINT16:
    case GI_TYPE_TAG_INT32:
    case GI_TYPE_TAG_UINT32:
    case GI_TYPE_TAG_INT64:
    case GI_TYPE_TAG_UINT64:
    case GI_TYPE_TAG_FLOAT:
    case GI_TYPE_TAG_DOUBLE:
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      // struct/union OUT are read back via WrapBoxed (a boxed handle); enum/flags
      // as numbers; object/interface as GObject wrappers. Field ACCESS on the
      // returned struct is a later PR, but the OUT marshalling itself is here.
      GIBaseInfo* iface = gi_type_info_get_interface(type);
      bool ok = iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface) ||
                                     GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface) ||
                                     GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface));
      if (!ok && why != nullptr) *why = "interface";
      if (iface != nullptr) gi_base_info_unref(iface);
      return ok;
    }
    case GI_TYPE_TAG_ARRAY:
    case GI_TYPE_TAG_GLIST:
    case GI_TYPE_TAG_GSLIST:
    case GI_TYPE_TAG_GHASH:
      // Container OUT/return — arrays (incl. GStrv / byte arrays), GList/GSList,
      // and string-keyed GHashTable. Element-type support is checked here so an
      // exotic combo defers cleanly before the invoke.
      return IsSupportedContainerType(type, why);
    default:
      if (why != nullptr)
        *why = "type tag " + std::to_string(static_cast<int>(gi_type_info_get_tag(type)));
      return false;
  }
}

// ---- GError -> GLib.Error ----
//
// A failed GI invoke yields a GError (domain quark + code + message). GJS surfaces
// it as a real `GLib.Error` (an Error subclass carrying `.domain`/`.code`/
// `.message` + a `.matches(domain, code)` method). The GLib.Error CLASS itself is
// owned by L1 (gi.js) so its `matches()` can resolve an error-enum object to its
// domain; the engine just reports the GError's fields to an L1-registered builder
// function (stored in this env's instance data — see NodeGiEnvData) and throws
// what it returns.
//
// Read a GError's domain (quark name + numeric quark), code and message, FREE it,
// and throw the JS error the L1 builder produces (instanceof GLib.Error). Falls
// back to a plain JS Error when no builder is registered for this env. `context`
// is the "Ns.method" display name, used only in the fallback message (a real
// GLib.Error carries the bare GError message, matching GJS).
void ThrowGError(Napi::Env env, GError* error, const std::string& context) {
  // Read everything out of the GError BEFORE g_error_free.
  GQuark domainQuark = error != nullptr ? error->domain : 0;
  const char* domainName = domainQuark != 0 ? g_quark_to_string(domainQuark) : nullptr;
  std::string domain = domainName != nullptr ? domainName : "";
  int code = error != nullptr ? error->code : 0;
  std::string message =
      (error != nullptr && error->message != nullptr) ? error->message : "invocation failed";
  if (error != nullptr) g_error_free(error);

  // Prefer this env's L1 GLib.Error builder (instanceof GLib.Error + matches()).
  NodeGiEnvData* d = EnvData(env);
  if (d != nullptr && d->errorBuilder != nullptr) {
    napi_value builder = nullptr;
    if (napi_get_reference_value(env, d->errorBuilder, &builder) == napi_ok &&
        builder != nullptr) {
      napi_value undef = nullptr;
      napi_get_undefined(env, &undef);
      napi_value bargs[4] = {nullptr, nullptr, nullptr, nullptr};
      napi_create_string_utf8(env, domain.c_str(), NAPI_AUTO_LENGTH, &bargs[0]);
      napi_create_uint32(env, static_cast<uint32_t>(domainQuark), &bargs[1]);
      napi_create_int32(env, code, &bargs[2]);
      napi_create_string_utf8(env, message.c_str(), NAPI_AUTO_LENGTH, &bargs[3]);
      napi_value errObj = nullptr;
      napi_status st = napi_call_function(env, undef, builder, 4, bargs, &errObj);
      if (st == napi_ok && errObj != nullptr) {
        napi_throw(env, errObj);
        return;
      }
      // The builder itself threw — let that exception surface rather than masking it.
      bool pending = false;
      if (napi_is_exception_pending(env, &pending) == napi_ok && pending) return;
    }
  }
  Napi::Error::New(env, "Calling " + context + ": " + message).ThrowAsJavaScriptException();
}

static Napi::Value InvokeFunctionInfo(Napi::Env env, GIFunctionInfo* func, gpointer instance,
                                      Napi::Array args, const std::string& displayName) {
  GICallableInfo* callable = reinterpret_cast<GICallableInfo*>(func);
  unsigned int n_args = gi_callable_info_get_n_args(callable);
  bool isMethod = instance != nullptr;
  size_t offset = isMethod ? 1 : 0;

  // Per-argument dense in/out positions, mirroring gi_callable_info_invoke's own
  // walk: the instance takes in-position 0; every IN/INOUT arg takes the next
  // in-position; every OUT/INOUT arg takes the next out-position. The in_args and
  // out_args arrays the invoker reads are dense (no holes), so we cannot index by
  // raw arg index once OUT args interleave — these maps bridge that gap. For an
  // all-IN callable inPos[i] == offset + i, so the IN-only path is unchanged.
  std::vector<int> inPos(n_args, -1);
  std::vector<int> outPos(n_args, -1);
  std::vector<GIDirection> dirs(n_args);
  size_t nIn = offset;
  size_t nOut = 0;
  for (unsigned int i = 0; i < n_args; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GIDirection d = gi_arg_info_get_direction(ai);
    gi_base_info_unref(ai);
    dirs[i] = d;
    if (d == GI_DIRECTION_IN || d == GI_DIRECTION_INOUT) inPos[i] = static_cast<int>(nIn++);
    if (d == GI_DIRECTION_OUT || d == GI_DIRECTION_INOUT) outPos[i] = static_cast<int>(nOut++);
  }

  std::vector<GIArgument> in_args(nIn);
  std::vector<GIArgument> out_args(nOut);
  // Stable per-arg storage the invoker writes OUT/INOUT values into (its address
  // is handed to the C callee). Sized once to n_args so the addresses never move.
  std::vector<GIArgument> slots(n_args);
  std::vector<std::string> held(n_args);
  if (isMethod) in_args[0].v_pointer = instance;

  // Pre-scan: the user_data + destroy-notify slots associated with a callback
  // arg are filled from the callback, not consumed from the JS argument list.
  std::vector<bool> skip(n_args, false);
  for (unsigned int i = 0; i < n_args; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_INTERFACE) {
      GIBaseInfo* iface = gi_type_info_get_interface(ti);
      if (iface != nullptr && GI_IS_CALLBACK_INFO(iface)) {
        int ci = ArgClosureIndex(ai);
        int di = ArgDestroyIndex(ai);
        if (ci >= 0 && static_cast<unsigned int>(ci) < n_args) skip[ci] = true;
        if (di >= 0 && static_cast<unsigned int>(di) < n_args) skip[di] = true;
      }
      if (iface != nullptr) gi_base_info_unref(iface);
    }
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }

  // Pre-scan: array-length args. An array IN/OUT arg — or the return value — may
  // carry a separate introspectable length arg. Mark it skip (not JS-consumed)
  // and flag it so its OUT slot is wired below / its IN value is autofilled from
  // the array's JS length when the array arg is marshalled. This extends the same
  // skip mechanism the callback closure/destroy slots already use.
  std::vector<bool> isLenArg(n_args, false);
  for (unsigned int i = 0; i < n_args; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_ARRAY) {
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(ti, &L) && L < n_args) {
        skip[L] = true;
        isLenArg[L] = true;
      }
    }
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  {
    GITypeInfo* rt = gi_callable_info_get_return_type(callable);
    if (gi_type_info_get_tag(rt) == GI_TYPE_TAG_ARRAY) {
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(rt, &L) && L < n_args) {
        skip[L] = true;
        isLenArg[L] = true;
      }
    }
    gi_base_info_unref(rt);
  }

  // Caller-allocates OUT storage (fixed C array or boxed struct): blob != nullptr
  // marks the arg; boxedGType != 0 selects the boxed copy/free path on read-back.
  std::vector<gpointer> callerAllocBlob(n_args, nullptr);
  std::vector<GType> callerAllocGType(n_args, 0);

  std::vector<InContainer> inContainers;   // IN containers to free after the invoke
  // g_strdup'd transfer-full scalar string IN/INOUT args. The callee adopts + frees
  // them only on a SUCCESSFUL invoke; if a later arg fails to marshal (the early
  // !ok return) or the invoke itself fails, the callee never took them → we g_free
  // them on those branches so they don't leak (#658).
  std::vector<gpointer> ownedInStrings;
  std::vector<NodeGiCallback*> created;    // all callbacks made this call
  std::vector<NodeGiCallback*> callScope;  // scope=call → freed after the invoke
  bool ok = true;
  size_t jsCursor = 0;
  for (unsigned int i = 0; i < n_args && ok; i++) {
    if (skip[i]) {
      // A length arg that is OUT/INOUT: the callee writes the array length into
      // our stable slot, which we read back to size the array. (IN length args
      // are autofilled when their array arg is marshalled, below.) Callback
      // closure/destroy slots (always IN) are filled by the callback handler.
      if (isLenArg[i] && (dirs[i] == GI_DIRECTION_OUT || dirs[i] == GI_DIRECTION_INOUT))
        out_args[outPos[i]].v_pointer = &slots[i];
      continue;
    }
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GIDirection dir = dirs[i];
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);

    GIBaseInfo* iface = gi_type_info_get_tag(ti) == GI_TYPE_TAG_INTERFACE
                            ? gi_type_info_get_interface(ti)
                            : nullptr;
    bool isCallback = iface != nullptr && GI_IS_CALLBACK_INFO(iface);

    // OUT / INOUT (a callback is always IN-direction and handled below).
    if ((dir == GI_DIRECTION_OUT || dir == GI_DIRECTION_INOUT) && !isCallback) {
      std::string why;
      if (gi_arg_info_is_caller_allocates(ai)) {
        // Caller-allocates: the callee fills storage WE provide (a single
        // pointer, not a **). gi_callable_info_invoke passes out_args[k].v_pointer
        // straight through as the arg, so the blob pointer goes there directly.
        // Supported: a fixed-size C array (size = fixed_size × element_size) and a
        // boxed struct/union (size = gi_struct/union_info_get_size). Reference:
        // refs/gjs/gi/arg-cache.cpp build_arg CALLER_ALLOCATES branch.
        GITypeTag tg = gi_type_info_get_tag(ti);
        size_t size = 0;
        GType boxedGType = 0;
        if (tg == GI_TYPE_TAG_ARRAY && gi_type_info_get_array_type(ti) == GI_ARRAY_TYPE_C) {
          size_t fixed = 0;
          if (gi_type_info_get_array_fixed_size(ti, &fixed) && fixed > 0) {
            GITypeInfo* el = gi_type_info_get_param_type(ti, 0);
            // Only fundamental (non-interface) element types: CElementSize is the
            // true storage size for them. A struct-by-value element array would
            // need gi_struct_info_get_size per element + field-access read-back
            // (a later PR), so leave size=0 to defer it cleanly.
            if (el != nullptr && gi_type_info_get_tag(el) != GI_TYPE_TAG_INTERFACE)
              size = CElementSize(el) * fixed;
            if (el != nullptr) gi_base_info_unref(el);
          }
        } else if (tg == GI_TYPE_TAG_INTERFACE) {
          GIBaseInfo* si = gi_type_info_get_interface(ti);
          if (si != nullptr && GI_IS_STRUCT_INFO(si)) {
            size = gi_struct_info_get_size(reinterpret_cast<GIStructInfo*>(si));
          } else if (si != nullptr && GI_IS_UNION_INFO(si)) {
            size = gi_union_info_get_size(reinterpret_cast<GIUnionInfo*>(si));
          }
          if (si != nullptr) {
            GType gt = gi_registered_type_info_get_g_type(
                reinterpret_cast<GIRegisteredTypeInfo*>(si));
            if (gt != G_TYPE_INVALID && G_TYPE_IS_BOXED(gt)) boxedGType = gt;
            gi_base_info_unref(si);
          }
          // A non-boxed struct OUT can be caller-allocated + filled, but wrapping
          // it needs field access (a later PR) to be useful — defer those.
          if (boxedGType == 0) size = 0;
        }
        if (size == 0) {
          Napi::TypeError::New(
              env, displayName + ": caller-allocates OUT parameter type is not yet supported")
              .ThrowAsJavaScriptException();
          ok = false;
        } else {
          gpointer blob = g_malloc0(size);
          callerAllocBlob[i] = blob;
          callerAllocGType[i] = boxedGType;
          out_args[outPos[i]].v_pointer = blob;
        }
      } else if (!IsSupportedOutType(ti, &why)) {
        Napi::TypeError::New(env, displayName + ": OUT " + why +
                                      " parameters are not yet supported")
            .ThrowAsJavaScriptException();
        ok = false;
      } else if (dir == GI_DIRECTION_INOUT) {
        GITypeTag tg = gi_type_info_get_tag(ti);
        if (tg == GI_TYPE_TAG_ARRAY || tg == GI_TYPE_TAG_GLIST || tg == GI_TYPE_TAG_GSLIST ||
            tg == GI_TYPE_TAG_GHASH) {
          // INOUT containers (read-modify-write a caller-built container) are the
          // rare, ownership-tricky case — defer cleanly. Pure-OUT containers fall
          // through to the slot-wiring branch below.
          Napi::TypeError::New(
              env, displayName + ": INOUT container parameters are not yet supported")
              .ThrowAsJavaScriptException();
          ok = false;
        } else {
          // INOUT scalar: marshal the JS input into the slot (like IN); the
          // invoker hands the slot's address to the callee, which reads + writes.
          Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
          jsCursor++;
          GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
          if (JsToGIArgument(env, v, ti, &slots[i], &held[i], tr, &ownedInStrings)) {
            in_args[inPos[i]].v_pointer = &slots[i];
            out_args[outPos[i]].v_pointer = &slots[i];
          } else {
            ok = false;  // JsToGIArgument already threw
          }
        }
      } else {
        // Pure OUT: the callee writes into the slot; no JS arg is consumed.
        out_args[outPos[i]].v_pointer = &slots[i];
      }
      if (iface != nullptr) gi_base_info_unref(iface);
      gi_base_info_unref(ti);
      gi_base_info_unref(ai);
      continue;
    }

    // IN (including callbacks): consume the next JS argument.
    Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
    jsCursor++;

    if (isCallback) {
      int ci = ArgClosureIndex(ai);
      int di = ArgDestroyIndex(ai);
      if (v.IsFunction()) {
        GIScopeType scopeType = gi_arg_info_get_scope(ai);
        NodeGiCallback* cb =
            CreateCallback(env, v.As<Napi::Function>(), reinterpret_cast<GICallableInfo*>(iface),
                           scopeType);
        created.push_back(cb);
        if (scopeType == GI_SCOPE_TYPE_CALL) callScope.push_back(cb);
        in_args[inPos[i]].v_pointer = cb->native;
        if (ci >= 0 && static_cast<unsigned int>(ci) < n_args && inPos[ci] >= 0)
          in_args[inPos[ci]].v_pointer = cb;
        if (di >= 0 && static_cast<unsigned int>(di) < n_args && inPos[di] >= 0)
          in_args[inPos[di]].v_pointer = reinterpret_cast<gpointer>(NodeGiCallbackDestroyNotify);
      } else if (v.IsNull() || v.IsUndefined()) {
        // Null is only valid for a nullable callback (e.g. an optional progress
        // callback). For a NON-nullable callback (g_timeout_add / g_idle_add)
        // passing null would make us hand GLib a NULL GSourceFunc → a GLib-CRITICAL
        // (`assertion 'function != NULL'`) + a dead source. Reject it with a clean
        // JS TypeError up front, matching GJS.
        if (!gi_arg_info_may_be_null(ai)) {
          gi_base_info_unref(iface);
          gi_base_info_unref(ti);
          gi_base_info_unref(ai);
          Napi::TypeError::New(
              env, displayName + ": the callback argument is not nullable (expected a function)")
              .ThrowAsJavaScriptException();
          ok = false;
          break;
        }
        in_args[inPos[i]].v_pointer = nullptr;
      } else {
        gi_base_info_unref(iface);
        gi_base_info_unref(ti);
        gi_base_info_unref(ai);
        Napi::TypeError::New(env, displayName + ": expected a function for the callback argument")
            .ThrowAsJavaScriptException();
        ok = false;
        break;
      }
    } else {
      GITypeTag tg = gi_type_info_get_tag(ti);
      if (tg == GI_TYPE_TAG_ARRAY || tg == GI_TYPE_TAG_GLIST || tg == GI_TYPE_TAG_GSLIST ||
          tg == GI_TYPE_TAG_GHASH) {
        std::string why;
        if (!IsSupportedContainerType(ti, &why)) {
          Napi::TypeError::New(env, displayName + ": IN " + why +
                                        " parameters are not yet supported")
              .ThrowAsJavaScriptException();
          ok = false;
        } else {
          GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
          gpointer cptr = nullptr;
          long ccount = 0;
          ok = JsToInContainer(env, v, ti, tr, &cptr, &ccount, &inContainers);
          if (ok) {
            in_args[inPos[i]].v_pointer = cptr;
            // Autofill an IN length arg from the array's element count.
            if (tg == GI_TYPE_TAG_ARRAY) {
              unsigned int L = 0;
              if (gi_type_info_get_array_length_index(ti, &L) && L < n_args &&
                  dirs[L] == GI_DIRECTION_IN && inPos[L] >= 0) {
                GIArgInfo* la = gi_callable_info_get_arg(callable, L);
                GITypeInfo* lt = gi_arg_info_get_type_info(la);
                WriteLengthValue(lt, &in_args[inPos[L]], ccount);
                gi_base_info_unref(lt);
                gi_base_info_unref(la);
              }
            }
          }
        }
      } else {
        GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
        ok = JsToGIArgument(env, v, ti, &in_args[inPos[i]], &held[i], tr, &ownedInStrings);
      }
    }

    if (iface != nullptr) gi_base_info_unref(iface);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  if (!ok) {
    for (NodeGiCallback* cb : created) NodeGiCallbackFree(cb);
    for (const InContainer& c : inContainers) FreeInContainer(c);
    for (gpointer s : ownedInStrings) g_free(s);  // never reached the callee (#658)
    // Caller-allocated blobs never reached the callee (or it was never called) —
    // they are zeroed g_malloc0 storage, so a plain g_free is correct here.
    for (gpointer b : callerAllocBlob)
      if (b != nullptr) g_free(b);
    return env.Null();
  }

  GIArgument retval;
  GError* error = nullptr;
  gboolean success = gi_function_info_invoke(func, in_args.data(), in_args.size(),
                                             out_args.data(), out_args.size(), &retval, &error);
  // Call-scope closures are only valid for the duration of the invoke; free them
  // now (notified/async closures are owned by the callee / self-freeing).
  for (NodeGiCallback* cb : callScope) NodeGiCallbackFree(cb);
  if (!success) {
    for (const InContainer& c : inContainers) FreeInContainer(c);
    // A failed invoke did not adopt the transfer-full IN/INOUT strings we g_strdup'd
    // for it → free them here so the error path doesn't leak (#658).
    for (gpointer s : ownedInStrings) g_free(s);
    // Free the caller-allocated OUT storage (the callee may have partially filled
    // it; g_free releases the block — a boxed free-func on a half-initialised blob
    // is riskier than the small leak of any internal pointer it set).
    for (gpointer b : callerAllocBlob)
      if (b != nullptr) g_free(b);
    // ThrowGError reads the GError's domain/code/message, frees it, and throws a
    // real GLib.Error (instanceof, with .matches()) via the L1 builder.
    ThrowGError(env, error, displayName);
    return env.Null();
  }

  // Assemble the JS return per the GJS convention: the function's own return
  // value (if non-void) followed by each OUT/INOUT value in argument order.
  // Exactly one element → return it bare; many → a JS Array; none → undefined.
  std::vector<Napi::Value> results;
  GITypeInfo* return_type = gi_callable_info_get_return_type(callable);
  GITransfer return_transfer = gi_callable_info_get_caller_owns(callable);
  // A non-void return ALWAYS leads the tuple — the `(skip)` annotation is IGNORED
  // for the JS return, exactly as GJS does. GJS's arg-cache derives `m_has_return`
  // purely from the return type (non-void, or a pointer) and unconditionally counts
  // it (refs/gjs/gi/arg-cache.cpp: initialize() `m_has_return = tag != VOID || …`,
  // build_return() `*inc_counter_out = true`); nothing in gjs's marshalling consults
  // `gi_callable_info_skip_return`. Verified against gjs 1.88:
  //   GLib.uri_split('http://user@host:80/p?q=1#frag', 0)
  //     → [true, 'http', 'user', 'host', 80, '/p', 'q=1', 'frag']   (8, leading bool)
  // even though g_uri_split's gboolean return carries `skip="1"` (and throws). node-gi
  // previously honoured the annotation and dropped it (7) — a divergence from the gold
  // standard. (node-gtk's ShouldSkipReturn does honour it; we match GJS, not node-gtk.)
  if (gi_type_info_get_tag(return_type) != GI_TYPE_TAG_VOID) {
    results.push_back(ReadOutOrReturn(env, callable, return_type, &retval, return_transfer, &slots));
  }
  gi_base_info_unref(return_type);

  for (unsigned int i = 0; i < n_args && !env.IsExceptionPending(); i++) {
    if (dirs[i] != GI_DIRECTION_OUT && dirs[i] != GI_DIRECTION_INOUT) continue;
    if (skip[i]) continue;  // an array length arg — surfaced via its array, not on its own
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    GITransfer transfer = gi_arg_info_get_ownership_transfer(ai);
    if (callerAllocBlob[i] != nullptr) {
      // Caller-allocated OUT: the callee filled the blob IN PLACE (the blob is the
      // data, not a pointer to it). Wrap it, then release the blob — mirroring
      // gjs's CallerAllocatesOut (read the value out, then free the storage).
      gpointer blob = callerAllocBlob[i];
      if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_ARRAY) {
        // A fixed-size C array: read length from the fixed size (len=-1), transfer
        // NOTHING (we own + free the blob ourselves right below).
        GIArgument a;
        memset(&a, 0, sizeof(a));
        a.v_pointer = blob;
        results.push_back(ReadOutOrReturn(env, callable, ti, &a, GI_TRANSFER_NOTHING, &slots));
        g_free(blob);
      } else {
        // A boxed struct/union: hand the JS side an independent boxed COPY it owns
        // (finalizer g_boxed_free's it), then free the caller-allocated blob (also
        // via g_boxed_free — matches gjs BoxedCallerAllocatesOut::release).
        GType gt = callerAllocGType[i];
        gpointer owned = g_boxed_copy(gt, blob);
        results.push_back(MakeBoxedHandle(env, owned, gt, true));
        g_boxed_free(gt, blob);
      }
      callerAllocBlob[i] = nullptr;
      gi_base_info_unref(ti);
      gi_base_info_unref(ai);
      continue;
    }
    results.push_back(ReadOutOrReturn(env, callable, ti, &slots[i], transfer, &slots));
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }

  // Free the transfer-nothing IN containers now that the results are marshalled
  // into JS — a transfer-none return/OUT (e.g. g_environ_getenv) can point INTO
  // a transfer-none IN container, so this MUST run after the reads above, never
  // before. Transfer-everything/container IN were adopted by the callee, so
  // FreeInContainer leaves those alone.
  for (const InContainer& c : inContainers) FreeInContainer(c);

  if (env.IsExceptionPending()) return env.Null();
  if (results.empty()) return env.Undefined();
  if (results.size() == 1) return results[0];
  Napi::Array arr = Napi::Array::New(env, results.size());
  for (size_t k = 0; k < results.size(); k++) arr.Set(static_cast<uint32_t>(k), results[k]);
  return arr;
}

// callFunction(namespace, functionName, args?: unknown[]) -> unknown
// Invokes a namespace-level GI function (not an instance method) with IN-only
// primitive/string/object args. Instance methods go through callMethod.
Napi::Value CallFunction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "callFunction(namespace: string, functionName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string fn = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), fn.c_str());
  if (base == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, "No such symbol: " + ns + "." + fn).ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!GI_IS_FUNCTION_INFO(base)) {
    gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + fn + " is not a function").ThrowAsJavaScriptException();
    return env.Null();
  }
  GIFunctionInfo* func = reinterpret_cast<GIFunctionInfo*>(base);
  if (gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(base))) {
    gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::TypeError::New(
        env, ns + "." + fn + " is an instance method — use callMethod(handle, name, args)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Value result = InvokeFunctionInfo(env, func, nullptr, args, ns + "." + fn);
  gi_base_info_unref(base);
  g_object_unref(repo);
  return result;
}

// callMethod(handle, methodName, args?: unknown[]) -> unknown
// Resolve an instance method by walking the instance's GIObjectInfo (own +
// implemented-interface methods at each level, then up the parent chain), then
// invoke it with the instance prepended. The Node twin of `obj.method(...)`.
Napi::Value CallMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "callMethod(handle, methodName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string method = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  GType gtype = G_OBJECT_TYPE(obj);
  GIRepository* repo = DupDefaultRepository();

  // The instance's concrete GType may lack introspection info (e.g. a private
  // GLocalFile); walk up to the nearest ancestor GType that has an object info.
  GIObjectInfo* objInfo = nullptr;
  for (GType t = gtype; t != 0; t = g_type_parent(t)) {
    GIBaseInfo* bi = gi_repository_find_by_gtype(repo, t);
    if (bi != nullptr) {
      if (GI_IS_OBJECT_INFO(bi)) {
        objInfo = reinterpret_cast<GIObjectInfo*>(bi);
        break;
      }
      gi_base_info_unref(bi);
    }
  }
  if (objInfo == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, std::string("no introspection info for ") + G_OBJECT_TYPE_NAME(obj))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Search own + implemented-interface methods at each level, then the parent.
  GIFunctionInfo* func = nullptr;
  while (objInfo != nullptr) {
    GIBaseInfo* declarer = nullptr;
    func = gi_object_info_find_method_using_interfaces(objInfo, method.c_str(), &declarer);
    if (declarer != nullptr) gi_base_info_unref(declarer);
    if (func != nullptr) break;
    GIObjectInfo* parent = gi_object_info_get_parent(objInfo);
    gi_base_info_unref(objInfo);
    objInfo = parent;
  }
  if (objInfo != nullptr) gi_base_info_unref(objInfo);

  // The concrete GType may implement introspectable interfaces that its nearest
  // introspectable ANCESTOR's info does not list — e.g. a private GLocalFile
  // (no info; ancestor = GObject) implementing GFile. Scan the live GType's
  // interface list directly so interface methods (g_file_get_path) resolve.
  if (func == nullptr) {
    unsigned int n_ifaces = 0;
    GType* ifaces = g_type_interfaces(gtype, &n_ifaces);
    for (unsigned int i = 0; i < n_ifaces && func == nullptr; i++) {
      GIBaseInfo* ii = gi_repository_find_by_gtype(repo, ifaces[i]);
      if (ii != nullptr) {
        if (GI_IS_INTERFACE_INFO(ii)) {
          func = gi_interface_info_find_method(reinterpret_cast<GIInterfaceInfo*>(ii),
                                               method.c_str());
        }
        gi_base_info_unref(ii);
      }
    }
    g_free(ifaces);
  }
  g_object_unref(repo);

  if (func == nullptr) {
    Napi::Error::New(env, std::string("no method '") + method + "' on " + G_OBJECT_TYPE_NAME(obj))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(func))) {
    gi_base_info_unref(func);
    Napi::TypeError::New(env, method + " is not an instance method").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Value result =
      InvokeFunctionInfo(env, func, obj, args, std::string(G_OBJECT_TYPE_NAME(obj)) + "." + method);
  gi_base_info_unref(func);
  return result;
}

// callStaticMethod(namespace, typeName, methodName, args?) -> unknown
// Invoke a type-level constructor/static function (e.g. Gio.File.new_for_path,
// Gtk.Label.new) — a function found ON a type but taking no instance. The Node
// twin of `Ns.Class.method(...)`.
Napi::Value CallStaticMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(
        env, "callStaticMethod(namespace: string, typeName: string, methodName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string tn = info[1].As<Napi::String>().Utf8Value();
  std::string method = info[2].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 4 && info[3].IsArray()) ? info[3].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* typeInfo = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  if (typeInfo == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, "no such type: " + ns + "." + tn).ThrowAsJavaScriptException();
    return env.Null();
  }
  GIFunctionInfo* func = nullptr;
  if (GI_IS_OBJECT_INFO(typeInfo)) {
    func = gi_object_info_find_method(reinterpret_cast<GIObjectInfo*>(typeInfo), method.c_str());
  } else if (GI_IS_INTERFACE_INFO(typeInfo)) {
    func = gi_interface_info_find_method(reinterpret_cast<GIInterfaceInfo*>(typeInfo), method.c_str());
  } else if (GI_IS_STRUCT_INFO(typeInfo)) {
    func = gi_struct_info_find_method(reinterpret_cast<GIStructInfo*>(typeInfo), method.c_str());
  }
  gi_base_info_unref(typeInfo);
  if (func == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, "no static method '" + method + "' on " + ns + "." + tn)
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(func))) {
    gi_base_info_unref(func);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + tn + "." + method +
                                  " is an instance method — call it on an instance")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Value result = InvokeFunctionInfo(env, func, nullptr, args, ns + "." + tn + "." + method);
  gi_base_info_unref(func);
  g_object_unref(repo);
  return result;
}

// callBoxedMethod(handle, methodName, args?) -> unknown
// Invoke an instance method on a boxed/struct handle (e.g. mainLoop.run() /
// mainLoop.quit()). Resolves the method against the boxed GType's GIStructInfo
// (or union info) and invokes it with the boxed pointer prepended as instance.
Napi::Value CallBoxedMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "callBoxedMethod(handle, methodName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!info[0].IsExternal() ||
      !info[0].As<Napi::External<BoxedHandle>>().CheckTypeTag(&kBoxedHandleTag)) {
    Napi::TypeError::New(env, "expected a node-gi boxed handle").ThrowAsJavaScriptException();
    return env.Null();
  }
  BoxedHandle* bh = info[0].As<Napi::External<BoxedHandle>>().Data();
  if (bh == nullptr || bh->ptr == nullptr) {
    Napi::TypeError::New(env, "invalid boxed handle").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string method = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);
  if (bh->gtype == G_TYPE_INVALID) {
    Napi::Error::New(env, "boxed handle has no introspection GType for method resolution")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* bi = gi_repository_find_by_gtype(repo, bh->gtype);
  GIFunctionInfo* func = nullptr;
  if (bi != nullptr && GI_IS_STRUCT_INFO(bi)) {
    func = gi_struct_info_find_method(reinterpret_cast<GIStructInfo*>(bi), method.c_str());
  } else if (bi != nullptr && GI_IS_UNION_INFO(bi)) {
    func = gi_union_info_find_method(reinterpret_cast<GIUnionInfo*>(bi), method.c_str());
  }
  if (bi != nullptr) gi_base_info_unref(bi);
  if (func == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, std::string("no method '") + method + "' on " + g_type_name(bh->gtype))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Value result = InvokeFunctionInfo(env, func, bh->ptr, args,
                                          std::string(g_type_name(bh->gtype)) + "." + method);
  gi_base_info_unref(func);
  g_object_unref(repo);
  return result;
}

// isBoxedHandle(value) -> boolean  (tag-checked; no dereference)
Napi::Value IsBoxedHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = info.Length() >= 1 && info[0].IsExternal() &&
            info[0].As<Napi::External<BoxedHandle>>().CheckTypeTag(&kBoxedHandleTag);
  return Napi::Boolean::New(env, is);
}

}  // namespace nodegi
