// SPDX-License-Identifier: MIT
// @gjsify/node-gi — GObject-Introspection runtime for Node.js.
//
// Reference: refs/node-gtk (romgrk and node-gtk contributors, MIT). The design
// of this binding derives from node-gtk; this file is an original N-API
// implementation retargeted to the modern girepository-2.0 API (the
// GLib-integrated `gi_*` GIRepository merged into GLib >= 2.80; the standalone
// libgirepository-1.0 node-gtk linked no longer ships). GJS's gi/repo.cpp is
// the reference for the girepository-2.0 API surface.
//
// Milestone 1 (headless core): the modern GIRepository API end to end — resolve
// the default repository, require namespaces, marshal functions/methods/props/
// signals/callbacks/variants/containers, the libuv↔GLib mainloop bridge, and the
// toggle-ref instance GC bridge (single canonical wrapper per GObject; toggle ref
// flips strong↔weak so wrappers are collectable yet identity-stable + rooted
// while C owns them; idle-deferred teardown; resurrection; thread-marshalled
// toggles). GTK/Adwaita layering lands on top.

#ifndef NODE_GI_SRC_COMMON_H_
#define NODE_GI_SRC_COMMON_H_

#ifndef _WIN32
#include <dlfcn.h>  // dlopen/dlsym the GtkWidgetClass template API (no GTK link)
#endif
#include <napi.h>
#include <uv.h>

#include <girepository/girepository.h>
#include <girepository/girffi.h>  // gi_callable_info_create_closure + ffi_cif
#include <glib-object.h>
#include <glib.h>

#include <atomic>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
// libuv's uv.h transitively includes <windows.h>, whose <winuser.h> defines the
// object-like macro `RegisterClass` (→ RegisterClassW, the Win32 window-class API).
// It clobbers our identically-named N-API export `RegisterClass`. We never call the
// Win32 windowing API, so undefine it (it is the only Win32 UI macro that collides
// with a node-gi identifier — `RegisterClassFromGType` is a distinct token).
#undef RegisterClass
#endif

namespace nodegi {

// Forward declaration: GetConstantValue (defined early, near the namespace
// helpers) marshals through GIArgumentToJs, whose definition lives further down
// with the rest of the value-marshalling boundary.
Napi::Value GIArgumentToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                           GITransfer transfer);

GIRepository* DupDefaultRepository();

// Per-env state, stored in N-API instance data so each env (incl. a
// worker_threads worker) holds + derefs its OWN GLib.Error builder ref. A napi_ref
// is env-specific: keying it per-env (not a file-static slot shared across every
// env) removes both the cross-env clobber (last loader wins, prior envs lose the
// builder) AND the cross-env deref (env A reading env B's ref = UB). Created in
// Init, freed by the instance-data finalizer at env teardown.
struct NodeGiEnvData {
  napi_ref errorBuilder = nullptr;
  // L1-registered resolver for Gtk.Template `<signal handler="…">` callbacks: given
  // (instanceHandle, handlerName) it returns the instance's bound JS method (or
  // undefined). Stored per-env for the same reason as errorBuilder (a napi_ref is
  // env-specific). See the Gtk.Widget composite-template scope further down.
  napi_ref templateCallbackResolver = nullptr;
  // The cairo L1 module's JS wrapper factories ({context, surface, pattern}), set
  // by the native cairo `setup()` when `import 'cairo'` first loads. The
  // foreign-struct from_func calls them to wrap a returned/callback cairo pointer
  // into the JS Context/Surface(/ImageSurface)/Pattern class instance. Per-env for
  // the same reason as errorBuilder (a napi_ref is env-specific). See cairo.cc.
  napi_ref cairoWrappers = nullptr;
  // The runtime-native microtask drain (Bun: `bun:jsc` drainMicrotasks; Deno:
  // core.runMicrotasks), registered by index.js on non-Node runtimes only — see
  // setMicrotaskDrain / NodeGiMaybeDrainMicrotasks in loop.cc. Never set on Node
  // (napi_make_callback already runs the checkpoint there). Per-env for the same
  // reason as errorBuilder (a napi_ref is env-specific).
  napi_ref microtaskDrain = nullptr;
  // L1 callback that runs a registered class's JS constructor body on a
  // pre-existing canonical wrapper — invoked by NodeGiConstructor for a GObject
  // instantiated from C (a GtkBuilder composite-template InternalChild), whose JS
  // ctor the node-gi JS-`new` path never reaches. (handle, gtypeName) →
  // Reflect.construct(class) in adopt mode (see gi.js runCtorForCObject). Per-env
  // for the same reason as errorBuilder (a napi_ref is env-specific).
  napi_ref constructCallback = nullptr;
};

void NodeGiEnvDataFinalize(napi_env env, void* data, void* hint);
NodeGiEnvData* EnvData(napi_env env);

