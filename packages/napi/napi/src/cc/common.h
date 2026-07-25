// SPDX-License-Identifier: MIT
// @gjsify/napi — Node-API (N-API) host over GJS's SpiderMonkey (mozjs-140).
//
// Reference: refs/node/src/js_native_api_v8.{h,cc} + node_api.cc (Node.js
// contributors, MIT) — the normative Node-API reference implementation whose
// observable semantics this shim mirrors over JSAPI. GJS's own production
// patterns are the mechanism reference: extra-GC-roots tracer
// (refs/gjs/gjs/context.cpp), natives-with-reserved-slots
// (refs/gjs/gjs/jsapi-dynamic-class.cpp), public context accessors
// (refs/gjs/gjs/context.h). GNOME contributors, MIT/LGPLv2+.
//
// Cross-TU layout (node-gi common.h idiom): this header owns every
// cross-TU declaration in `namespace gjsify_napi` plus the `napi_env__`
// definition (global scope — the tag is declared by the vendored
// js_native_api_types.h). Functional slices:
//   env.cc      — arena, tracer, handle scopes, env lifecycle/teardown
//   value.cc    — minimal value surface (undefined/null/object/string/typeof)
//   function.cc — JSNative trampoline, napi_create_function, napi_get_cb_info
//   error.cc    — status bookkeeping, throw/pending mapping, stubs
//   module.cc   — gjsify_napi_install, loadAddon, dlopen + registration,
//                 napi_get_version, napi_fatal_error, teardown seam

#ifndef GJSIFY_NAPI_SRC_CC_COMMON_H_
#define GJSIFY_NAPI_SRC_CC_COMMON_H_

// Surface every declaration up to the max version this host reports
// (napi_get_version = 10) when compiling the shim itself.
#define NAPI_VERSION 10

#include "js_native_api.h"  // vendored, src/napi-headers/
#include "node_api.h"       // vendored, src/napi-headers/

#include <glib-object.h>
#include <glib.h>

#include <gjs/gjs.h>  // umbrella: gjs/context.h forbids direct inclusion

#include <jsapi.h>
#include <jsfriendapi.h>

#include <js/Array.h>
#include <js/BigInt.h>
#include <js/CallAndConstruct.h>
#include <js/CallArgs.h>
#include <js/CharacterEncoding.h>
#include <js/Class.h>
#include <js/CompilationAndEvaluation.h>
#include <js/Conversions.h>
#include <js/Equality.h>
#include <js/GCVector.h>
#include <js/Id.h>
#include <js/Object.h>
#include <js/PropertyDescriptor.h>
#include <js/SourceText.h>
#include <js/Context.h>
#include <js/ErrorReport.h>
#include <js/Exception.h>
#include <js/GCAPI.h>
#include <js/GlobalObject.h>
#include <js/PropertyAndElement.h>
#include <js/RootingAPI.h>
#include <js/String.h>
#include <js/Symbol.h>
#include <js/TracingAPI.h>
#include <js/Value.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace gjsify_napi {

// NODE_API_SUPPORTED_VERSION_MAX / NODE_API_DEFAULT_MODULE_API_VERSION
// (refs/node/src/node_version.h:103-108).
constexpr int32_t kNapiVersionMax = 10;
constexpr int32_t kNapiDefaultModuleApiVersion = 8;

// ---- handle arena (§5a) ----
//
// `napi_value` = pointer to a `JS::Heap<JS::Value>` slot in a per-env chunked
// arena. Chunks are fixed-size heap blocks that never move or realloc, so a
// slot address stays stable for the lifetime of its handle scope — the
// property V8's handle blocks give Node's `napi_value`. `JS::Heap` provides
// the pre/post barriers a heap-stored GC pointer needs under SpiderMonkey's
// generational GC; the per-env extra-GC-roots tracer (env.cc) marks *and
// relocates* live slots, so outstanding `napi_value` pointers survive moving
// GC. NOT `JS::Rooted` (stack-only, LIFO) and NOT a raw `JS::Value` (goes
// stale across nursery evacuation) — those cannot back a C ABI.

