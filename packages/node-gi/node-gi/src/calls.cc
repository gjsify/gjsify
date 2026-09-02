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
  // Counted in the auto-pump's in-flight keep-alive — the process stays alive
  // while JS-armed GLib work is outstanding, like in-flight Node I/O.
  //   • scope=async    — a one-shot completion (GAsyncReadyCallback), released
  //     at the trampoline's single invocation.
  //   • scope=notified — a callback GLib owns until its GDestroyNotify fires:
  //     `GLib.timeout_add` / `GLib.idle_add` and friends. Released by
  //     NodeGiCallbackFree, i.e. exactly when GLib drops the source (the
  //     callback returned SOURCE_REMOVE, or `GLib.Source.remove` killed it).
  // Either way released exactly once, also at free if it never fired.
  //
  // Counting the JS-ARMED sources is the point: a source armed from JS is
  // program work the process must survive for, while a source armed inside C —
  // GDK's frame clock, GIO's portal/a11y retries — is library plumbing that
  // `gjs -m` would never stay alive for either. Keying the keep-alive on "the
  // context has ANY scheduled source" instead made a finished GTK program
  // immortal: GDK leaves a ~1 s repeating timeout armed, so the context reports
  // work forever while nothing is ever ready to dispatch.
  bool pumpCounted = false;
};

static void NodeGiCallbackPumpRelease(NodeGiCallback* cb) {
  if (cb != nullptr && cb->pumpCounted) {
    cb->pumpCounted = false;
    NodeGiPumpAsyncEnd();
  }
}

static void NodeGiCallbackFree(NodeGiCallback* cb) {
  if (cb == nullptr) return;
  NodeGiCallbackPumpRelease(cb);  // never fired (error/teardown path)
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

// Nesting depth of loop-dispatched C->JS callbacks (see common.h). Incremented
// around every loop-dispatched napi_make_callback (signal closures, GI
// callbacks, vfuncs) so the cross-runtime microtask checkpoint
// (NodeGiMaybeDrainMicrotasks) fires only at the OUTERMOST callback boundary.
int g_loopDispatchDepth = 0;

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
  // scope=async fires exactly once — the in-flight completion has arrived, so
  // drop its auto-pump keep-alive ref (whether or not JS can still be entered).
  NodeGiCallbackPumpRelease(cb);
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
  // JS dispatched from a pump-driven context iteration (and every microtask
  // continuation napi_make_callback runs at its boundary) must not inherit the
  // pump's in-iteration flag — a blocking loop.run() it starts needs the
  // UvLoopSource co-pump live. No-op when the flag is already clear.
  NodeGiPumpJsDispatchScope pumpWindow;
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
      // napi_make_callback drains nextTick/microtasks around the call (Node; on
      // Bun/Deno the checkpoint is run by NodeGiMaybeDrainMicrotasks below).
      g_loopDispatchDepth++;
      napi_status st = napi_make_callback(env, nullptr, global, fn, jsArgs.size(), jsArgs.data(), &ret);
      g_loopDispatchDepth--;
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

  // Cross-runtime microtask checkpoint (Bun/Deno — no-op on Node, see loop.cc):
  // a loop-dispatched (NOTIFIED/ASYNC) callback with no dispatch nesting is the
  // outermost C→JS boundary, so promise continuations it queued (a GLib-timeout
  // handler resolving an awaited Promise — the async-DBus-reply chain) drain
  // NOW, matching Node's napi_make_callback checkpoint and GJS. A CALL-scope
  // callback runs under a live JS caller whose stack unwind drains normally.
  if (cb->scope != GI_SCOPE_TYPE_CALL && g_loopDispatchDepth == 0) {
    NodeGiMaybeDrainMicrotasks(env);
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
  // Count the JS-armed GLib work in the auto-pump keep-alive so the process
  // stays alive until it completes: a one-shot in-flight operation
  // (GAsyncReadyCallback et al, scope=async) or a source GLib owns until its
  // destroy-notify (`GLib.timeout_add`/`idle_add`, scope=notified). See the
  // `pumpCounted` note above for why JS-armed is the right unit.
  if (scope == GI_SCOPE_TYPE_ASYNC || scope == GI_SCOPE_TYPE_NOTIFIED) {
    cb->pumpCounted = NodeGiPumpAsyncBegin(env);
  }
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
      return IsSupportedContainerType(type, why, ContainerUse::kReadBack);
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

// Which of a callable's args are NOT consumed from the JS argument list:
//  - the user_data + destroy-notify slots associated with a callback arg
//    (filled from the callback itself);
//  - array-length args of an array IN/OUT arg or of the return value
//    (autofilled from the array's JS length / wired as an OUT slot; flagged
//    in `isLenArg` so the invoke loop can tell the two skip kinds apart).
// SHARED between the invoke loop and JsInArgCount below so the arity a
// function REPORTS is by construction the arity the invoke CONSUMES.
static void ComputeSkippedArgs(GICallableInfo* callable, unsigned int n_args,
                               std::vector<bool>* skip, std::vector<bool>* isLenArg) {
  for (unsigned int i = 0; i < n_args; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_INTERFACE) {
      GIBaseInfo* iface = gi_type_info_get_interface(ti);
      if (iface != nullptr && GI_IS_CALLBACK_INFO(iface)) {
        int ci = ArgClosureIndex(ai);
        int di = ArgDestroyIndex(ai);
        if (ci >= 0 && static_cast<unsigned int>(ci) < n_args) (*skip)[ci] = true;
        if (di >= 0 && static_cast<unsigned int>(di) < n_args) (*skip)[di] = true;
      }
      if (iface != nullptr) gi_base_info_unref(iface);
    } else if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_ARRAY) {
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(ti, &L) && L < n_args) {
        (*skip)[L] = true;
        (*isLenArg)[L] = true;
      }
    }
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  GITypeInfo* rt = gi_callable_info_get_return_type(callable);
  if (gi_type_info_get_tag(rt) == GI_TYPE_TAG_ARRAY) {
    unsigned int L = 0;
    if (gi_type_info_get_array_length_index(rt, &L) && L < n_args) {
      (*skip)[L] = true;
      (*isLenArg)[L] = true;
    }
  }
  gi_base_info_unref(rt);
}