// ---- boxed / struct handles (milestone: mainloop) ----
//
// Boxed/struct instances (e.g. GMainLoop) are wrapped as type-tagged Externals
// over a small heap record carrying the pointer + its boxed GType, so the
// finalizer can g_boxed_free a fully-owned boxed and method resolution can find
// the struct's GIStructInfo by GType. Distinct tag from the GObject handle so
// the two never cross-dereference. Full general struct support (field access,
// copy semantics for non-registered C structs) lands with the broader
// structs/boxed drop; this is the slice the GLib main loop needs.
struct BoxedHandle {
  gpointer ptr;
  GType gtype;  // boxed GType, or G_TYPE_INVALID when unknown/non-registered
  bool owns;    // g_boxed_free(gtype, ptr) on finalize when true
  // The struct/union GIBaseInfo backing this handle (a held ref, unref'd on
  // finalize), or nullptr. Carried so field + method resolution works for an
  // UNREGISTERED struct whose runtime GType is G_TYPE_NONE (e.g. GIMarshalling
  // SimpleStruct) — find_by_gtype can't recover the info there, so the static
  // info from the wrap site is stored. A registered type may leave this nullptr
  // and be re-resolved via find_by_gtype(gtype).
  GIBaseInfo* info;
  // g_free(ptr) on finalize. For a NON-boxed plain C struct whose storage the
  // engine g_malloc0'd itself (a caller-allocates OUT param, e.g. a filled
  // PangoRectangle): there is no boxed free-func, the handle simply owns the
  // malloc'd block. Mutually exclusive with `owns` (boxed ownership).
  bool rawOwned = false;
};

extern const napi_type_tag kBoxedHandleTag;
extern const napi_type_tag kGObjectHandleTag;

// `info` (optional): the struct/union GIBaseInfo backing the handle. When passed,
// MakeBoxedHandle takes its OWN ref (the caller keeps its own), unref'd on finalize.
// `rawOwned` (optional): the handle owns a plain g_malloc'd block — g_free(ptr) on
// finalize (the non-boxed caller-allocates OUT case; see BoxedHandle::rawOwned).
Napi::Value MakeBoxedHandle(Napi::Env env, gpointer ptr, GType gtype, bool owns,
                            GIBaseInfo* info = nullptr, bool rawOwned = false);
Napi::Value WrapVariant(Napi::Env env, GVariant* var, GITransfer transfer);
BoxedHandle* TryGetBoxedHandle(Napi::Value v);
bool TryGetBoxedPtr(Napi::Value v, gpointer* out);
Napi::Value MakeGTypeHandle(Napi::Env env, GType gtype);
GType ReadGTypeHandle(Napi::Value v);
bool UnwrapGTypeArg(Napi::Env env, Napi::Value v, GType* out);

// ---- foreign-struct seam (cairo) --------------------------------------------
//
// A "foreign" struct (gi_struct_info_is_foreign) is one whose layout GI does not
// know — it delegates marshalling to a module. cairo's Context/Surface/Pattern are
// the canonical case: a GI function taking/returning a cairo_t*/cairo_surface_t*/
// cairo_pattern_t* (e.g. a Gtk.DrawingArea draw-func's cairo_t) round-trips through
// the cairo module's converters, NOT the generic boxed path. Mirrors GJS's
// gi/foreign.cpp seam (gjs_struct_foreign_register / lookup / to/from_gi_argument).
//
// A registered module (cairo.cc) supplies `to` (JS wrapper -> GIArgument.v_pointer)
// and `from` (GIArgument.v_pointer -> a fresh JS wrapper). Ownership follows the
// node-gi adopt-or-ref model (no separate release call, matching WrapBoxed).
struct ForeignStructOps {
  bool (*to)(Napi::Env, Napi::Value, GITransfer, GIArgument*);
  Napi::Value (*from)(Napi::Env, gpointer, GITransfer);
};
void RegisterForeignStruct(const char* ns, const char* type_name, const ForeignStructOps* ops);
const ForeignStructOps* LookupForeignStruct(const char* ns, const char* type_name);
// The foreign ops for a struct/union GIBaseInfo, or null when it is not a
// registered foreign type — used by the INTERFACE marshalling branches to route a
// cairo-typed arg/return/callback-arg to the module instead of the boxed path.
const ForeignStructOps* ForeignOpsForInfo(GIBaseInfo* iface);

// cairo.cc — the native cairo binding + foreign-struct registration. Called once
// from addon.cc's Init; sets the `__cairo` export + registers Context/Surface/
// Pattern foreign converters.
void InitCairo(Napi::Env env, Napi::Object exports);

// ---- GJS-exact 64-bit integer marshalling helpers (shared) -------------------
//
// Single source of truth for BigInt/Number ⇄ 64-bit C int, used by the GI scalar
// + array-element marshaller (marshal.cc), the GValue property marshaller
// (object.cc), and the GVariant packer/unpacker (variant.cc).
//
// IN (JsValueTo{Int,Uint}64): a BigInt is read LOSSLESSLY — GJS uses
// JS::ToBigInt64 / JS::ToBigUint64 (refs/gjs/gi/js-value-inl.h:126-146): a BigInt
// is exact by construction, a wrapping conversion, NOT an error, so `lossless` is
// intentionally ignored. A plain Number is truncated via node-addon-api's
// Int64Value (GJS truncates a Number via JS::ToInt64 — also not an error). The
// BigInt branch is load-bearing: `ToNumber()` on a BigInt sets a pending N-API
// error under NAPI_DISABLE_CPP_EXCEPTIONS, and the follow-up `Napi::Error::New`
// would fatally abort the process (exit 134) instead of marshalling — a crash the
// repo invariant forbids.

