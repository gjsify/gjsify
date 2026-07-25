// SPDX-License-Identifier: MIT
// @gjsify/napi — bootstrap, addon loader, module registration, teardown seam.
//
// §3a bootstrap: gjsify_napi_install() reaches the running JSContext via the
// public GJS accessors (refs/gjs/gjs/context.h:79,84) and installs ONE
// JSNative `globalThis.__gjsifyNapiLoadAddon` (non-enumerable, deleted by the
// L1 after capture). From then on loadAddon(path) is a plain JS→JSNative
// call: exports is a normal return value, load failures are real JS
// exceptions. No global side-channel per load; naturally reentrant.
//
// §3b symbol binding: the shim self-promotes its own napi_* into the global
// dynamic-symbol scope (dlopen(self, RTLD_NOLOAD|RTLD_NOW|RTLD_GLOBAL)), the
// addon is dlopen'd RTLD_NOW|RTLD_LOCAL. A version script exports only
// napi_*/node_api_*/gjsify_napi_* (src/cc/napi.export.map).
//
// §3c registration discovery mirrors refs/bun BunProcess.cpp:391-800 and
// refs/deno ext/napi/lib.rs:688-907; API-version clamp mirrors
// refs/node/src/node_api.cc:44-54 (Node.js contributors, MIT).
//
// §3d teardown seam: g_object_weak_ref on the GjsContext — GObject weak
// notifications fire inside the parent-class dispose chain-up
// (refs/gjs/gjs/context.cpp:393), i.e. BEFORE GJS's final GC (:437) and
// BEFORE JS_DestroyContext (:471), while the JSContext is fully alive. The
// P0.0 probe logs exactly that.

#include "common.h"

#include <dlfcn.h>
#include <limits.h>
#include <stdlib.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <map>

namespace gjsify_napi {

// Process-wide env registry — walked by the weak sweep callback and the
// idle finalizer drain (declared in common.h).
std::vector<napi_env>& env_registry() {
    static std::vector<napi_env> envs;
    return envs;
}

namespace {
// The single armed idle drain source (§5c finalization_scheduled guard).
guint finalizer_drain_source_id = 0;

gboolean drain_all_envs_idle(gpointer /* user_data */) {
    finalizer_drain_source_id = 0;  // allow re-arming from the drain itself
    for (napi_env env : env_registry()) {
        drain_finalizer_queue(env);
    }
    return G_SOURCE_REMOVE;
}
}  // namespace

// Called from enqueue_finalizer — including from inside the GC sweep
// callback, where g_idle_add is safe (it only locks the GLib main context;
// no JSAPI runs). The drain executes on the main loop, NEVER inside GC
// (§5c invariant: user finalizers never run during GC).
void schedule_finalizer_drain() {
    if (finalizer_drain_source_id == 0) {
        finalizer_drain_source_id = g_idle_add(drain_all_envs_idle, nullptr);
    }
}

static void cancel_finalizer_drain() {
    if (finalizer_drain_source_id != 0) {
        g_source_remove(finalizer_drain_source_id);
        finalizer_drain_source_id = 0;
    }
}

}  // namespace gjsify_napi