// The number of JS arguments a callable consumes: IN/INOUT args minus the
// skipped ones. This is what gjs reports as `Function.length` (m_js_in_argc,
// refs/gjs/gi/function.cpp Function::init counts exactly the same set), and it
// is what @gjsify/gtk-host's descriptor conformance reads to hold the widget
// table against the installed typelib.
int JsInArgCount(GICallableInfo* callable) {
  unsigned int n_args = gi_callable_info_get_n_args(callable);
  std::vector<bool> skip(n_args, false);
  std::vector<bool> isLenArg(n_args, false);
  ComputeSkippedArgs(callable, n_args, &skip, &isLenArg);
  int count = 0;
  for (unsigned int i = 0; i < n_args; i++) {
    if (skip[i]) continue;
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GIDirection d = gi_arg_info_get_direction(ai);
    gi_base_info_unref(ai);
    if (d == GI_DIRECTION_IN || d == GI_DIRECTION_INOUT) count++;
  }
  return count;
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
  bool instanceRefTaken = false;  // the transfer-full-instance ref below, undone on early bail
  if (isMethod) {
    in_args[0].v_pointer = instance;
    // A transfer-full INSTANCE parameter (rare but load-bearing:
    // g_dbus_method_invocation_return_value/_return_error/… — "this method will
    // take ownership of @invocation") CONSUMES one ref of the instance. Our JS
    // wrapper keeps its own ref for the handle's lifetime (its finalizer unrefs),
    // so hand the callee a ref of its own — exactly what gjs's arg-cache does for
    // the instance argument — otherwise the wrapper's later unref double-frees.
    // Only a GObject instance can be safely ref'd here; the transfer-full-instance
    // methods in the base typelibs are all GObject methods (a boxed instance
    // method reaching this path keeps the previous behaviour).
    if (gi_callable_info_get_instance_ownership_transfer(callable) == GI_TRANSFER_EVERYTHING) {
      // gi_base_info_get_container returns a borrowed ref — no unref.
      GIBaseInfo* container = gi_base_info_get_container(reinterpret_cast<GIBaseInfo*>(func));
      if (container != nullptr && GI_IS_OBJECT_INFO(container) &&
          G_IS_OBJECT(static_cast<GObject*>(instance))) {
        g_object_ref(static_cast<GObject*>(instance));
        instanceRefTaken = true;
      }
    }
  }

  // Pre-scan: which args are NOT JS-consumed (see ComputeSkippedArgs).
  std::vector<bool> skip(n_args, false);
  std::vector<bool> isLenArg(n_args, false);
  ComputeSkippedArgs(callable, n_args, &skip, &isLenArg);

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
  // JS functions marshalled as GClosure IN-args this call (see common.h). Each
  // carries one ref taken at marshal time (gjs's ref+sink): transfer-none refs are
  // dropped after the invoke, transfer-full refs belong to the callee (dropped
  // only when the callee never ran).
  CreatedClosures createdClosures;
  // JS typed arrays marshalled as fresh GBytes IN-args this call (see common.h).
  // Same release contract as the closures: transfer-none refs are dropped after
  // the invoke (the callee ref'd the GBytes if it kept it), transfer-full refs
  // belong to the callee (dropped only when the callee never ran).
  CreatedBytes createdBytes;
  CreatedValues createdValues;
  bool ok = true;
  size_t jsCursor = 0;
  std::vector<LengthWrite> lengthWrites;
  for (unsigned int i = 0; i < n_args && ok; i++) {
    if (skip[i]) {
      // A length arg that is OUT/INOUT: the callee writes the array length into
      // our stable slot, which we read back to size the array. (IN length args
      // are autofilled when their array arg is marshalled, below.) Callback
      // closure/destroy slots (always IN) are filled by the callback handler.
      if (isLenArg[i] && (dirs[i] == GI_DIRECTION_OUT || dirs[i] == GI_DIRECTION_INOUT))
        out_args[outPos[i]].v_pointer = &slots[i];
      // An INOUT length arg is a single `gint*` the callee reads (the in-count) AND
      // writes (the out-count): the in_arg is a POINTER to the same stable slot. The
      // in-count is written into slots[i] when the INOUT array is marshalled below.
      if (isLenArg[i] && dirs[i] == GI_DIRECTION_INOUT)
        in_args[inPos[i]].v_pointer = &slots[i];
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
        // Supported: a fixed-size C array (size = fixed_size × element_size), a
        // boxed struct/union (size = gi_struct/union_info_get_size, incl. the
        // GValue auto-unbox), and a PLAIN non-boxed struct/union (same size
        // source; the filled blob is handed to JS as a g_free-owning
        // field-readable handle — PangoLayout.get_pixel_extents). Reference:
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
            // A FOREIGN struct's layout is module-owned (cairo) — GI cannot fill
            // it here; defer cleanly (its introspected size is meaningless).
            if (GI_IS_STRUCT_INFO(si) &&
                gi_struct_info_is_foreign(reinterpret_cast<GIStructInfo*>(si)))
              size = 0;
            gi_base_info_unref(si);
          }
          // A NON-boxed plain struct (boxedGType stays 0, e.g. PangoRectangle in
          // PangoLayout.get_pixel_extents) keeps its size: the blob is handed to
          // JS as a g_free-owning handle with field access on read-back below —
          // gjs's CallerAllocatesOut (g_malloc0 → fill → wrap → g_free). An
          // opaque struct introspects size 0 and defers via the throw below.
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
          // INOUT container (read-modify-write a caller-built container). The ABI is
          // a single `container**` the callee reads (the in-container) and reassigns
          // (the out-container). We stash the in-container pointer in the stable slot
          // and point BOTH in_args + out_args at &slots[i]; the callee overwrites
          // slots[i].v_pointer with the out-container, which the read-back loop below
          // marshals via ReadOutOrReturn (OUT transfer). OWNERSHIP: JsToInContainer
          // records the ORIGINAL in-container in `inContainers`, so FreeInContainer
          // (after the reads) releases it per the IN transfer — NONE → we free the
          // in-container we built; EVERYTHING/CONTAINER → the callee adopted it, we
          // don't. The out-container is freed (or borrowed) by ReadOutOrReturn per the
          // SAME (OUT) transfer. Verified vs gjs 1.88 (GIMarshallingTests.array_inout,
          // garray/glist/gslist/gptrarray/ghashtable_utf8_none_inout, bytearray_full_inout).
          //
          // THAT ABI IS TAKEN FROM THE ANNOTATION AND CANNOT BE VERIFIED HERE. `c:type`
          // — the only place `gchar*` and `gchar**` differ — lives in the GIR XML and is
          // NOT compiled into the typelib. `GLib.base64_decode_inplace` is annotated
          // `direction="inout"` over a `c:type="gchar*"`, one star; compared field by
          // field against a genuine `gchar***` INOUT (`GLib.OptionContext.parse`'s
          // `argv`) its metadata is identical — direction INOUT, transfer EVERYTHING,
          // tag ARRAY, is_pointer true, caller-allocates false. A mis-annotated callee
          // therefore receives `&slots[i]` and writes its output OVER the GIArgument
          // union, and the read-back below marshals and frees a clobbered pointer.
          // Measured: five runs of that one call, five different return values; gjs
          // corrupts identically, so there is no oracle to compare against either.
          //
          // Nothing to detect on this side — the discriminator is data the runtime does
          // not have — and a per-function denylist ossifies. Upstream annotation bug:
          // `status/upstream-patch-candidates.md`. `test/arrays.test.mjs` records why
          // that call was removed from the suite and must not come back.
          Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
          jsCursor++;
          if (!IsSupportedContainerType(ti, &why, ContainerUse::kReadBack)) {
            Napi::TypeError::New(env, displayName + ": INOUT " + why +
                                          " parameters are not yet supported")
                .ThrowAsJavaScriptException();
            ok = false;
          } else {
            GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
            gpointer cptr = nullptr;
            long ccount = 0;
            // A nullable INOUT container passed null/undefined → a NULL in-container
            // (count 0), matching gjs (e.g. length_array_utf8_optional_inout(null)
            // → []). A non-nullable arg falls through to JsToInContainer, which
            // throws for a non-array, exactly as before.
            if ((v.IsNull() || v.IsUndefined()) && gi_arg_info_may_be_null(ai)) {
              ok = true;
            } else {
              ok = JsToInContainer(env, v, ti, tr, &cptr, &ccount, &inContainers);
            }
            if (ok) {
              slots[i].v_pointer = cptr;
              in_args[inPos[i]].v_pointer = &slots[i];
              out_args[outPos[i]].v_pointer = &slots[i];
              // The length arg carries the in-count. An INOUT length gets it in ITS
              // slot (the callee reads+writes that slot); a plain IN length gets the
              // value directly in its in_arg.
              if (tg == GI_TYPE_TAG_ARRAY) {
                unsigned int L = 0;
                if (gi_type_info_get_array_length_index(ti, &L) && L < n_args) {
                  GIArgInfo* la = gi_callable_info_get_arg(callable, L);
                  GITypeInfo* lt = gi_arg_info_get_type_info(la);
                  if (dirs[L] == GI_DIRECTION_INOUT) {
                    WriteLengthValue(lt, &slots[L], ccount);
                  } else if (dirs[L] == GI_DIRECTION_IN && inPos[L] >= 0) {
                    WriteLengthValue(lt, &in_args[inPos[L]], ccount);
                  }
                  gi_base_info_unref(lt);
                  gi_base_info_unref(la);
                }
              }
            }
          }
        } else {
          // INOUT scalar: marshal the JS input into the slot (like IN); the
          // invoker hands the slot's address to the callee, which reads + writes.
          Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
          jsCursor++;
          GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
          if (JsToGIArgument(env, v, ti, &slots[i], &held[i], tr, &ownedInStrings, nullptr,
                             nullptr, nullptr, gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(ai)))) {
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
        if (!IsSupportedContainerType(ti, &why, ContainerUse::kIn)) {
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
                long other = 0;
                if (!RecordLengthWrite(&lengthWrites, L, ccount, &other)) {
                  Napi::TypeError::New(
                      env, displayName + ": two arrays share length argument " +
                               std::to_string(L) + " but have different lengths (" +
                               std::to_string(other) + " and " + std::to_string(ccount) + ")")
                      .ThrowAsJavaScriptException();
                  ok = false;
                } else {
                  GIArgInfo* la = gi_callable_info_get_arg(callable, L);
                  GITypeInfo* lt = gi_arg_info_get_type_info(la);
                  WriteLengthValue(lt, &in_args[inPos[L]], ccount);
                  gi_base_info_unref(lt);
                  gi_base_info_unref(la);
                }
              }
            }
          }
        }
      } else {
        GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
        ok = JsToGIArgument(env, v, ti, &in_args[inPos[i]], &held[i], tr, &ownedInStrings,
                            &createdClosures, &createdBytes, &createdValues,
                            gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(ai)));
      }
    }

    if (iface != nullptr) gi_base_info_unref(iface);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  if (!ok) {
    for (NodeGiCallback* cb : created) NodeGiCallbackFree(cb);
    for (const InContainer& c : inContainers) FreeInContainer(c);
    // The callee never ran, so NO closure ref was adopted — release every created
    // closure (refcount 1 → 0 → finalize drops the JS-function ref).
    for (GClosure* c : createdClosures.transferNone) g_closure_unref(c);
    for (GClosure* c : createdClosures.transferFull) g_closure_unref(c);
    // Likewise every fresh GBytes built from a JS typed array — never adopted.
    for (GBytes* b : createdBytes.transferNone) g_bytes_unref(b);
    for (GBytes* b : createdBytes.transferFull) g_bytes_unref(b);
    // Likewise every GValue boxed from a plain JS value — never adopted.
    for (GValue* gv : createdValues.transferNone) NodeGiFreeBoxedGValue(gv);
    for (GValue* gv : createdValues.transferFull) NodeGiFreeBoxedGValue(gv);
    // Likewise the transfer-full-instance ref: the callee never consumed it.
    if (instanceRefTaken) g_object_unref(static_cast<GObject*>(instance));
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
  // A FAILED invoke never started its async op, so a scope=async callback it was
  // handed will not fire — drop its auto-pump keep-alive ref here or the process
  // could never exit. (The callback allocation itself is left alone: freeing it
  // would be unsafe if a callee retained it despite the error — the pre-existing
  // small leak on this rare path is unchanged.) Runs BEFORE the callScope free
  // below so no freed pointer is revisited; releasing a CALL-scope cb is a no-op.
  if (!success) {
    for (NodeGiCallback* cb : created) NodeGiCallbackPumpRelease(cb);
  }
  // Call-scope closures are only valid for the duration of the invoke; free them
  // now (notified/async closures are owned by the callee / self-freeing).
  for (NodeGiCallback* cb : callScope) NodeGiCallbackFree(cb);
  // Transfer-none GClosure IN-args: drop the ref taken at marshal time (gjs
  // BoxedInTransferNone::release, which runs on success AND error paths). A
  // callee that stored the closure (signal connect, source_set_closure, a DBus
  // registration) holds its own ref+sink, so the closure lives on; a callee that
  // only invoked it synchronously lets this unref finalize it (dropping the JS
  // ref). Transfer-full closures were adopted by the callee — no release (gjs
  // GClosureIn::release skips).
  for (GClosure* c : createdClosures.transferNone) g_closure_unref(c);
  // Transfer-none GBytes IN-args built from JS typed arrays: drop the fresh ref
  // taken at marshal time (gjs GBytesInTransferNone::release, success AND error
  // paths). A callee that kept the bytes (GdkPixbuf.Pixbuf.new_from_bytes) holds
  // its own ref. Transfer-full GBytes were adopted by the callee — no release.
  for (GBytes* b : createdBytes.transferNone) g_bytes_unref(b);
  // Transfer-none GValue IN-args boxed from plain JS values: the callee copied
  // whatever it needed (g_object_set_property copies into the property), so the
  // box is ours to free — success AND error paths, mirroring the GBytes rule.
  // Transfer-full GValues were adopted by the callee — no release.
  for (GValue* gv : createdValues.transferNone) NodeGiFreeBoxedGValue(gv);
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
      } else if (g_type_is_a(callerAllocGType[i], G_TYPE_VALUE)) {
        // A caller-allocated GValue OUT (e.g. GIMarshallingTests.gvalue_out_caller_allocates):
        // GJS UNBOXES the filled GValue to its contained JS value (verified: → 42, a
        // number, not a GObject.Value box), then frees the caller-allocated storage.
        // The blob IS the GValue (g_value_init'd + set IN PLACE by the callee). Unbox
        // via GValueToJs (same as the return/OUT-pointer path in marshal.cc), then
        // g_value_unset (frees any contained data, e.g. a dup'd string) + g_free the
        // blob WE g_malloc0'd — the direct GValue release GJS uses.
        results.push_back(GValueToJs(env, static_cast<GValue*>(blob)));
        g_value_unset(static_cast<GValue*>(blob));
        g_free(blob);
      } else if (callerAllocGType[i] != 0) {
        // A boxed struct/union: hand the JS side an independent boxed COPY it owns
        // (finalizer g_boxed_free's it), then free the caller-allocated blob (also
        // via g_boxed_free — matches gjs BoxedCallerAllocatesOut::release).
        GType gt = callerAllocGType[i];
        gpointer owned = g_boxed_copy(gt, blob);
        results.push_back(MakeBoxedHandle(env, owned, gt, true));
        g_boxed_free(gt, blob);
      } else {
        // A PLAIN (non-boxed) struct/union filled in place (e.g. the
        // PangoRectangles of PangoLayout.get_pixel_extents): no copy function
        // exists, so hand the g_malloc0'd blob ITSELF to JS — the handle owns the
        // block (g_free on finalize; gjs equivalently memdups into its Boxed and
        // g_free's the blob, CallerAllocatesOut::release) and carries the static
        // struct info so fields read back (rect.x / rect.width via getBoxedField).
        // A registered-but-non-boxed GType (if any) is kept for method resolution.
        GIBaseInfo* si = gi_type_info_get_interface(ti);
        GType gt = si != nullptr ? gi_registered_type_info_get_g_type(
                                       reinterpret_cast<GIRegisteredTypeInfo*>(si))
                                 : G_TYPE_INVALID;
        GType handleGType = (gt != G_TYPE_INVALID && gt != G_TYPE_NONE) ? gt : G_TYPE_INVALID;
        results.push_back(
            MakeBoxedHandle(env, blob, handleGType, false, si, /* rawOwned = */ true));
        if (si != nullptr) gi_base_info_unref(si);
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

// The JS-side camelCase → snake_case alias (gi.js camelToSnake), mirrored here so
// method resolution can try the LITERAL introspected name first and only fall
// back to the alias. GJS exposes GI method names VERBATIM — a Vala-generated GIR
// carries camelCase names (Gwebgl's `getString`), which an unconditional
// camelCase→snake conversion destroys (the webgl-glarea spike wall).
static std::string CamelToSnake(const std::string& name) {
  std::string out;
  out.reserve(name.size() + 4);
  for (char c : name) {
    if (c >= 'A' && c <= 'Z') {
      out += '_';
      out += static_cast<char>(c - 'A' + 'a');
    } else {
      out += c;
    }
  }
  return out;
}

// The instance's concrete GType may lack introspection info (e.g. a private
// GLocalFile); walk up to the nearest ancestor GType that has an object info.
// Returns a new ref or nullptr. Shared by CallMethod (invoke), HasMethod
// (feature detection) and object.cc's ClassInfoForTypeName (the L1 prototype
// lookup) so all three resolve the same way.
GIObjectInfo* FindNearestObjectInfo(GIRepository* repo, GType gtype) {
  for (GType t = gtype; t != 0; t = g_type_parent(t)) {
    GIBaseInfo* bi = gi_repository_find_by_gtype(repo, t);
    if (bi != nullptr) {
      if (GI_IS_OBJECT_INFO(bi)) return reinterpret_cast<GIObjectInfo*>(bi);
      gi_base_info_unref(bi);
    }
  }
  return nullptr;
}

// Resolve one candidate name: own + implemented-interface methods at each
// level, then the parent chain; then the live GType's interface list (the
// concrete GType may implement introspectable interfaces its nearest
// introspectable ANCESTOR's info does not list — e.g. a private GLocalFile
// (no info; ancestor = GObject) implementing GFile, so g_file_get_path
// resolves). Returns a new ref or nullptr.
static GIFunctionInfo* ResolveMethodByName(GIRepository* repo, GType gtype, GIObjectInfo* objInfo,
                                           const char* name) {
  GIObjectInfo* walk =
      reinterpret_cast<GIObjectInfo*>(gi_base_info_ref(reinterpret_cast<GIBaseInfo*>(objInfo)));
  GIFunctionInfo* found = nullptr;
  while (walk != nullptr) {
    GIBaseInfo* declarer = nullptr;
    found = gi_object_info_find_method_using_interfaces(walk, name, &declarer);
    if (declarer != nullptr) gi_base_info_unref(declarer);
    if (found != nullptr) break;
    GIObjectInfo* parent = gi_object_info_get_parent(walk);
    gi_base_info_unref(walk);
    walk = parent;
  }
  if (walk != nullptr) gi_base_info_unref(walk);
  if (found == nullptr) {
    unsigned int n_ifaces = 0;
    GType* ifaces = g_type_interfaces(gtype, &n_ifaces);
    for (unsigned int i = 0; i < n_ifaces && found == nullptr; i++) {
      GIBaseInfo* ii = gi_repository_find_by_gtype(repo, ifaces[i]);
      if (ii != nullptr) {
        if (GI_IS_INTERFACE_INFO(ii)) {
          found = gi_interface_info_find_method(reinterpret_cast<GIInterfaceInfo*>(ii), name);
        }
        gi_base_info_unref(ii);
      }
    }
    g_free(ifaces);
  }
  return found;
}

// Resolve `method` — LITERAL introspected name first (GJS fidelity: GIR names
// are exposed verbatim, incl. Vala camelCase like Gwebgl's `getString`),
// snake_case alias second. Returns a new ref or nullptr.
static GIFunctionInfo* ResolveInstanceMethod(GIRepository* repo, GType gtype, GIObjectInfo* objInfo,
                                             const std::string& method) {
  GIFunctionInfo* func = ResolveMethodByName(repo, gtype, objInfo, method.c_str());
  if (func == nullptr) {
    const std::string snake = CamelToSnake(method);
    if (snake != method) func = ResolveMethodByName(repo, gtype, objInfo, snake.c_str());
  }
  return func;
}

// callMethod(handle, methodName, args?: unknown[]) -> unknown
// Resolve an instance method by walking the instance's GIObjectInfo (own +
// implemented-interface methods at each level, then up the parent chain), then
// invoke it with the instance prepended. The Node twin of `obj.method(...)`.
// The LITERAL name is resolved first (GJS fidelity — GIR names are exposed
// verbatim, incl. Vala camelCase); the snake_case alias is the fallback.
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

  GIObjectInfo* objInfo = FindNearestObjectInfo(repo, gtype);
  if (objInfo == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, std::string("no introspection info for ") + G_OBJECT_TYPE_NAME(obj))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  GIFunctionInfo* func = ResolveInstanceMethod(repo, gtype, objInfo, method);
  gi_base_info_unref(objInfo);
  g_object_unref(repo);

  if (func == nullptr) {
    // On a terminating env the method-name read (info[1].Utf8Value) degrades to
    // "" (a swallowed napi failure), so resolution misses and we land here — but
    // building the Napi::Error on the dying env would abort via Error::New's
    // fatal funnel. Gate on NodeGiJsAvailable (false on a dying env AND on a live
    // env with a pending exception); a genuine unknown method on a live env still
    // throws.
    if (NodeGiJsAvailable(env)) {
      Napi::Error::New(env, std::string("no method '") + method + "' on " + G_OBJECT_TYPE_NAME(obj))
          .ThrowAsJavaScriptException();
    }
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

// hasMethod(handle, methodName) -> boolean
// TRUE iff callMethod(handle, methodName, …) would resolve an invocable
// instance method (literal introspected name or snake_case alias, walking the
// same own/interface/parent chain). Backs the L1 wrapper's GJS-parity property
// access: `obj.nonexistentMethod` must be `undefined` — real consumers
// feature-detect optional native methods (`typeof gl.clearBufferfv ===
// 'function'` in `@gjsify/webgl`'s clearBuffer emulation, the exposing call
// under Excalibur's RenderTarget.blitToScreen) and the old unconditional
// throw-on-call thunk made that detection lie. Never throws for a merely
// unknown name; a non-introspectable instance simply reports false.
Napi::Value HasMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "hasMethod(handle, methodName: string)").ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string method = info[1].As<Napi::String>().Utf8Value();

  GType gtype = G_OBJECT_TYPE(obj);
  GIRepository* repo = DupDefaultRepository();
  GIObjectInfo* objInfo = FindNearestObjectInfo(repo, gtype);
  if (objInfo == nullptr) {
    g_object_unref(repo);
    return Napi::Boolean::New(env, false);
  }
  GIFunctionInfo* func = ResolveInstanceMethod(repo, gtype, objInfo, method);
  gi_base_info_unref(objInfo);
  g_object_unref(repo);
  if (func == nullptr) return Napi::Boolean::New(env, false);
  const bool invocable = gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(func));
  gi_base_info_unref(func);
  return Napi::Boolean::New(env, invocable);
}