// ---- terminate-safe coercion helpers ----------------------------------------
//
// Under NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS a fallible node-addon-api call on
// an env that can no longer run JS (worker.terminate() landing while a JS→GI call
// is inside this addon, or env teardown) returns a DEFAULT-CONSTRUCTED value
// (`_env == nullptr`) instead of aborting — the throw is swallowed, the value is
// empty. Chaining the NEXT fallible wrapper call onto that empty value funnels
// into node-addon-api's Error::New(napi_get_last_error_info) NAPI_FATAL_IF_FAILED
// sites — which are OUTSIDE the swallow valve — and aborts the process
// ("FATAL ERROR: Error::New napi_get_last_error_info"). Every coercion chain
// (`v.ToNumber().Int32Value()`, `v.ToString().Utf8Value()`, …) on a path
// reachable mid-terminate must go through these helpers: they check the input AND
// the coercion result and degrade to a zero value instead. On a LIVE env a
// successful napi call never yields an empty value, so behaviour is unchanged;
// the guards trip only on the swallowed-failure residue.
inline bool NodeGiToBool(Napi::Value v) {
  if (v.IsEmpty()) return false;
  Napi::Boolean b = v.ToBoolean();
  return b.IsEmpty() ? false : b.Value();
}
inline int32_t NodeGiToInt32(Napi::Value v) {
  if (v.IsEmpty()) return 0;
  Napi::Number n = v.ToNumber();
  return n.IsEmpty() ? 0 : n.Int32Value();
}
inline uint32_t NodeGiToUint32(Napi::Value v) {
  if (v.IsEmpty()) return 0;
  Napi::Number n = v.ToNumber();
  return n.IsEmpty() ? 0 : n.Uint32Value();
}
inline double NodeGiToDouble(Napi::Value v) {
  if (v.IsEmpty()) return 0;
  Napi::Number n = v.ToNumber();
  return n.IsEmpty() ? 0 : n.DoubleValue();
}
inline std::string NodeGiToUtf8(Napi::Value v) {
  if (v.IsEmpty()) return std::string();
  Napi::String s = v.ToString();
  return s.IsEmpty() ? std::string() : s.Utf8Value();
}

inline int64_t JsValueToInt64(Napi::Value v) {
  if (v.IsEmpty()) return 0;  // swallowed-failure residue (see helpers above)
  if (v.IsBigInt()) {
    bool lossless = false;
    return v.As<Napi::BigInt>().Int64Value(&lossless);
  }
  Napi::Number n = v.ToNumber();
  return n.IsEmpty() ? 0 : n.Int64Value();
}
inline uint64_t JsValueToUint64(Napi::Value v) {
  if (v.IsEmpty()) return 0;  // swallowed-failure residue (see helpers above)
  if (v.IsBigInt()) {
    bool lossless = false;
    return v.As<Napi::BigInt>().Uint64Value(&lossless);
  }
  Napi::Number n = v.ToNumber();
  return n.IsEmpty() ? 0 : static_cast<uint64_t>(n.Int64Value());
}

// OUT (WarnIfUnsafe{Int,Uint}64): GJS ALWAYS returns a JS Number for a 64-bit int
// (never a BigInt) and emits this g_warning when the value falls outside the range
// a double represents exactly (|v| > 2^53 - 1 == Number.MAX_SAFE_INTEGER), because
// the returned double may be rounded. Mirrors refs/gjs/gi/arg-inl.h:222-228 +
// js-value-inl.h:223-236, where max_safe_big_number == (1 << DBL_MANT_DIG) - 1 and
// DBL_MANT_DIG (std::numeric_limits<double>::digits) == 53. The message text is
// byte-for-byte GJS's so a warning-capturing consumer sees the identical string.
constexpr int64_t kMaxSafeJsInteger = (int64_t{1} << 53) - 1;  // 9007199254740991
inline void WarnIfUnsafeInt64(int64_t v) {
  if (v > kMaxSafeJsInteger || v < -kMaxSafeJsInteger)
    g_warning("Value %s cannot be safely stored in a JS Number and may be rounded",
              std::to_string(v).c_str());
}
inline void WarnIfUnsafeUint64(uint64_t v) {
  if (v > static_cast<uint64_t>(kMaxSafeJsInteger))
    g_warning("Value %s cannot be safely stored in a JS Number and may be rounded",
              std::to_string(v).c_str());
}

