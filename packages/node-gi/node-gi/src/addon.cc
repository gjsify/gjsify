// SPDX-License-Identifier: MIT
// Module init: the env-shutdown teardown hook, Init (N-API exports) and NODE_API_MODULE.

#include "common.h"

using namespace nodegi;

// Toggle-queue shutdown: disable toggles before the env tears down so no
// toggle-notify touches a dead env (GJS's gjs_object_shutdown_toggle_queue), and
// close the drain async so the libuv loop can exit cleanly. Any still-queued
// teardowns are intentionally dropped (the process/env is going away).
//
// Sequencing (the fix for the shutdown TOCTOU / data race): under g_queue_mutex,
// set shutdown=true and clear g_drain_async_inited + g_drain_tsfn (disabling all
// further calls) BEFORE the release runs outside the lock. WakeDrain checks both
// flags AND the tsfn pointer under the same lock, so once they are cleared no
// thread can call the TSFN, and the release only runs after that point — no call
// can race the release.
static void OnEnvShutdown(void* arg) {
  // Close the uv-driven GLib auto-pump's handles first (a no-op unless `arg` is
  // the env that armed the pump via startMainLoop) so the libuv loop can wind
  // down without the pump's prepare/check/timer/poll handles left open.
  NodeGiPumpShutdown(static_cast<napi_env>(arg));
  // Only the env that OWNS the toggle machinery may tear it down — a worker env
  // exiting must not disable the owner's drain TSFN or set the global flag.
  if (g_owner_env.load() != static_cast<napi_env>(arg)) {
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("env cleanup hook: non-owner env %p — no-op", arg);
    return;
  }
  // NOTE (env-teardown ordering): this cleanup hook is NOT the first teardown
  // event. Environment::RunCleanup() runs CleanupHandles() (uv_run) BEFORE
  // draining the cleanup-hook queue, so a pending drain wake can still dispatch
  // DrainTsfnCb after can_call_into_js=false but before this flag flips —
  // DrainTsfnCb's NodeGiJsAvailable gate covers that window (see toggle.cc).
  napi_threadsafe_function tsfn = nullptr;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    g_toggle_shutdown.store(true);
    if (g_drain_async_inited) {
      g_drain_async_inited = false;  // disable further calls FIRST (under the lock)
      tsfn = g_drain_tsfn;
      g_drain_tsfn = nullptr;
    }
  }
  if (NodeGiToggleDebugEnabled())
    NodeGiToggleDebugLog("env cleanup hook: owner env %p shutdown flag set, tsfn %p %s", arg,
                         static_cast<void*>(tsfn),
                         tsfn != nullptr ? "releasing (abort)" : "already gone");
  if (tsfn != nullptr) {
    // abort ⇒ pending + future calls are dropped and the callback won't run again;
    // releasing the initial-thread-count ref destroys the TSFN (its own uv_close).
    napi_release_threadsafe_function(tsfn, napi_tsfn_abort);
  }
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // The owner env + its JS/main thread are captured lazily at the first wrap
  // (EnsureDrainAsync) — NOT here, since Init runs once PER env and a per-env
  // overwrite would mis-identify the main thread under worker_threads. The cleanup
  // hook carries `env` so OnEnvShutdown only fires the global teardown for the owner.
  napi_add_env_cleanup_hook(env, OnEnvShutdown, env);
  // Per-env state (the GLib.Error builder ref) lives in N-API instance data; the
  // finalizer frees it at env teardown. Created once per env (Init runs per env).
  NodeGiEnvData* envData = new NodeGiEnvData();
  if (napi_set_instance_data(env, envData, NodeGiEnvDataFinalize, nullptr) != napi_ok) {
    delete envData;
  }
  exports.Set("requireNamespace", Napi::Function::New(env, RequireNamespace));
  exports.Set("listInfoNames", Napi::Function::New(env, ListInfoNames));
  exports.Set("findInfo", Napi::Function::New(env, FindInfo));
  exports.Set("getConstantValue", Napi::Function::New(env, GetConstantValue));
  exports.Set("getEnumValues", Napi::Function::New(env, GetEnumValues));
  exports.Set("getErrorDomain", Napi::Function::New(env, GetErrorDomain));
  exports.Set("setErrorBuilder", Napi::Function::New(env, SetErrorBuilder));
  exports.Set("prependSearchPath", Napi::Function::New(env, PrependSearchPath));
  exports.Set("prependLibraryPath", Napi::Function::New(env, PrependLibraryPath));
  exports.Set("callFunction", Napi::Function::New(env, CallFunction));
  exports.Set("callMethod", Napi::Function::New(env, CallMethod));
  exports.Set("hasMethod", Napi::Function::New(env, HasMethod));
  exports.Set("hasClassMethod", Napi::Function::New(env, HasClassMethod));
  exports.Set("callStaticMethod", Napi::Function::New(env, CallStaticMethod));
  exports.Set("constructStruct", Napi::Function::New(env, ConstructStruct));
  exports.Set("newObject", Napi::Function::New(env, NewObject));
  exports.Set("registerClass", Napi::Function::New(env, RegisterClass));
  exports.Set("registerClassFromGType", Napi::Function::New(env, RegisterClassFromGType));
  exports.Set("constructType", Napi::Function::New(env, ConstructType));
  exports.Set("callParentVfunc", Napi::Function::New(env, CallParentVfunc));
  exports.Set("hasClassVfunc", Napi::Function::New(env, HasClassVfunc));
  exports.Set("callClassVfunc", Napi::Function::New(env, CallClassVfunc));
  exports.Set("getTemplateChild", Napi::Function::New(env, GetTemplateChild));
  exports.Set("getProperty", Napi::Function::New(env, GetProperty));
  exports.Set("setProperty", Napi::Function::New(env, SetProperty));
  exports.Set("hasProperty", Napi::Function::New(env, HasProperty));
  exports.Set("getTypeName", Napi::Function::New(env, GetTypeName));
  exports.Set("classInfoForTypeName", Napi::Function::New(env, ClassInfoForTypeName));
  exports.Set("getGType", Napi::Function::New(env, GetGType));
  exports.Set("isInstanceOf", Napi::Function::New(env, IsInstanceOf));
  exports.Set("isGObjectHandle", Napi::Function::New(env, IsGObjectHandle));
  exports.Set("newGValue", Napi::Function::New(env, NewGValue));
  // Test-only (cross-thread GC stress) — see StressRefUnrefOffThread.
  exports.Set("__stressRefUnrefOffThread", Napi::Function::New(env, StressRefUnrefOffThread));
  exports.Set("__stressRefUnrefRunning", Napi::Function::New(env, StressRefUnrefRunning));
  exports.Set("__stressRefUnrefProgress", Napi::Function::New(env, StressRefUnrefProgress));
  exports.Set("__stressRefUnrefStop", Napi::Function::New(env, StressRefUnrefStop));
  exports.Set("callBoxedMethod", Napi::Function::New(env, CallBoxedMethod));
  exports.Set("isBoxedHandle", Napi::Function::New(env, IsBoxedHandle));
  exports.Set("boxedMemberKind", Napi::Function::New(env, BoxedMemberKind));
  exports.Set("getBoxedField", Napi::Function::New(env, GetBoxedField));
  exports.Set("setBoxedField", Napi::Function::New(env, SetBoxedField));
  exports.Set("boxedTypeName", Napi::Function::New(env, BoxedTypeName));
  exports.Set("isParamSpecHandle", Napi::Function::New(env, IsParamSpecHandle));
  exports.Set("isFundamentalHandle", Napi::Function::New(env, IsFundamentalHandle));
  exports.Set("paramSpecProp", Napi::Function::New(env, ParamSpecProp));
  exports.Set("variantNew", Napi::Function::New(env, VariantNew));
  exports.Set("variantUnpack", Napi::Function::New(env, VariantUnpack));
  exports.Set("variantGetTypeString", Napi::Function::New(env, VariantGetTypeString));
  exports.Set("isVariantHandle", Napi::Function::New(env, IsVariantHandle));
  exports.Set("startMainLoop", Napi::Function::New(env, StartMainLoop));
  exports.Set("iterateMainContext", Napi::Function::New(env, IterateMainContext));
  exports.Set("mainContextHasPending", Napi::Function::New(env, MainContextHasPending));
  exports.Set("makePumpPendingCount", Napi::Function::New(env, MakePumpPendingCount));
  exports.Set("pumpKick", Napi::Function::New(env, PumpKick));
  exports.Set("setMicrotaskDrain", Napi::Function::New(env, SetMicrotaskDrain));
  exports.Set("connectSignal", Napi::Function::New(env, ConnectSignal));
  exports.Set("emitSignal", Napi::Function::New(env, EmitSignal));
  exports.Set("disconnectSignal", Napi::Function::New(env, DisconnectSignal));
  exports.Set("setTemplateCallbackResolver",
              Napi::Function::New(env, SetTemplateCallbackResolver));
  exports.Set("setConstructCallback", Napi::Function::New(env, SetConstructCallback));
  // GjsPrivate-mirroring helpers (private.cc): the structured-log writer func +
  // the bind_property_full / BindingGroup.bind_full transform trampolines.
  exports.Set("logSetWriterFunc", Napi::Function::New(env, LogSetWriterFunc));
  exports.Set("logSetWriterDefault", Napi::Function::New(env, LogSetWriterDefault));
  exports.Set("bindPropertyFull", Napi::Function::New(env, BindPropertyFull));
  exports.Set("bindingGroupBindFull", Napi::Function::New(env, BindingGroupBindFull));
  // The native cairo binding + foreign-struct registration (the `__cairo` export).
  InitCairo(env, exports);
  return exports;
}

NODE_API_MODULE(node_gi, Init)