// hasClassMethod(namespace, typeName, methodName) -> boolean
// The CLASS-level twin of hasMethod: TRUE iff `Ns.Type` declares an invocable
// instance method by that name (literal introspected name first, snake_case
// alias second — the resolution callMethod itself performs), across own,
// implemented-interface and inherited methods. Keyed by TYPE rather than by an
// instance handle because it backs the lazy method resolution on the class
// PROTOTYPE (#1175), which must answer before any instance exists.
// The class-level resolution HasClassMethod and ClassMethodArity share: the
// literal-then-snake_case walk over own, implemented-interface and inherited
// methods for an object type, or the interface's own methods for an interface
// type. Returns a new ref or nullptr.
static GIFunctionInfo* ResolveClassLevelMethod(GIRepository* repo, const std::string& ns,
                                               const std::string& tn, const std::string& method) {
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  GIFunctionInfo* func = nullptr;
  if (base != nullptr) {
    if (GI_IS_OBJECT_INFO(base)) {
      GType gtype =
          gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base));
      // An object info always carries a registered GType; the guard is for the
      // interface-list step, which would warn on G_TYPE_INVALID.
      if (gtype != G_TYPE_INVALID) {
        func = ResolveInstanceMethod(repo, gtype, reinterpret_cast<GIObjectInfo*>(base), method);
      }
    } else if (GI_IS_INTERFACE_INFO(base)) {
      GIInterfaceInfo* iface = reinterpret_cast<GIInterfaceInfo*>(base);
      func = gi_interface_info_find_method(iface, method.c_str());
      if (func == nullptr) {
        const std::string snake = CamelToSnake(method);
        if (snake != method) func = gi_interface_info_find_method(iface, snake.c_str());
      }
    }
    gi_base_info_unref(base);
  }
  return func;
}