// ---- JS function -> GClosure IN-args ----------------------------------------
//
// A JS function passed for a `GObject.Closure`-typed IN parameter (e.g.
// g_signal_connect_closure, g_source_set_closure, GIMarshallingTests.gclosure_in,
// g_dbus_connection_register_object_with_closures2) is marshalled as a REAL
// GClosure whose marshal converts the invocation's GValue params to JS, calls the
// function, and writes the JS return into the return GValue — mirroring GJS's
// Gjs::Closure::create_marshaled "boxed" closures (refs/gjs/gi/arg-cache.cpp
// GClosureInTransferNone::in + gi/closure.cpp). Lifetime follows gjs exactly:
// the closure is ref'd + sunk at marshal time; a transfer-none arg drops that ref
// after the invoke (the callee keeps its own if it stored the closure), a
// transfer-full arg leaves it with the callee. Closures created during an invoke
// are recorded here so calls.cc can release them on the right path.
struct CreatedClosures {
  std::vector<GClosure*> transferNone;  // unref after the invoke (gjs BoxedInTransferNone::release)
  std::vector<GClosure*> transferFull;  // callee adopts; unref only when the callee never ran
};

// ---- JS bytes -> GBytes IN-args ----------------------------------------------
//
// A JS Uint8Array (or any TypedArray/DataView/ArrayBuffer) passed for a
// `GLib.Bytes`-typed IN parameter (e.g. GdkPixbuf.Pixbuf.new_from_bytes,
// g_compute_checksum_for_bytes) is COPIED into a fresh GBytes — exactly what GJS
// does (refs/gjs/gi/arg-cache.cpp GBytesIn::in → gjs_byte_array_get_bytes →
// g_bytes_new). Lifetime follows gjs: a transfer-none arg drops the fresh ref
// after the invoke (GBytesInTransferNone::release → g_boxed_free; a callee that
// kept the bytes holds its own ref), a transfer-full arg leaves the ref with the
// callee (GBytesIn::release skips via the ignore_release mark). GBytes created
// during an invoke are recorded here so calls.cc can release them on the right
// path (mirrors CreatedClosures).
struct CreatedBytes {
  std::vector<GBytes*> transferNone;  // unref after the invoke (callee borrowed/ref'd)
  std::vector<GBytes*> transferFull;  // callee adopts; unref only when the callee never ran
};

// A plain JS value handed to a `GObject.Value` IN-arg is BOXED into a fresh
// GValue whose GType is guessed from the JS value — exactly what GJS does
// (refs/gjs/gi/arg-cache.cpp GValueIn::in → gjs_value_to_g_value, whose
// gjs_value_guess_g_type supplies the type for an uninitialized GValue). Without
// it, the single most common GObject call in existence —
// `obj.set_property('name', 0.5)`, whose second GI argument is a GValue — fails
// with "Unsupported interface IN argument", because a JS number is not a boxed
// handle. An existing GObject.Value boxed handle still routes through the
// boxed-handle path and is passed through untouched.
//
// Lifetime mirrors CreatedBytes: the box is freed after the invoke for
// transfer-none (the callee copied whatever it needed — g_object_set_property
// copies into the property), and left with the callee for transfer-full.
struct CreatedValues {
  std::vector<GValue*> transferNone;  // free after the invoke (callee borrowed)
  std::vector<GValue*> transferFull;  // callee adopts; free only when it never ran
};

// Release a GValue this layer boxed: unset the held value (dropping the ref an
// object/boxed/string GValue took) and free the struct. A plain `g_free` would
// leak whatever the GValue owns.
inline void NodeGiFreeBoxedGValue(GValue* gv) {
  if (gv == nullptr) return;
  if (G_IS_VALUE(gv)) g_value_unset(gv);
  g_free(gv);
}

// Build the (floating) marshaled GClosure for a JS function (signals.cc — shares
// the battle-tested JsClosure marshal/finalize machinery with `.connect()`).
GClosure* NodeGiMakeGenericJsClosure(Napi::Env env, Napi::Value fn);

// `ownedStrings` (optional): when a transfer-full string IN/INOUT arg is g_strdup'd
// here, the freshly-allocated pointer is appended so the caller can g_free it if the
// invoke never adopts it (an arg-marshal error before the call, or a failed invoke).
// nullptr (the default) → no tracking, for the vfunc-return / signal-arg callers.
// `closures` (optional): enables the JS-function→GClosure IN-arg marshalling above;
// nullptr (the default) keeps the previous behaviour (function → TypeError) on
// paths that cannot release a created closure.
// `bytes` (optional): enables the JS-bytes→GBytes IN-arg marshalling above;
// nullptr (the default) keeps the previous behaviour (typed array → TypeError) on
// paths that cannot release a created GBytes.
// `values` (optional): enables the JS-value→GValue IN-arg boxing above; nullptr
// (the default) keeps the previous behaviour (plain value → TypeError) on paths
// that cannot release a created GValue.
bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                    std::string* heldString,
                    GITransfer transfer = GI_TRANSFER_NOTHING,
                    std::vector<gpointer>* ownedStrings = nullptr,
                    CreatedClosures* closures = nullptr,
                    CreatedBytes* bytes = nullptr,
                    CreatedValues* values = nullptr);