namespace {

bool loader_installed = false;

// §3c static-constructor path: our exported napi_module_register may run
// DURING dlopen (old-style NAPI_MODULE constructors). Modules land here.
std::vector<napi_module*> pending_modules;

// realpath → env; a second loadAddon replays the same exports (Bun's
// DLHandleMap, BunProcess.cpp:599-676).
std::map<std::string, napi_env>& env_cache() {
    static std::map<std::string, napi_env> cache;
    return cache;
}

std::vector<napi_env>& all_envs() {
    return gjsify_napi::env_registry();
}

// Throw a real JS exception from the loader (load failures are normal JS
// errors with real messages, §3a).
bool throw_load_error(JSContext* cx, const std::string& message) {
    JS_ReportErrorUTF8(cx, "%s", message.c_str());
    return false;
}

// §3d env-teardown seam + P0.0 probe. Fires while the JSContext is still
// alive (before the final GC + JS_DestroyContext) — exactly when Node-style
// env teardown must run (§5e).
void on_gjs_context_dispose(gpointer data, GObject* /* where_the_object_was */) {
    auto* cx = static_cast<JSContext*>(data);
    // Probe: JSRuntime-level and context-state calls must still succeed here.
    JSRuntime* rt = JS_GetRuntime(cx);
    const bool pending = JS_IsExceptionPending(cx);
    fprintf(stderr,
            "[gjsify-napi] P0.0 TEARDOWN PROBE: GjsContext weak notify fired; "
            "JS_GetRuntime=%p exception_pending=%d — JSContext alive at the "
            "env-teardown seam\n",
            static_cast<void*>(rt), pending ? 1 : 0);
    size_t count = all_envs().size();
    // Teardown may run finalizers that trigger GC — the weak sweep callback
    // must stay registered until every env released its weak refs.
    for (napi_env env : all_envs()) {
        env->teardown();
    }
    for (napi_env env : all_envs()) {
        delete env;  // frees bundles + remaining shells (no JS runs anymore)
    }
    all_envs().clear();
    env_cache().clear();
    // A still-armed idle drain must not fire into freed envs (and after
    // dispose the registry is empty anyway — belt and braces).
    gjsify_napi::cancel_finalizer_drain();
    // Remove the weak sweep callback BEFORE GJS's final full GC +
    // JS_DestroyContext (refs/gjs/gjs/context.cpp:437,471).
    JS_RemoveWeakPointerZonesCallback(cx, gjsify_napi::weak_sweep_callback);
    loader_installed = false;
    fprintf(stderr,
            "[gjsify-napi] P0.0 TEARDOWN PROBE: %zu env(s) torn down before "
            "JS_DestroyContext\n",
            count);
}

// §3b step 1+3: verify no foreign napi_* resolves globally, then promote our
// own symbols into the global scope so the addon's undefined napi_* bind to
// ours. Returns false with a thrown JS exception on failure.
bool ensure_napi_symbols_global(JSContext* cx) {
    void* ours = reinterpret_cast<void*>(&napi_create_reference);
    void* found = dlsym(RTLD_DEFAULT, "napi_create_reference");
    if (found == ours) {
        // Already promoted (or GI loaded us RTLD_GLOBAL in the first place).
        g_debug("gjsify-napi: napi_* already resolve globally; no promotion "
                "needed");
        return true;
    }
    if (found != nullptr) {
        return throw_load_error(
            cx,
            "gjsify-napi: a foreign Node-API implementation already resolves "
            "in this process (napi_create_reference found outside the shim); "
            "refusing to load addons into a mixed-host process");
    }
    Dl_info info;
    if (dladdr(ours, &info) == 0 || info.dli_fname == nullptr) {
        return throw_load_error(
            cx, "gjsify-napi: dladdr failed to locate the shim library");
    }
    // Re-opening an already-loaded DSO with RTLD_GLOBAL promotes its symbols
    // into the global scope regardless of how GI loaded it.
    void* self = dlopen(info.dli_fname, RTLD_NOLOAD | RTLD_NOW | RTLD_GLOBAL);
    if (self == nullptr) {
        const char* err = dlerror();
        return throw_load_error(
            cx, std::string("gjsify-napi: failed to promote shim symbols to "
                            "the global scope: ") +
                    (err != nullptr ? err : "unknown dlopen error"));
    }
    // Leaked on purpose: the shim must stay resident (refcount +1 is fine).
    void* now = dlsym(RTLD_DEFAULT, "napi_create_reference");
    if (now != ours) {
        return throw_load_error(
            cx, "gjsify-napi: symbol self-promotion did not take effect "
                "(napi_create_reference still not ours)");
    }
    g_debug("gjsify-napi: promoted shim napi_* symbols to the global scope "
            "(GI had loaded the shim RTLD_LOCAL)");
    return true;
}

// The loadAddon JSNative (§3a): dlopen + three-path registration (§3c),
// one napi_env per addon, exports as the return value.
bool load_addon_native(JSContext* cx, unsigned argc, JS::Value* vp) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, vp);
    if (args.length() < 1 || !args[0].isString()) {
        return throw_load_error(
            cx, "gjsify-napi: loadAddon(path) expects a string path");
    }
    JS::RootedString path_str(cx, args[0].toString());
    JS::UniqueChars path_utf8 = JS_EncodeStringToUTF8(cx, path_str);
    if (!path_utf8) {
        return false;  // OOM, exception already pending
    }

    char resolved[PATH_MAX];
    if (realpath(path_utf8.get(), resolved) == nullptr) {
        return throw_load_error(
            cx, std::string("gjsify-napi: cannot resolve addon path '") +
                    path_utf8.get() + "': " + strerror(errno));
    }
    const std::string key(resolved);

    auto cached = env_cache().find(key);
    if (cached != env_cache().end()) {
        args.rval().setObject(*cached->second->exports);
        return true;
    }

    if (!ensure_napi_symbols_global(cx)) {
        return false;
    }

    // §3b step 2: the addon imports napi_*; its own symbols must not pollute
    // the global scope or collide with a second addon → RTLD_LOCAL.
    const size_t pending_before = pending_modules.size();
    void* handle = dlopen(resolved, RTLD_NOW | RTLD_LOCAL);
    if (handle == nullptr) {
        const char* err = dlerror();
        return throw_load_error(
            cx, std::string("gjsify-napi: failed to load addon '") + resolved +
                    "': " + (err != nullptr ? err : "unknown dlopen error"));
    }

    // §3c path 1: static-constructor registration during dlopen. Validate +
    // move every newly registered module into a FIFO work queue; the queue
    // is re-drained after each init call (re-entrancy loop — a register fn
    // may register more, mirroring Bun's pending-module drain).
    std::vector<napi_module*> static_mods;
    auto drain_pending = [&]() -> const char* {
        while (pending_modules.size() > pending_before) {
            napi_module* mod = pending_modules[pending_before];
            pending_modules.erase(pending_modules.begin() +
                                  static_cast<long>(pending_before));
            if (mod->nm_version != NAPI_MODULE_VERSION) {
                return "legacy";
            }
            static_mods.push_back(mod);
        }
        return nullptr;
    };
    if (drain_pending() != nullptr) {
        dlclose(handle);
        return throw_load_error(
            cx, std::string("gjsify-napi: '") + resolved +
                    "' is a legacy (NAN/V8) addon (nm_version != 1); only "
                    "pure Node-API addons are supported");
    }

    // §3c path 2: per-addon API version; clamp exactly like
    // node_napi_env__::New (refs/node/src/node_api.cc:44-54).
    int32_t api_version = gjsify_napi::kNapiDefaultModuleApiVersion;
    auto get_api_version = reinterpret_cast<node_api_addon_get_api_version_func>(
        dlsym(handle, "node_api_module_get_api_version_v1"));
    if (get_api_version != nullptr) {
        api_version = get_api_version();
    }
    if (api_version < gjsify_napi::kNapiDefaultModuleApiVersion) {
        api_version = gjsify_napi::kNapiDefaultModuleApiVersion;
    }
    if (api_version == NAPI_VERSION_EXPERIMENTAL) {
        dlclose(handle);
        return throw_load_error(
            cx, std::string("gjsify-napi: '") + resolved +
                    "' targets the experimental Node-API version, which "
                    "@gjsify/napi Phase 0 refuses (in-GC finalizer regime "
                    "not implemented)");
    }
    if (api_version > gjsify_napi::kNapiVersionMax) {
        dlclose(handle);
        return throw_load_error(
            cx, std::string("gjsify-napi: '") + resolved +
                    "' requires Node-API version " +
                    std::to_string(api_version) +
                    ", but this runtime supports up to " +
                    std::to_string(gjsify_napi::kNapiVersionMax));
    }

    // §3c path 3: modern symbol-based registration.
    napi_addon_register_func modern_init = nullptr;
    if (static_mods.empty()) {
        modern_init = reinterpret_cast<napi_addon_register_func>(
            dlsym(handle, "napi_register_module_v1"));
        if (modern_init == nullptr) {
            dlclose(handle);
            return throw_load_error(
                cx,
                std::string("gjsify-napi: '") + resolved +
                    "' is not a Node-API module (no napi_register_module_v1 "
                    "export and no self-registration during dlopen)");
        }
    }

    // One napi_env per addon (node_api.cc:768-770).
    GjsContext* gjs = gjs_context_get_current();
    napi_env env = new napi_env__(cx, gjs, api_version, handle,
                                  std::string("file://") + resolved);
    all_envs().push_back(env);

    JS::RootedObject exports_obj(cx, JS_NewPlainObject(cx));
    if (!exports_obj) {
        return false;
    }

    // Call init(s) under call-into-module discipline: fresh handle scope; a
    // pending exception afterwards propagates as the JS throw it is (§6).
    // Each init receives the current exports; a non-null return replaces it
    // (node_api.cc:777-784). Static modules run in registration order,
    // re-draining after each call (an init may register more).
    napi_handle_scope scope = nullptr;
    napi_open_handle_scope(env, &scope);
    napi_value exports_v =
        gjsify_napi::arena_push(env, JS::ObjectValue(*exports_obj));
    bool pending = false;
    bool legacy_reentry = false;
    if (modern_init != nullptr) {
        napi_value init_ret = modern_init(env, exports_v);
        pending = JS_IsExceptionPending(cx);
        if (!pending && init_ret != nullptr) {
            exports_v = init_ret;
        }
    } else {
        for (size_t i = 0; i < static_mods.size() && !pending; i++) {
            napi_value init_ret =
                static_mods[i]->nm_register_func(env, exports_v);
            pending = JS_IsExceptionPending(cx);
            if (!pending && init_ret != nullptr) {
                exports_v = init_ret;
            }
            if (drain_pending() != nullptr) {
                legacy_reentry = true;
                break;
            }
        }
    }
    JS::RootedValue result_val(cx, gjsify_napi::napi_value_to_js(exports_v));
    napi_close_handle_scope(env, scope);
    if (pending) {
        return false;
    }
    if (legacy_reentry) {
        return throw_load_error(
            cx, std::string("gjsify-napi: '") + resolved +
                    "' registered a legacy (nm_version != 1) module during "
                    "init; only pure Node-API addons are supported");
    }
    if (!result_val.isObject()) {
        return throw_load_error(
            cx, std::string("gjsify-napi: module init of '") + resolved +
                    "' returned a non-object exports value");
    }

    env->exports = &result_val.toObject();
    env_cache()[key] = env;
    args.rval().set(result_val);
    return true;
}

}  // namespace