Napi::Value HasClassMethod(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(env,
                         "hasClassMethod(namespace: string, typeName: string, methodName: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string tn = info[1].As<Napi::String>().Utf8Value();
  std::string method = info[2].As<Napi::String>().Utf8Value();

  GIRepository* repo = DupDefaultRepository();
  GIFunctionInfo* func = ResolveClassLevelMethod(repo, ns, tn, method);
  g_object_unref(repo);
  if (func == nullptr) return Napi::Boolean::New(env, false);
  const bool invocable = gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(func));
  gi_base_info_unref(func);
  return Napi::Boolean::New(env, invocable);
}

// classMethodArity(namespace, typeName, methodName) -> number
// The JS-visible IN-arg count of the method — what gjs reports as the
// materialized function's `length` — or -1 when the name does not resolve to an
// invocable instance method. Resolution is byte-identical to hasClassMethod
// (shared ResolveClassLevelMethod), so `arity >= 0` IS the hasClassMethod
// answer and the prototype materializer needs a single native call for both.
// Arity 0 is a real answer (`Gtk.Widget.show()`), which is why absence is -1.
Napi::Value ClassMethodArity(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(
        env, "classMethodArity(namespace: string, typeName: string, methodName: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string tn = info[1].As<Napi::String>().Utf8Value();
  std::string method = info[2].As<Napi::String>().Utf8Value();

  GIRepository* repo = DupDefaultRepository();
  GIFunctionInfo* func = ResolveClassLevelMethod(repo, ns, tn, method);
  g_object_unref(repo);
  if (func == nullptr) return Napi::Number::New(env, -1);
  const bool invocable = gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(func));
  const int arity = invocable ? JsInArgCount(reinterpret_cast<GICallableInfo*>(func)) : -1;
  gi_base_info_unref(func);
  return Napi::Number::New(env, arity);
}