constexpr size_t kArenaChunkSlots = 256;

struct ArenaChunk {
    JS::Heap<JS::Value> slots[kArenaChunkSlots];
};

class HandleArena {
  public:
    // Store `value` in the next slot; returns the stable slot address.
    JS::Heap<JS::Value>* push(const JS::Value& value);
    size_t top() const { return top_; }
    // Release slots [mark, top): clear them (write barrier via JS::Heap
    // assignment) and rewind. Chunk storage is retained for reuse.
    void popTo(size_t mark);
    // Trace live slots [0, top) — called from the env's extra-roots tracer.
    void trace(JSTracer* trc);
    // Env teardown: clear every live slot and free the chunks. Must run
    // before JS_DestroyContext (a live JS::Heap past that point is UAF).
    void clearAll();

  private:
    JS::Heap<JS::Value>* slotAt(size_t index);
    std::vector<std::unique_ptr<ArenaChunk>> chunks_;
    size_t top_ = 0;
};

// A handle scope is a saved arena top; scopes close LIFO
// (napi_handle_scope_mismatch otherwise), matching
// js_native_api_v8.cc:2927-2953. The napi_handle_scope /
// napi_escapable_handle_scope pointer encodes the 1-based scope-stack depth
// (no heap allocation, trivially validated). Escapable scopes (cc:2955-3002)
// reserve ONE slot in the PARENT region at open (Bun's trick,
// refs/bun/src/jsc/bindings/napi_handle_scope.cpp:24-27,66-75);
// napi_escape_handle copies the escapee into that slot once.
struct HandleScopeRec {
    size_t mark;
    bool escapable = false;
    bool escape_called = false;
    // The parent-region slot (address stable — chunks never move); only
    // set for escapable scopes. Lives BELOW mark, so close leaves it alive.
    JS::Heap<JS::Value>* escape_slot = nullptr;
};

// ---- callbacks (§8) ----

// Heap bundle behind every napi-created function; owned by the env, freed at
// env destruction (Phase-0 simplification of V8-Node's weak-ref-on-function
// early free, js_native_api_v8.cc:398-402). Stored in reserved slot 0 of the
// js::NewFunctionWithReserved native as a JS::PrivateValue.
struct CallbackBundle {
    napi_env env;
    napi_callback cb;
    void* data;
    // napi_define_class constructor: constructing creates the instance with
    // the fast-tier instance JSClass (reserved slots) instead of a plain
    // object (§5d).
    bool construct_as_class = false;
};

// ---- §5b references + finalizer pipeline ----

enum class ReferenceOwnership : uint8_t {
    kRuntime,   // the runtime deletes the reference after its finalizer ran
    kUserland,  // userland must delete it via napi_delete_reference
};

// Intrusive doubly-linked base for everything finalized at env teardown —
// mirror of js_native_api_v8.h:101-130 RefTracker. Env holds two sentinel
// heads: `finalizing_reflist` (user finalizer present) and `reflist`
// (plain), finalized in that order at teardown (the v8.h:121-130 comment
// explains why finalizing refs go first: their finalizers may still use
// plain refs).
class RefTracker {
  public:
    RefTracker() = default;
    virtual ~RefTracker() { Unlink(); }
    // Finalization: unlinks + (subclass) runs the user callback. May be
    // called at most once; implementations must Unlink() first.
    virtual void Finalize() {}
    void Link(RefTracker* list_head);
    void Unlink();
    static void FinalizeAll(RefTracker* list_head);
    // Trace hook for the env's extra-roots tracer (Reference overrides).
    virtual void Trace(JSTracer* trc) {}
    RefTracker* next() const { return next_; }

  protected:
    RefTracker* next_ = nullptr;
    RefTracker* prev_ = nullptr;
};