// §3c path 1 entry — exported; may be called by addon static constructors
// during dlopen (node_api.h:36-45).
void NAPI_CDECL napi_module_register(napi_module* mod) {
    pending_modules.push_back(mod);
}

// The file:// URL captured at load (node_api.cc:744-766). Pointer valid for
// the env's lifetime.
napi_status NAPI_CDECL node_api_get_module_file_name(
    node_api_basic_env basic_env, const char** result) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = env->filename.c_str();
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_version(node_api_basic_env basic_env,
                                        uint32_t* result) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    *result = gjsify_napi::kNapiVersionMax;
    return gjsify_napi::clear_last_error(env);
}

// node_api.cc's napi_get_node_version returns a pointer to a static
// napi_node_version filled from the NODE_*_VERSION macros. We report the Node
// release line the shim targets (node 24, the tested runtime; see AGENTS.md
// "node v24"). The struct is static/process-lifetime — the contract is that
// the returned pointer stays valid (node_api.cc:731-742).
napi_status NAPI_CDECL napi_get_node_version(node_api_basic_env basic_env,
                                             const napi_node_version** result) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    static const napi_node_version version = {24, 0, 0, "node"};
    *result = &version;
    return gjsify_napi::clear_last_error(env);
}

NAPI_NO_RETURN void NAPI_CDECL napi_fatal_error(const char* location,
                                                size_t location_len,
                                                const char* message,
                                                size_t message_len) {
    // node_api.cc OnFatalError shape: `location: message` to stderr + abort.
    fputs("FATAL ERROR: ", stderr);
    if (location != nullptr) {
        if (location_len == NAPI_AUTO_LENGTH) {
            fputs(location, stderr);
        } else {
            fwrite(location, 1, location_len, stderr);
        }
        fputs(" ", stderr);
    }
    if (message != nullptr) {
        if (message_len == NAPI_AUTO_LENGTH) {
            fputs(message, stderr);
        } else {
            fwrite(message, 1, message_len, stderr);
        }
    }
    fputs("\n", stderr);
    fflush(stderr);
    abort();
}