// Resolve a CLASS-STRUCT method — one of the GObjectClass functions gjs exposes as a
// STATIC on the constructor (`Gtk.Button.list_properties()`, `.find_property()`).
// Absent from the object's own GIObjectInfo, which is why CallStaticMethod's three
// find_method arms missed it and every such call threw "no static method '…' on
// Ns.Class" — including @gjsify/gtk-host's paramSpecs(), on every element-creation
// path. `list_properties` is declared on GObject.ObjectClass and NOWHERE else
// (Gio.SimpleActionClass has no GIR record at all) and class structs carry no GI
// inheritance, so the walk is over the object-info PARENT chain, each level's class
// struct in turn — reproducing what gjs reaches through the CONSTRUCTOR PROTOTYPE
// CHAIN, where gjs_define_static_methods put GObjectClass's methods on
// GObject.Object's constructor and Gtk.Button inherits them. Returns a new ref or
// nullptr; same shape as ResolveMethodByName's parent walk above.
static GIFunctionInfo* ResolveClassStructMethod(GIObjectInfo* objInfo, const char* name) {
  GIObjectInfo* walk =
      reinterpret_cast<GIObjectInfo*>(gi_base_info_ref(reinterpret_cast<GIBaseInfo*>(objInfo)));
  GIFunctionInfo* found = nullptr;
  while (walk != nullptr) {
    GIStructInfo* cs = gi_object_info_get_class_struct(walk);
    if (cs != nullptr) {
      if (gi_struct_info_is_gtype_struct(cs)) found = gi_struct_info_find_method(cs, name);
      gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(cs));
    }
    if (found != nullptr) break;
    GIObjectInfo* parent = gi_object_info_get_parent(walk);
    gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(walk));
    walk = parent;
  }
  if (walk != nullptr) gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(walk));
  return found;
}