// ---- IN container building -----------------------------------------
//
// Each built container is recorded so it can be freed after the invoke for
// TRANSFER_NOTHING (the callee borrowed it). TRANSFER_EVERYTHING/CONTAINER are
// adopted by the callee → never freed here.
struct InContainer {
  GITypeInfo* type;  // ref'd; unref'd in FreeInContainer
  gpointer ptr;
  GITransfer transfer;
  long count;  // element count (to free C-array strings)
};

bool IsSupportedContainerType(GITypeInfo* type, std::string* why);
// Whether `type` is a supported OUT/INOUT marshalling type (fundamentals, strings,
// object/interface/enum/flags, struct/boxed/union, and containers). Shared by the
// function-invoke path (calls.cc) and the vfunc chain-up path (class.cc).
bool IsSupportedOutType(GITypeInfo* type, std::string* why);
size_t CElementSize(GITypeInfo* elem);
void WriteLengthValue(GITypeInfo* lenType, GIArgument* slot, long n);
Napi::Value ReadOutOrReturn(Napi::Env env, GICallableInfo* callable, GITypeInfo* ti,
                            GIArgument* arg, GITransfer transfer,
                            std::vector<GIArgument>* slots);
void FreeInContainer(const InContainer& c);
bool JsToInContainer(Napi::Env env, Napi::Value v, GITypeInfo* type, GITransfer transfer,
                     gpointer* outPtr, long* outCount,
                     std::vector<InContainer>* containers);

extern std::atomic<napi_env> g_owner_env;
extern std::atomic<bool> g_toggle_shutdown;
extern std::recursive_mutex g_queue_mutex;
extern napi_threadsafe_function g_drain_tsfn;
extern bool g_drain_async_inited;

// ---- env-teardown safety (toggle.cc) ----------------------------------------
//
// True iff `env` may enter JS right now. Probes napi_strict_equals(undef, undef)
// — NAPI_PREAMBLE-gated upstream (refs/node src/js_native_api_v8.cc), so it fails
// with napi_pending_exception / napi_cannot_run_js exactly when the env must not
// run JS: after node::FreeEnvironment / Environment::ExitEnv set
// can_call_into_js=false (env teardown, worker.terminate()), or while a JS
// exception is pending. Side-effect-free and pure N-API (portable to Bun/Deno).
//
// Every C->JS re-entry that can fire OUTSIDE a JS-initiated frame (the drain
// TSFN callback, the vfunc/callback ffi trampolines, the signal closure marshal)
// MUST check this first and degrade to a no-op when false: a node-addon-api call
// that fails on a dead env escalates to Error::ThrowAsJavaScriptException, whose
// napi_throw fails the same way -> NAPI_FATAL_IF_FAILED -> process abort
// ("FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw").
bool NodeGiJsAvailable(napi_env env);

// Opt-in stderr tracing of the toggle/teardown machinery (env NODE_GI_TOGGLE_DEBUG,
// parsed once). Call sites guard with NodeGiToggleDebugEnabled() so argument
// evaluation costs nothing when off.
bool NodeGiToggleDebugEnabled();
void NodeGiToggleDebugLog(const char* fmt, ...) G_GNUC_PRINTF(1, 2);

Napi::Value MakeGObjectHandle(Napi::Env env, GObject* obj);
Napi::Value WrapGObject(Napi::Env env, GObject* obj, GITransfer transfer);

extern int g_syncEmitDepth;

// Nesting depth of loop-dispatched C->JS callbacks (the napi_make_callback sites
// in signals.cc / calls.cc / class.cc). Used to run the cross-runtime microtask
// checkpoint (NodeGiMaybeDrainMicrotasks) only at the OUTERMOST callback
// boundary — a nested dispatch (a handler re-entering the loop via a nested
// run()) defers draining to the outer boundary, exactly as Node's nested
// InternalCallbackScopes and GJS's "drain when the last JS frame exits" do.
extern int g_loopDispatchDepth;

// Cross-runtime microtask checkpoint (Bun/Deno — see loop.cc). Invokes the
// runtime-native drain registered via setMicrotaskDrain after an outermost
// loop-dispatched callback returns; a no-op on Node (never registered), with a
// pending JS exception, or when re-entered.
void NodeGiMaybeDrainMicrotasks(napi_env env);

bool SurfacePendingException(napi_env env, const char* context);
void ThrowGError(Napi::Env env, GError* error, const std::string& context);

// Forward declaration: JsToGValue (below) marshals object/boxed-typed property
// values, which need to unwrap a node-gi GObject handle; UnwrapGObject is defined
// further down (it shares the validation logic with the property/method paths).
GObject* UnwrapGObject(Napi::Env env, Napi::Value handle);

Napi::Value GValueToJs(Napi::Env env, const GValue* v);
bool JsToGValue(Napi::Env env, Napi::Value js, GValue* v);
Napi::Value ConstructGObject(Napi::Env env, GType gtype, Napi::Object props,
                             const std::string& displayName);

struct NodeGiSignalDef {
  std::string name;
  std::vector<GType> paramTypes;
  GType returnType;
  GSignalFlags flags;
};

struct NodeGiVFunc;  // defined in class.cc (registerClass vfunc overrides)