// A queued napi_finalize callback that is not attached to a JS value:
// node_api_post_finalizer + napi_set_instance_data (§5d instance data).
// Finalize() runs the callback (JS callable, fresh handle scope) and
// deletes itself.
class TrackedFinalizer : public RefTracker {
  public:
    TrackedFinalizer(napi_env env, napi_finalize cb, void* data, void* hint);
    ~TrackedFinalizer() override;
    void Finalize() override;
    void* data() const { return data_; }

  private:
    napi_env env_;
    napi_finalize cb_;
    void* data_;
    void* hint_;
};

// napi_ref (§5b): strong/weak/refcounted, v10 primitive semantics. State
// machine mirrors js_native_api_v8.cc:690-757 (Ref/Unref/SetWeak):
// refcount 0→1 = leave the weak set + become traced-strong; 1→0 = SetWeak;
// SetWeak on a non-weakable value releases immediately (primitives at
// refcount 0 read back as empty — the v10 semantic better-sqlite3 relies
// on). SpiderMonkey mechanics:
//  - strong state: value lives in a JS::Heap<JS::Value> traced (marks AND
//    relocates) from the env's extra-roots tracer;
//  - weak state: the object lives in a JS::Heap<JSObject*> that is NOT
//    traced; the weak sweep callback updates it via
//    JS_UpdateWeakPointerAfterGC — moved ⇒ pointer updated, dead ⇒ nulled
//    (GCAPI.h contract; GJS jsapi-util-root.h update_after_gc pattern);
//  - both flips stack-root the object across the transition (GJS
//    switch_to_rooted/switch_to_unrooted pattern: never leave the thing in
//    neither slot); JS::Heap assignments run the pre/post write barriers,
//    JS::Heap::get() runs the read barrier (gray-unmarking on
//    resurrection) — js/RootingAPI.h Heap<T> barrier contract.
class Reference : public RefTracker {
  public:
    static Reference* New(napi_env env, JS::HandleValue value,
                          uint32_t initial_refcount,
                          ReferenceOwnership ownership,
                          napi_finalize cb = nullptr, void* data = nullptr,
                          void* hint = nullptr);
    ~Reference() override;

    uint32_t Ref();
    uint32_t Unref();
    uint32_t RefCount() const { return refcount_; }
    ReferenceOwnership Ownership() const { return ownership_; }
    void* Data() const { return data_; }
    bool HasFinalizer() const { return cb_ != nullptr; }
    // false when released/dead (napi_get_reference_value → NULL).
    bool GetValue(JS::MutableHandleValue out);
    // Weak sweep: update weak_obj_; on death → released + dequeued from the
    // weak set by the caller; returns true when the referent died.
    bool UpdateAfterGC(JSTracer* trc);
    void Finalize() override;
    void Trace(JSTracer* trc) override;
    void RemoveFromWeakSet();

    napi_env env() const { return env_; }

  private:
    Reference(napi_env env, JS::HandleValue value, uint32_t initial_refcount,
              ReferenceOwnership ownership, napi_finalize cb, void* data,
              void* hint);
    void SetWeakOrRelease();  // 1→0 transition (or weakable init at 0)

    enum class State : uint8_t { kStrong, kWeak, kReleased };
    napi_env env_;
    State state_;
    uint32_t refcount_;
    ReferenceOwnership ownership_;
    bool can_be_weak_;  // value.isObject(); symbols = primitives (§5b ledger)
    napi_finalize cb_;
    void* data_;
    void* hint_;
    JS::Heap<JS::Value> strong_;     // valid iff state == kStrong
    JS::Heap<JSObject*> weak_obj_;   // valid iff state == kWeak
};