// The GTypeClass a class-struct method runs ON: the LEAF type's class, never the
// declarer's — list_properties() on GtkButton's class must return the button's 44
// pspecs, not GObject's zero. gjs resolves the same way, reading the gtype off the
// constructor the call went THROUGH (`this`), which is the leaf.
//
// gjs's GTypeStructInstanceIn uses g_type_class_peek and states its reason: "we use
// peek here to simplify reference counting … GType classes are never really freed …
// we know that the GType class is referenced at least once when the JS constructor
// is initialized". node-gi's class proxy takes no such ref, so peek alone is nullptr
// for a type nothing has instantiated yet — hence g_type_class_ref, to REALISE the
// class (the same reason ConstructGObject refs it before reading its pspecs). That
// ref is KEPT: it establishes gjs's invariant once per GType (bounded — every later
// call is served by the peek), while unrefing is the one call that could invalidate
// the GParamSpecs list_properties just handed out, which the class owns. Since GLib
// 2.84 g_type_class_unref is a documented no-op, so pairing buys nothing anyway.
static gpointer ClassStructInstance(GIObjectInfo* objInfo) {
  GType gtype =
      gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(objInfo));
  if (gtype == G_TYPE_INVALID) return nullptr;
  gpointer klass = g_type_class_peek(gtype);
  return klass != nullptr ? klass : g_type_class_ref(gtype);
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
  // Non-null ONLY when the class-struct fallback is what resolved `func`: the
  // GTypeClass to invoke it on. It doubles as the flag that the "is an instance
  // method" rejection below must not fire — a class-struct method IS is_method,
  // its instance is the class rather than an object.
  gpointer classInstance = nullptr;
  if (GI_IS_OBJECT_INFO(typeInfo)) {
    GIObjectInfo* objInfo = reinterpret_cast<GIObjectInfo*>(typeInfo);
    func = gi_object_info_find_method(objInfo, method.c_str());
    if (func == nullptr) {
      func = ResolveClassStructMethod(objInfo, method.c_str());
      if (func != nullptr) {
        classInstance = ClassStructInstance(objInfo);
        if (classInstance == nullptr) {
          // No GType behind the info, so there is no class to call it on. Drop back
          // to the plain "no static method" error rather than invoking with a null
          // instance, which would hand the C function a null GObjectClass*.
          gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(func));
          func = nullptr;
        }
      }
    }
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
  const bool isMethod = gi_callable_info_is_method(reinterpret_cast<GICallableInfo*>(func));
  if (isMethod && classInstance == nullptr) {
    gi_base_info_unref(func);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + tn + "." + method +
                                  " is an instance method — call it on an instance")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // A class struct may also declare plain functions (no instance); only the
  // is_method ones take the class.
  Napi::Value result = InvokeFunctionInfo(env, func, isMethod ? classInstance : nullptr, args,
                                          ns + "." + tn + "." + method);
  gi_base_info_unref(func);
  g_object_unref(repo);
  return result;
}

