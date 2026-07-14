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

#include <dlfcn.h>  // dlopen/dlsym the GtkWidgetClass template API (no GTK link)
#include <napi.h>
#include <uv.h>

#include <girepository/girepository.h>
#include <girepository/girffi.h>  // gi_callable_info_create_closure + ffi_cif
#include <glib-object.h>
#include <glib.h>

#include <atomic>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

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
};

extern const napi_type_tag kBoxedHandleTag;
extern const napi_type_tag kGObjectHandleTag;

// `info` (optional): the struct/union GIBaseInfo backing the handle. When passed,
// MakeBoxedHandle takes its OWN ref (the caller keeps its own), unref'd on finalize.
Napi::Value MakeBoxedHandle(Napi::Env env, gpointer ptr, GType gtype, bool owns,
                            GIBaseInfo* info = nullptr);
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
inline int64_t JsValueToInt64(Napi::Value v) {
  if (v.IsBigInt()) {
    bool lossless = false;
    return v.As<Napi::BigInt>().Int64Value(&lossless);
  }
  return v.ToNumber().Int64Value();
}
inline uint64_t JsValueToUint64(Napi::Value v) {
  if (v.IsBigInt()) {
    bool lossless = false;
    return v.As<Napi::BigInt>().Uint64Value(&lossless);
  }
  return static_cast<uint64_t>(v.ToNumber().Int64Value());
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

// `ownedStrings` (optional): when a transfer-full string IN/INOUT arg is g_strdup'd
// here, the freshly-allocated pointer is appended so the caller can g_free it if the
// invoke never adopts it (an arg-marshal error before the call, or a failed invoke).
// nullptr (the default) → no tracking, for the vfunc-return / signal-arg callers.
bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                    std::string* heldString,
                    GITransfer transfer = GI_TRANSFER_NOTHING,
                    std::vector<gpointer>* ownedStrings = nullptr);

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

// calls.cc
Napi::Value CallFunction(const Napi::CallbackInfo& info);
Napi::Value CallMethod(const Napi::CallbackInfo& info);
Napi::Value CallStaticMethod(const Napi::CallbackInfo& info);
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

// object.cc
Napi::Value NewObject(const Napi::CallbackInfo& info);
Napi::Value GetProperty(const Napi::CallbackInfo& info);
Napi::Value SetProperty(const Napi::CallbackInfo& info);
Napi::Value HasProperty(const Napi::CallbackInfo& info);
Napi::Value GetTypeName(const Napi::CallbackInfo& info);
Napi::Value GetGType(const Napi::CallbackInfo& info);
Napi::Value IsInstanceOf(const Napi::CallbackInfo& info);
Napi::Value IsGObjectHandle(const Napi::CallbackInfo& info);

// class.cc
Napi::Value RegisterClass(const Napi::CallbackInfo& info);
Napi::Value RegisterClassFromGType(const Napi::CallbackInfo& info);
Napi::Value ConstructType(const Napi::CallbackInfo& info);
Napi::Value CallParentVfunc(const Napi::CallbackInfo& info);

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

// loop.cc
Napi::Value StartMainLoop(const Napi::CallbackInfo& info);
Napi::Value IterateMainContext(const Napi::CallbackInfo& info);

}  // namespace nodegi

#endif  // NODE_GI_SRC_COMMON_H_