// Finalizer pipeline (§5c): GC callbacks only QUEUE; ONE idle drain
// (finalization_scheduled guard) runs finalizers with JS callable, each
// under a fresh handle scope, exceptions logged-and-cleared between
// finalizers. A tight synchronous script never iterates the main context,
// so it observes finalizers only at env teardown (documented; matches
// Node's SetImmediate needing a loop turn). ref.cc.
void enqueue_finalizer(napi_env env, RefTracker* tracker);
void dequeue_finalizer(napi_env env, RefTracker* tracker);
void drain_finalizer_queue(napi_env env);
// The per-process weak sweep callback (JSWeakPointerZonesCallback);
// registered once at install, walks every env's weak set. ref.cc.
void weak_sweep_callback(JSTracer* trc, void* data);
// Process-wide env registry (module.cc owns the storage).
std::vector<napi_env>& env_registry();
// Ask module.cc to arm the one idle drain source (no-op if armed).
void schedule_finalizer_drain();

// Log + clear a pending exception on env->cx (shared by the finalizer
// pipeline and the tsfn/make_callback boundary — the "no JS frame below us"
// posture). No-op when nothing is pending. ref.cc.
void log_and_clear_pending_exception(napi_env env, const char* where);

// ---- §7 threadsafe functions (tsfn.cc) ----

// Env teardown step 1b: synchronously finalize every tsfn still registered on
// the env (their deferred JS-thread finalize dispatch can no longer run once
// GjsContext dispose has begun). Runs with JS fully callable.
void finalize_env_tsfns(napi_env env);

// ---- §? asynchronous work items (async_work.cc) ----

// Env teardown step 1c (§5e crash-class boundary): drain the worker pool
// deterministically — g_thread_pool_free(wait=TRUE) lets in-flight execute
// finish and JOINS every worker, so none touches the tearing-down env — then
// run every still-pending completion synchronously, JS callable (the deferred
// g_idle can no longer fire once GjsContext dispose has begun — mirror
// finalize_env_tsfns).
void drain_env_async_works(napi_env env);
// Env destruction: free every async_work the addon never deleted (Node leaks
// its equivalent — the struct is addon-owned). Runs after teardown, no JS.
void destroy_env_async_works(napi_env env);

// ---- §5d instance state: fast tier + WeakMap tier ----
//
// Instances of napi_define_class classes and napi_create_external externals
// carry ONE reserved slot: undefined or JS::PrivateValue(InstanceState*).
// The InstanceState is freed by a FOREGROUND finalize hook that frees
// memory only (legal even for nursery deaths — finalizable classes are
// nursery-allocatable in 140; JSFinalizeOp runs with JS::GCContext*,
// js/Class.h:301, and must not call GC-capable JSAPI). Foreign objects get
// the same InstanceState via a lazily-created env WeakMap (js/WeakMap.h)
// whose value is a hostdata_class carrier object. Pattern: GJS
// cwrapper.h reserved-slot storage + JSCLASS_FOREGROUND_FINALIZE like
// GJS's GObject wrapper (gi/object.cpp:3404-3407).
constexpr size_t kInstanceSlotState = 0;

struct InstanceState {
    Reference* wrap = nullptr;  // §5d uniform wrap lifecycle
    bool has_tag = false;
    napi_type_tag tag = {0, 0};
    bool is_external = false;
    void* external_data = nullptr;
};

extern const JSClass instance_class;   // napi_define_class instances
extern const JSClass external_class;   // napi_create_external
extern const JSClass hostdata_class;   // WeakMap-tier value carrier

// Look up (or create) the InstanceState for any object; *out == nullptr
// when absent and !create. wrap.cc.
napi_status get_instance_state(napi_env env, JS::HandleObject obj,
                               bool create, InstanceState** out);

// Shared property-descriptor applier (object.cc) — the body of
// napi_define_properties, reused by napi_define_class for both the
// prototype (non-static) and constructor (napi_static) targets.
napi_status apply_property_descriptor(napi_env env, JS::HandleObject target,
                                      const napi_property_descriptor& p);

// Property id from a descriptor's utf8name XOR name (napi_name_expected
// otherwise); name must be a string or symbol. (object.cc)
napi_status property_key_to_id(napi_env env, const char* utf8name,
                               napi_value name, JS::MutableHandleId id);