// constructStruct(namespace, typeName, args?) -> boxed handle
// The `new <Struct>()` [[Construct]] path for boxed/plain structs — GJS
// gi/boxed.cpp parity. Resolution order:
//   1. the struct/union HAS a 'new' constructor → invoke it with the args (the
//      pre-existing `new GLib.MainLoop(null, false)` behavior, unchanged);
//   2. no 'new', ZERO args, a struct with a known size → a ZERO-INITIALIZED
//      instance (GJS zero-allocates in boxed_new — `new Graphene.Rect()`,
//      `new Gdk.RGBA()`). For a registered BOXED GType the zero blob is
//      g_boxed_copy'd so the handle's g_boxed_free matches the type's real
//      allocator (graphene g_slice/malloc-allocates internally — handing a raw
//      g_malloc0 blob to g_boxed_free would corrupt that allocator); the same
//      pattern as NewGValue's g_boxed_copy(G_TYPE_VALUE, &zero) in object.cc,
//      generalized. A struct with NO registered boxed GType keeps the g_malloc0
//      blob itself, owned via the rawOwned/g_free finalizer arm (the
//      caller-allocates OUT pattern above).
//   3. no 'new' + args → a clear error (GJS supports no positional field args
//      for boxed construction either);
//   4. a union without 'new' keeps throwing — GJS's union.cpp requires a
//      zero-args constructor and never zero-allocates a union.
Napi::Value ConstructStruct(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env,
                         "constructStruct(namespace: string, typeName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string tn = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* typeInfo = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  if (typeInfo == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, "no such type: " + ns + "." + tn).ThrowAsJavaScriptException();
    return env.Null();
  }
  const bool isStruct = GI_IS_STRUCT_INFO(typeInfo);
  const bool isUnion = GI_IS_UNION_INFO(typeInfo);
  if (!isStruct && !isUnion) {
    gi_base_info_unref(typeInfo);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + tn + " is not a struct/union type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GIFunctionInfo* func =
      isStruct ? gi_struct_info_find_method(reinterpret_cast<GIStructInfo*>(typeInfo), "new")
               : gi_union_info_find_method(reinterpret_cast<GIUnionInfo*>(typeInfo), "new");
  if (func != nullptr) {
    // Has a 'new' constructor → the exact pre-existing static-call path.
    gi_base_info_unref(typeInfo);
    Napi::Value result = InvokeFunctionInfo(env, func, nullptr, args, ns + "." + tn + ".new");
    gi_base_info_unref(func);
    g_object_unref(repo);
    return result;
  }
  if (isUnion) {
    gi_base_info_unref(typeInfo);
    g_object_unref(repo);
    Napi::Error::New(env, "unable to construct union " + ns + "." + tn +
                              ": it has no 'new' constructor")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (args.Length() > 0) {
    gi_base_info_unref(typeInfo);
    g_object_unref(repo);
    Napi::Error::New(env, ns + "." + tn +
                              ": constructor takes no arguments (boxed struct has no 'new')")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const size_t size = gi_struct_info_get_size(reinterpret_cast<GIStructInfo*>(typeInfo));
  if (size == 0) {
    // Opaque struct (size unknown to GI) — nothing to zero-allocate; matches
    // GJS, which cannot allocate a boxed of unknown size either.
    gi_base_info_unref(typeInfo);
    g_object_unref(repo);
    Napi::Error::New(env, "unable to construct " + ns + "." + tn +
                              ": no 'new' constructor and unknown size (opaque struct)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const GType gt =
      gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(typeInfo));
  Napi::Value result;
  if (gt != G_TYPE_INVALID && gt != G_TYPE_NONE && G_TYPE_IS_BOXED(gt)) {
    gpointer zero = g_malloc0(size);
    gpointer owned = g_boxed_copy(gt, zero);
    g_free(zero);
    result = MakeBoxedHandle(env, owned, gt, /* owns */ true, typeInfo);
  } else {
    // Plain (or registered-but-non-boxed) C struct: the handle owns the zeroed
    // block directly (g_free on finalize); a registered GType is kept for
    // method/field resolution, `owns` stays false so g_boxed_free never runs.
    const GType handleGType = (gt != G_TYPE_INVALID && gt != G_TYPE_NONE) ? gt : G_TYPE_INVALID;
    gpointer blob = g_malloc0(size);
    result = MakeBoxedHandle(env, blob, handleGType, /* owns */ false, typeInfo,
                             /* rawOwned */ true);
  }
  gi_base_info_unref(typeInfo);
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