// ---- Gtk.Widget composite-template API (resolved via dlsym, no GTK link) ----
//
// The engine links only girepository-2.0; GTK is dlopen'd at runtime by the
// typelib. The composite-template entry points are GtkWidgetClass / GtkWidget
// calls that take the klass pointer class_init already holds (set_template,
// bind_template_child_full) or a constructed instance (init_template,
// get_template_child) — they are not naturally reachable through the introspected
// method-invoke paths, so they are resolved by symbol from the already-loaded
// libgtk-4. All argument types are plain GLib/GObject types (GBytes, GType,
// GObject, gpointer for the opaque GtkWidgetClass/GtkWidget), so no GTK headers
// are needed. Self-contained to the template feature; nothing else dlopens GTK.
struct GtkTemplateApi {
  void (*set_template)(gpointer widget_class, GBytes* template_bytes);
  void (*set_template_from_resource)(gpointer widget_class, const char* resource_name);
  void (*bind_template_child_full)(gpointer widget_class, const char* name, gboolean internal,
                                   gssize struct_offset);
  void (*set_css_name)(gpointer widget_class, const char* name);
  void (*init_template)(gpointer widget);
  GObject* (*get_template_child)(gpointer widget, GType widget_type, const char* name);
  // Template-callback dispatch (`<signal handler="…">`): a custom GtkBuilderScope
  // is set on the class so GtkBuilder resolves any handler name to the instance's
  // JS method (mirrors GJS's TemplateBuilderScope). set_template_scope installs it;
  // builder_get_current_object yields the widget being built (the handler `this`);
  // builder_scope_get_type is the interface GType our scope subtype implements.
  void (*set_template_scope)(gpointer widget_class, gpointer scope);
  GObject* (*builder_get_current_object)(gpointer builder);
  GType (*builder_scope_get_type)(void);
  bool ok;
};

const GtkTemplateApi* GetGtkTemplateApi();

// Per-registered-type metadata, passed as GTypeInfo.class_data → class_init.
// Heap-allocated and intentionally never freed (a GType is process-permanent).
struct NodeGiClassData {
  std::vector<GParamSpec*> properties;  // ownership transfers to the class on install
  std::vector<NodeGiSignalDef> signals;
  std::vector<NodeGiVFunc*> vfuncs;  // class-lifetime vfunc overrides (never freed)
  void (*parentGet)(GObject*, guint, GValue*, GParamSpec*);
  void (*parentSet)(GObject*, guint, const GValue*, GParamSpec*);
  // Gtk.Widget composite template (when registerClass meta carried a Template).
  bool hasTemplate = false;
  GBytes* templateBytes = nullptr;            // owned inline UI-XML (g_bytes_new copy)
  std::string templateResource;               // resource path (e.g. "/eu/app/win.ui")
  std::string cssName;                        // gtk_widget_class_set_css_name (optional)
  std::vector<std::string> children;          // public Children ids
  std::vector<std::string> internalChildren;  // InternalChildren ids
  // The generic template-callback scope set on the class (set_template_scope). Owned
  // for the class lifetime (process-permanent, like cd itself); its JS env qdata is
  // refreshed per construction so create_closure resolves handlers in the live env.
  GObject* templateScope = nullptr;
  // The napi_env this class was registered on. NodeGiConstructor (the overridden
  // GObjectClass `constructor` vfunc) has no user_data slot, so it reads the env to
  // call into JS from cd — correct even across worker envs (each registers its own
  // class, so the leaf's cd carries the right env).
  napi_env env = nullptr;

  // The cold `delete cd` failure paths (a bad GParamSpec, or g_type_register_static
  // returning 0) must not leak the owned inline-template GBytes. A destructor frees
  // it by construction → every `delete cd` path is covered. On the SUCCESS path cd
  // is stored as the type's qdata for the class lifetime and is NEVER deleted, so
  // this destructor does not run there and templateBytes stays alive for the
  // template install. (properties/vfuncs are released explicitly at the delete
  // sites — kept out of here to avoid double-freeing them.)
  ~NodeGiClassData() {
    if (templateBytes != nullptr) g_bytes_unref(templateBytes);
  }
};

NodeGiClassData* FindClassData(GType type);
GQuark NodeGiScopeEnvQuark();

// Forward declaration: ConstructGObject calls gtk_widget_init_template on a
// freshly-built widget whose registered type carries a Gtk.Widget template. The
// helper (and the NodeGiClassData/GtkTemplateApi it reads) is defined with the
// registerClass machinery further down; a no-op for any non-templated type. The
// env is threaded through so the per-construction JS env can be stamped on the
// template-callback scope before init_template builds (and connects) the tree.
struct NodeGiClassData;
void MaybeInitTemplate(Napi::Env env, GObject* obj);

// Forward declarations for the Gtk.Widget composite-template callback scope. The
// implementation lives further down (alongside the JsClosure signal machinery it
// reuses), but NodeGiClassInit installs the scope and MaybeInitTemplate refreshes
// its env, both above that point.
void NodeGiInstallTemplateScopeOnClass(NodeGiClassData* cd, gpointer g_class);