// Lossy UTF-8 → JSString (invalid sequences → U+FFFD, matching V8's
// NewFromUtf8; SpiderMonkey's JS_NewStringCopyUTF8N throws on malformed
// input, so this falls back to LossyUTF8CharsToNewTwoByteCharsZ). Returns
// nullptr on OOM with the exception cleared. (value.cc)
JSString* new_string_utf8_lossy(JSContext* cx, const char* str, size_t len);

// Bundle-function factory shared by napi_create_function,
// napi_define_class and the accessor/method descriptors. (function.cc)
JSObject* new_bundle_function(napi_env env, const char* utf8name,
                              size_t length, napi_callback cb, void* data,
                              unsigned flags, bool construct_as_class);

// Stack-allocated per trampoline invocation; napi_callback_info points here.
struct CallbackInfo {
    napi_value* argv;       // arena slots, one per provided argument
    size_t argc;
    napi_value this_arg;    // arena slot
    napi_value new_target;  // nullptr when not constructing (P0.2)
    void* data;             // bundle->data
};

// The shared JSNative all napi-created functions dispatch through.
bool function_trampoline(JSContext* cx, unsigned argc, JS::Value* vp);

// ---- status bookkeeping (§6, error.cc) ----

napi_status set_last_error(napi_env env, napi_status status,
                           uint32_t engine_error_code = 0,
                           void* engine_reserved = nullptr);
napi_status clear_last_error(napi_env env);

// ---- value boxing (env.cc) ----

// The single choke point boxing a JSAPI value into an env arena slot.
napi_value arena_push(napi_env env, const JS::Value& value);

// Deref a napi_value back to the engine value.
inline JS::Value napi_value_to_js(napi_value value) {
    return reinterpret_cast<JS::Heap<JS::Value>*>(value)->get();
}

// The env's extra-GC-roots trace hook (env.cc).
void trace_env(JSTracer* trc, void* data);

}  // namespace gjsify_napi

// ---- napi_env (§5e, minimal P0.0 shape) ----
//
// Global scope: the struct tag is fixed by the vendored
// `typedef struct napi_env__* napi_env`.
struct napi_env__ {
    JSContext* cx;
    GjsContext* gjs_context;
    // Per-addon Node-API version (§3c discovery + clamp); gates §5b/§6
    // behavior from P0.1 on.
    int32_t module_api_version;
    gjsify_napi::HandleArena arena;
    std::vector<gjsify_napi::HandleScopeRec> scopes;
    napi_extended_error_info last_error = {nullptr, nullptr, 0, napi_ok};
    // dlopen handle of the addon; kept for the process lifetime (Node never
    // dlcloses registered addons either).
    void* dl_handle = nullptr;
    // file:// URL of the addon (node_api_get_module_file_name, P0.5).
    std::string filename;
    // false during/after teardown — NAPI_PREAMBLE gate.
    bool can_call_into_js = true;
    bool torn_down = false;
    bool tearing_down = false;
    bool draining_finalizers = false;
    // Bundle ownership (§8): freed at destruction.
    std::vector<gjsify_napi::CallbackBundle*> bundles;
    // The addon's exports object, rooted for the exports cache. Reset in
    // teardown() — a live PersistentRooted past JS_DestroyContext is UAF.
    JS::PersistentRooted<JSObject*> exports;
    // The realm global captured at env creation (napi_get_global — Node's
    // context()->Global() analog). Reset in teardown().
    JS::PersistentRooted<JSObject*> global;
    // Foreign-object InstanceState WeakMap (§5d fallback tier), lazily
    // created. Reset in teardown().
    JS::PersistentRooted<JSObject*> wrap_map;