// ---- the GI bootstrap surface (§3a) ----

extern "C" gboolean gjsify_napi_install(void) {
    if (loader_installed) {
        return TRUE;
    }
    GjsContext* gjs = gjs_context_get_current();
    if (gjs == nullptr) {
        g_warning("gjsify-napi: no current GjsContext — init() must be "
                  "called from JS running under GJS");
        return FALSE;
    }
    auto* cx = static_cast<JSContext*>(gjs_context_get_native_context(gjs));
    if (cx == nullptr) {
        g_warning("gjsify-napi: GjsContext has no native JSContext");
        return FALSE;
    }
    JS::RootedObject global(cx, JS::CurrentGlobalOrNull(cx));
    if (!global) {
        g_warning("gjsify-napi: no current JS global (not inside a realm)");
        return FALSE;
    }
    JSFunction* fn = js::NewFunctionWithReserved(cx, load_addon_native, 1, 0,
                                                 "__gjsifyNapiLoadAddon");
    if (fn == nullptr) {
        g_warning("gjsify-napi: failed to create the loadAddon native");
        return FALSE;
    }
    JS::RootedObject fn_obj(cx, JS_GetFunctionObject(fn));
    // attrs 0 → non-enumerable, writable, configurable — the L1 deletes the
    // property after capturing the function.
    if (!JS_DefineProperty(cx, global, "__gjsifyNapiLoadAddon", fn_obj, 0)) {
        g_warning("gjsify-napi: failed to define __gjsifyNapiLoadAddon");
        return FALSE;
    }
    // §5b weak machinery: ONE process-wide sweep callback (GJS registers its
    // own compartment variant the same way, gi/object.cpp:2503). Removed in
    // on_gjs_context_dispose before the final GC.
    if (!JS_AddWeakPointerZonesCallback(cx, gjsify_napi::weak_sweep_callback,
                                        nullptr)) {
        g_warning("gjsify-napi: failed to register the weak sweep callback");
        return FALSE;
    }
    // §3d teardown seam: weak notification fires pre-final-GC,
    // pre-JS_DestroyContext (probe in on_gjs_context_dispose).
    g_object_weak_ref(G_OBJECT(gjs), on_gjs_context_dispose, cx);
    loader_installed = true;
    return TRUE;
}