// A thread-local latch the node-gi JS-`new` path (ConstructGObject) raises around
// g_object_new_with_properties. NodeGiConstructor (the overridden GObjectClass
// `constructor` vfunc) reads it to tell a JS-driven construction — where the
// makeClass super-substitution runs the user ctor — apart from a C/GtkBuilder-driven
// one, where NodeGiConstructor must run the user ctor itself (see class.cc / gi.js).
bool NodeGiJsConstructing();
void NodeGiSetJsConstructing(bool v);

// ---- N-API entry points (registered in addon.cc's Init) ----

// repo.cc
Napi::Value RequireNamespace(const Napi::CallbackInfo& info);
Napi::Value ListInfoNames(const Napi::CallbackInfo& info);
Napi::Value FindInfo(const Napi::CallbackInfo& info);
Napi::Value GetConstantValue(const Napi::CallbackInfo& info);
Napi::Value GetEnumValues(const Napi::CallbackInfo& info);
Napi::Value GetErrorDomain(const Napi::CallbackInfo& info);
Napi::Value SetErrorBuilder(const Napi::CallbackInfo& info);
Napi::Value PrependSearchPath(const Napi::CallbackInfo& info);
Napi::Value PrependLibraryPath(const Napi::CallbackInfo& info);

// calls.cc
Napi::Value CallFunction(const Napi::CallbackInfo& info);
Napi::Value CallMethod(const Napi::CallbackInfo& info);
Napi::Value HasMethod(const Napi::CallbackInfo& info);
Napi::Value HasClassMethod(const Napi::CallbackInfo& info);
// The nearest ancestor GType carrying object introspection info (a concrete type
// may be private — GLocalFile); a new ref, or nullptr. Shared with object.cc so
// method dispatch and prototype lookup resolve to the same class.
GIObjectInfo* FindNearestObjectInfo(GIRepository* repo, GType gtype);
Napi::Value CallStaticMethod(const Napi::CallbackInfo& info);
// The `new <Struct>()` [[Construct]] path: route to the struct's 'new'
// constructor when it has one, else zero-allocate (GJS gi/boxed.cpp parity).
Napi::Value ConstructStruct(const Napi::CallbackInfo& info);
Napi::Value CallBoxedMethod(const Napi::CallbackInfo& info);
Napi::Value IsBoxedHandle(const Napi::CallbackInfo& info);
// Struct/boxed/union FIELD access (marshal.cc). boxedMemberKind(handle, name) →
// 0 (neither) | 1 (method) | 2 (field); getBoxedField(handle, name) → the field
// value; setBoxedField(handle, name, value) writes it.
Napi::Value BoxedMemberKind(const Napi::CallbackInfo& info);
Napi::Value GetBoxedField(const Napi::CallbackInfo& info);
Napi::Value SetBoxedField(const Napi::CallbackInfo& info);
Napi::Value BoxedTypeName(const Napi::CallbackInfo& info);
// GParamSpec wrapping (object.cc): a tagged GObject-fundamental handle plus its
// name/nick/blurb/flags/value_type/owner_type/default_value accessors.
Napi::Value MakeParamSpecHandle(Napi::Env env, GParamSpec* pspec, GITransfer transfer);
Napi::Value IsParamSpecHandle(const Napi::CallbackInfo& info);
Napi::Value ParamSpecProp(const Napi::CallbackInfo& info);

// Non-GObject GObject-fundamental wrapping (object.cc): a tagged External carrying
// the raw pointer + the introspected unref func, for fundamentals like
// GskRenderNode / GdkEvent that are introspected as object info but are NOT
// GObjects (their own ref/unref, G_IS_OBJECT false — see the object.cc comment).
Napi::Value MakeFundamentalHandle(Napi::Env env, gpointer ptr, GIObjectInfo* info, GITransfer transfer);
Napi::Value IsFundamentalHandle(const Napi::CallbackInfo& info);

// object.cc
Napi::Value NewObject(const Napi::CallbackInfo& info);
Napi::Value GetProperty(const Napi::CallbackInfo& info);
Napi::Value SetProperty(const Napi::CallbackInfo& info);
Napi::Value HasProperty(const Napi::CallbackInfo& info);
Napi::Value GetTypeName(const Napi::CallbackInfo& info);
Napi::Value ClassInfoForTypeName(const Napi::CallbackInfo& info);
Napi::Value GetGType(const Napi::CallbackInfo& info);
Napi::Value IsInstanceOf(const Napi::CallbackInfo& info);
Napi::Value IsGObjectHandle(const Napi::CallbackInfo& info);
Napi::Value NewGValue(const Napi::CallbackInfo& info);

// class.cc
Napi::Value RegisterClass(const Napi::CallbackInfo& info);
Napi::Value RegisterClassFromGType(const Napi::CallbackInfo& info);
Napi::Value ConstructType(const Napi::CallbackInfo& info);
Napi::Value CallParentVfunc(const Napi::CallbackInfo& info);
Napi::Value HasClassVfunc(const Napi::CallbackInfo& info);
Napi::Value CallClassVfunc(const Napi::CallbackInfo& info);
Napi::Value SetConstructCallback(const Napi::CallbackInfo& info);