    // §5b ref lists (sentinel heads; two-list teardown order per
    // js_native_api_v8.h:121-130).
    gjsify_napi::RefTracker reflist;
    gjsify_napi::RefTracker finalizing_reflist;
    // Weak set: references currently in the kWeak state, walked by the
    // sweep callback.
    std::vector<gjsify_napi::Reference*> weak_refs;
    // §5c pending finalizers (FIFO), drained on idle or at teardown.
    std::vector<gjsify_napi::RefTracker*> pending_finalizers;
    // §5d instance data (TrackedFinalizer; overwrite deletes un-finalized).
    gjsify_napi::TrackedFinalizer* instance_data = nullptr;
    // §7 live threadsafe functions (JS-thread-only access: registered at
    // create, unregistered by the JS-thread finalize; teardown force-
    // finalizes leftovers — tsfn.cc).
    std::vector<napi_threadsafe_function> tsfns;
    // Live async_work items (registered at create on the JS thread, unlinked by
    // the completion dispatch's self-delete; teardown drains pending
    // completions, the destructor frees leftovers — async_work.cc).
    std::vector<napi_async_work> async_works;
    // Per-env worker pool backing napi_queue_async_work (libuv-thread-pool
    // analog). Lazily created on first queue; drained + freed deterministically
    // at teardown (g_thread_pool_free wait=TRUE) BEFORE any root is dropped, so
    // no worker outlives the env. nullptr until the first queue — async_work.cc.
    GThreadPool* async_pool = nullptr;
    // Env cleanup hooks, run LIFO as teardown step 1.
    struct CleanupHook {
        void(NAPI_CDECL* fn)(void* arg);
        void* arg;
    };
    std::vector<CleanupHook> cleanup_hooks;

    napi_env__(JSContext* cx, GjsContext* gjs, int32_t api_version,
               void* handle, std::string file);
    ~napi_env__();

    // §5e teardown order (the node-gi SIGSEGV lesson — full sequence):
    // 1. run env cleanup hooks LIFO (JS fully available);
    // 2. drain pending finalizers (finalizers may call napi and create
    //    values — arena, tracer and can_call_into_js MUST still be live);
    // 3. RefTracker::FinalizeAll(finalizing_reflist) then (reflist);
    // 4. instance-data finalizer;
    // 5. flip can_call_into_js/torn_down (subsequent napi entry → status);
    // 6. drop every root: remove the extra-roots tracer, reset
    //    PersistentRooteds, clear arena/scopes/weak set — all BEFORE
    //    JS_DestroyContext runs (a live root past that point is the UAF
    //    class). Callback bundles are NOT freed here: live function
    //    objects still reference them and the trampoline guards on
    //    torn_down; the destructor frees them at context dispose.
    void teardown();
};

namespace gjsify_napi {

// ---- status check macros (mirroring js_native_api_v8.h:233-243) ----

#define GJSIFY_NAPI_CHECK_ENV(env)      \
    do {                                \
        if ((env) == nullptr) {         \
            return napi_invalid_arg;    \
        }                               \
    } while (0)

#define GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, condition, status)     \
    do {                                                               \
        if (!(condition)) {                                            \
            return gjsify_napi::set_last_error((env), (status));       \
        }                                                              \
    } while (0)

#define GJSIFY_NAPI_CHECK_ARG(env, arg) \
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE((env), ((arg) != nullptr), napi_invalid_arg)

// The NAPI_PREAMBLE partition (§6): only for functions that can run JS.
// Pending exception ⇒ napi_pending_exception immediately; torn-down env ⇒
// napi_cannot_run_js (module_api_version >= 10) / napi_pending_exception
// (< 10); then clear last_error. Pure value/scope ops must NOT use this —
// they keep working while an exception is pending.
#define GJSIFY_NAPI_PREAMBLE(env)                                             \
    GJSIFY_NAPI_CHECK_ENV(env);                                               \
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(                                       \
        (env), !JS_IsExceptionPending((env)->cx), napi_pending_exception);    \
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(                                       \
        (env), (env)->can_call_into_js,                                       \
        ((env)->module_api_version >= 10 ? napi_cannot_run_js                 \
                                         : napi_pending_exception));          \
    gjsify_napi::clear_last_error(env)

}  // namespace gjsify_napi

// The C bridge the Vala `GjsifyNapi.init()` body calls (module.cc).
extern "C" gboolean gjsify_napi_install(void);

#endif  // GJSIFY_NAPI_SRC_CC_COMMON_H_