// template.cc
Napi::Value GetTemplateChild(const Napi::CallbackInfo& info);

// toggle.cc (TEST-ONLY cross-thread GC stress)
Napi::Value StressRefUnrefOffThread(const Napi::CallbackInfo& info);
Napi::Value StressRefUnrefRunning(const Napi::CallbackInfo& info);
Napi::Value StressRefUnrefProgress(const Napi::CallbackInfo& info);
Napi::Value StressRefUnrefStop(const Napi::CallbackInfo& info);

// variant.cc
Napi::Value VariantNew(const Napi::CallbackInfo& info);
Napi::Value VariantUnpack(const Napi::CallbackInfo& info);
Napi::Value VariantGetTypeString(const Napi::CallbackInfo& info);
Napi::Value IsVariantHandle(const Napi::CallbackInfo& info);

// signals.cc
Napi::Value ConnectSignal(const Napi::CallbackInfo& info);
Napi::Value EmitSignal(const Napi::CallbackInfo& info);
Napi::Value DisconnectSignal(const Napi::CallbackInfo& info);
Napi::Value SetTemplateCallbackResolver(const Napi::CallbackInfo& info);

// private.cc — GjsPrivate-mirroring helpers (refs/gjs/libgjs-private/gjs-util.c).
// The structured-log writer func + the bind_property_full/bind_full transform
// trampolines, which need a C wrapper for the same reasons GJS uses GjsPrivate:
// the GLogWriterFunc can fire on ANY thread (JS only runs on the registration
// thread; other threads fall back to the default writer) and the GLogField array
// is not generically introspectable; the binding transform's `to_value` is a
// write-back OUT GValue no marshaled GClosure can reach.
Napi::Value LogSetWriterFunc(const Napi::CallbackInfo& info);
Napi::Value LogSetWriterDefault(const Napi::CallbackInfo& info);
Napi::Value BindPropertyFull(const Napi::CallbackInfo& info);
Napi::Value BindingGroupBindFull(const Napi::CallbackInfo& info);

// loop.cc
Napi::Value StartMainLoop(const Napi::CallbackInfo& info);
Napi::Value IterateMainContext(const Napi::CallbackInfo& info);
Napi::Value MainContextHasPending(const Napi::CallbackInfo& info);
// Factory for an Int32Array(1) view over the JS-armed-work counter (see
// loop.cc) — lets the L1 pump answer "does the program own GLib work?" WITHOUT
// a napi call. Lazy (a factory, not an Init-time export): the @gjsify/napi shim
// loud-stubs napi_create_external_arraybuffer and never arms the pump.
Napi::Value MakePumpPendingCount(const Napi::CallbackInfo& info);
Napi::Value PumpKick(const Napi::CallbackInfo& info);
Napi::Value SetMicrotaskDrain(const Napi::CallbackInfo& info);

// ---- uv-driven GLib auto-pump (loop.cc) -------------------------------------
//
// In-flight scope=async keep-alive: while a GI scope=async callback (e.g. a
// GAsyncReadyCallback) is pending, the pump holds a libuv ref so a plain Node
// script survives until the completion dispatches (the top-level-await case).
// The counter itself is runtime-independent (Bun/Deno's portable pump reads it
// via MainContextHasPending); only the libuv ref is Node-only. Begin returns
// whether the callback was counted (false only for a foreign env, i.e. a worker
// thread once Node's main env owns the pump); the caller must call End exactly
// once for each counted callback. Main-thread only.
bool NodeGiPumpAsyncBegin(napi_env env);
void NodeGiPumpAsyncEnd();
// Close the pump's uv handles at env teardown (no-op for non-owner envs).
void NodeGiPumpShutdown(napi_env env);

// RAII window for every C→JS dispatch (the GI callback trampoline, the signal
// closure marshal, a vfunc invocation). The pump holds g_in_uv_pump while it
// iterates the context so the uv-in-GLib UvLoopSource stays parked (no reentrant
// uv_run out of the pump's own uv callbacks) — but JS dispatched FROM that
// iteration, including every microtask continuation napi_make_callback runs at
// its boundary, must not inherit the flag: user code there may legitimately
// start a blocking GLib.MainLoop.run(), which needs the UvLoopSource co-pump
// live (Node timers keep firing during the run). Clears the flag on entry,
// restores it on scope exit — mirroring SyncEmitDepthReset.
class NodeGiPumpJsDispatchScope {
 public:
  NodeGiPumpJsDispatchScope();
  ~NodeGiPumpJsDispatchScope();
  NodeGiPumpJsDispatchScope(const NodeGiPumpJsDispatchScope&) = delete;
  NodeGiPumpJsDispatchScope& operator=(const NodeGiPumpJsDispatchScope&) = delete;

 private:
  gboolean saved_;
};

}  // namespace nodegi

#endif  // NODE_GI_SRC_COMMON_H_
