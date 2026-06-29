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

#include <dlfcn.h>  // dlopen/dlsym the GtkWidgetClass template API (no GTK link)
#include <napi.h>
#include <uv.h>

#include <girepository/girepository.h>
#include <girepository/girffi.h>  // gi_callable_info_create_closure + ffi_cif
#include <glib-object.h>
#include <glib.h>

#include <atomic>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

// Forward declaration: GetConstantValue (defined early, near the namespace
// helpers) marshals through GIArgumentToJs, whose definition lives further down
// with the rest of the value-marshalling boundary.
static Napi::Value GIArgumentToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                                  GITransfer transfer);

// gi_repository_dup_default() returns a new owning ref to the process-default
// GIRepository (lazily created). Callers must g_object_unref() it.
GIRepository* DupDefaultRepository() { return gi_repository_dup_default(); }

// Per-env state, stored in N-API instance data so each env (incl. a
// worker_threads worker) holds + derefs its OWN GLib.Error builder ref. A napi_ref
// is env-specific: keying it per-env (not a file-static slot shared across every
// env) removes both the cross-env clobber (last loader wins, prior envs lose the
// builder) AND the cross-env deref (env A reading env B's ref = UB). Created in
// Init, freed by the instance-data finalizer at env teardown.
struct NodeGiEnvData {
  napi_ref errorBuilder = nullptr;
};

static void NodeGiEnvDataFinalize(napi_env env, void* data, void* /*hint*/) {
  NodeGiEnvData* d = static_cast<NodeGiEnvData*>(data);
  if (d == nullptr) return;
  if (d->errorBuilder != nullptr) napi_delete_reference(env, d->errorBuilder);
  delete d;
}

// This env's instance data (created in Init); null only if Init's set failed.
static NodeGiEnvData* EnvData(napi_env env) {
  void* raw = nullptr;
  return napi_get_instance_data(env, &raw) == napi_ok ? static_cast<NodeGiEnvData*>(raw) : nullptr;
}

// requireNamespace(namespace: string, version?: string)
//   -> { namespace: string, version: string, infoCount: number }
//
// Mirrors the load step every GJS gi:// / imports.gi access performs:
// gi_repository_require() with an optional pinned version (null = let
// GIRepository resolve the system default), then read back the resolved
// version and the top-level info count.
Napi::Value RequireNamespace(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "requireNamespace(namespace: string, version?: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string ns = info[0].As<Napi::String>().Utf8Value();
  bool has_version = info.Length() >= 2 && info[1].IsString();
  std::string version = has_version ? info[1].As<Napi::String>().Utf8Value() : std::string();

  GIRepository* repo = DupDefaultRepository();
  GError* error = nullptr;
  GITypelib* typelib = gi_repository_require(
      repo, ns.c_str(), has_version ? version.c_str() : nullptr,
      GI_REPOSITORY_LOAD_FLAG_NONE, &error);

  if (typelib == nullptr) {
    std::string message = error != nullptr ? error->message : "unknown error";
    if (error != nullptr) g_error_free(error);
    g_object_unref(repo);
    Napi::Error::New(env, "Failed to require " + ns +
                              (has_version ? (" " + version) : "") + ": " + message)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  const char* resolved = gi_repository_get_version(repo, ns.c_str());
  unsigned int n_infos = gi_repository_get_n_infos(repo, ns.c_str());

  Napi::Object result = Napi::Object::New(env);
  result.Set("namespace", Napi::String::New(env, ns));
  result.Set("version", Napi::String::New(env, resolved != nullptr ? resolved : ""));
  result.Set("infoCount", Napi::Number::New(env, static_cast<double>(n_infos)));

  g_object_unref(repo);
  return result;
}

// listInfoNames(namespace: string) -> string[]
// Enumerates the top-level introspection infos of an already-required
// namespace. Proves gi_repository_get_info() + gi_base_info_get_name()/unref().
Napi::Value ListInfoNames(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "listInfoNames(namespace: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string ns = info[0].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  unsigned int n_infos = gi_repository_get_n_infos(repo, ns.c_str());

  Napi::Array names = Napi::Array::New(env, n_infos);
  for (unsigned int i = 0; i < n_infos; i++) {
    GIBaseInfo* base = gi_repository_get_info(repo, ns.c_str(), i);
    const char* name = gi_base_info_get_name(base);
    names.Set(i, Napi::String::New(env, name != nullptr ? name : ""));
    gi_base_info_unref(base);
  }

  g_object_unref(repo);
  return names;
}

// findInfo(namespace, name) -> { kind: string } | null
// Classify a top-level namespace member so the L1 wrapper knows whether to treat
// it as a constructible class, a callable function, an enum, a constant, etc.
// kind ∈ function|object|interface|struct|union|enum|flags|constant|callback|other.
Napi::Value FindInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "findInfo(namespace: string, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), name.c_str());
  if (base == nullptr) {
    g_object_unref(repo);
    return env.Null();
  }
  // Order matters: GIFlagsInfo derives from GIEnumInfo, so test flags first.
  const char* kind;
  if (GI_IS_FUNCTION_INFO(base)) {
    kind = "function";
  } else if (GI_IS_FLAGS_INFO(base)) {
    kind = "flags";
  } else if (GI_IS_ENUM_INFO(base)) {
    kind = "enum";
  } else if (GI_IS_OBJECT_INFO(base)) {
    kind = "object";
  } else if (GI_IS_INTERFACE_INFO(base)) {
    kind = "interface";
  } else if (GI_IS_STRUCT_INFO(base)) {
    kind = "struct";
  } else if (GI_IS_UNION_INFO(base)) {
    kind = "union";
  } else if (GI_IS_CONSTANT_INFO(base)) {
    kind = "constant";
  } else if (GI_IS_CALLBACK_INFO(base)) {
    kind = "callback";
  } else {
    kind = "other";
  }
  gi_base_info_unref(base);
  g_object_unref(repo);
  Napi::Object result = Napi::Object::New(env);
  result.Set("kind", Napi::String::New(env, kind));
  return result;
}

// getConstantValue(namespace, name) -> unknown
// Read a namespace-level GI constant (e.g. GLib.PRIORITY_DEFAULT) and marshal it
// to JS. The constant owns its storage, so we copy out (transfer NOTHING) then
// free it.
Napi::Value GetConstantValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "getConstantValue(namespace: string, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), name.c_str());
  if (base == nullptr || !GI_IS_CONSTANT_INFO(base)) {
    if (base != nullptr) gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + name + " is not a constant")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GIConstantInfo* ci = reinterpret_cast<GIConstantInfo*>(base);
  GIArgument arg;
  gi_constant_info_get_value(ci, &arg);
  GITypeInfo* ti = gi_constant_info_get_type_info(ci);
  // transfer NOTHING: GIArgumentToJs copies strings (Napi::String::New) rather
  // than g_free'ing them; gi_constant_info_free_value owns the release.
  Napi::Value result = GIArgumentToJs(env, ti, &arg, GI_TRANSFER_NOTHING);
  gi_constant_info_free_value(ci, &arg);
  gi_base_info_unref(ti);
  gi_base_info_unref(base);
  g_object_unref(repo);
  return result;
}

// getEnumValues(namespace, name) -> Record<string, number>
// Enumerate an enum/flags type's members as { rawGiName: int }. The L1 wrapper
// re-keys them GJS-style (UPPER_CASE, '-' -> '_').
Napi::Value GetEnumValues(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "getEnumValues(namespace: string, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), name.c_str());
  if (base == nullptr || !GI_IS_ENUM_INFO(base)) {
    if (base != nullptr) gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + name + " is not an enum or flags type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GIEnumInfo* ei = reinterpret_cast<GIEnumInfo*>(base);
  unsigned int n = gi_enum_info_get_n_values(ei);
  Napi::Object result = Napi::Object::New(env);
  for (unsigned int i = 0; i < n; i++) {
    GIValueInfo* vi = gi_enum_info_get_value(ei, i);
    const char* vname = gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(vi));
    int64_t val = gi_value_info_get_value(vi);
    result.Set(vname != nullptr ? vname : "", Napi::Number::New(env, static_cast<double>(val)));
    gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(vi));
  }
  gi_base_info_unref(base);
  g_object_unref(repo);
  return result;
}

// getErrorDomain(namespace, name) -> { name: string, quark: number } | null
// For an enum type registered as a GError domain (e.g. Gio.IOErrorEnum), report
// its domain quark name + numeric quark. L1 attaches these to the enum object so
// `error.matches(Gio.IOErrorEnum, code)` can resolve the enum to its domain.
// Returns null for a plain (non-error-domain) enum or a non-enum name.
Napi::Value GetErrorDomain(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "getErrorDomain(namespace: string, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), name.c_str());
  if (base == nullptr || !GI_IS_ENUM_INFO(base)) {
    if (base != nullptr) gi_base_info_unref(base);
    g_object_unref(repo);
    return env.Null();
  }
  const char* domain = gi_enum_info_get_error_domain(reinterpret_cast<GIEnumInfo*>(base));
  Napi::Value result = env.Null();
  if (domain != nullptr) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, domain));
    obj.Set("quark", Napi::Number::New(env, static_cast<double>(g_quark_from_string(domain))));
    result = obj;
  }
  gi_base_info_unref(base);
  g_object_unref(repo);
  return result;
}

// setErrorBuilder(builder: (domainName, domainQuark, code, message) => Error) -> void
// Register the L1 GLib.Error factory the engine calls when a GI invoke fails, so a
// failed sync call throws a real GLib.Error. Stored per-env (a napi_ref is env-
// specific; the throw path is gated on the same env).
Napi::Value SetErrorBuilder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "setErrorBuilder(builder: function)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr) return env.Undefined();  // instance data unavailable (Init failed)
  if (d->errorBuilder != nullptr) {
    napi_delete_reference(env, d->errorBuilder);
    d->errorBuilder = nullptr;
  }
  napi_create_reference(env, info[0], 1, &d->errorBuilder);
  return env.Undefined();
}

// prependSearchPath(path: string) -> void
// Lets a caller add a typelib search directory before requiring (the Node twin
// of GIRepository.prepend_search_path(); needed for non-system typelibs).
Napi::Value PrependSearchPath(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "prependSearchPath(path: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  gi_repository_prepend_search_path(repo, path.c_str());
  g_object_unref(repo);
  return env.Undefined();
}

// ---- value marshalling (milestone 1: primitives + strings) ----
//
// The minimal GIArgument <-> JS boundary. This is the seam node-gtk's value.cc
// fills out exhaustively; here it covers the numeric + string + boolean tags so
// real GI function calls work end to end. Compound tags (ARRAY/INTERFACE/GLIST/
// GHASH/…) and OUT/INOUT directions land with the GObject + full-marshalling
// drops.

// Marshal a JS value into a GIArgument for an IN argument of `type`.
// `heldString` keeps UTF-8 storage alive for the duration of the call.
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
};

static const napi_type_tag kBoxedHandleTag = {0x6d2f8c4b1a9e7350ULL,
                                              0xb7e1d3a5c9f08264ULL};

static Napi::Value MakeBoxedHandle(Napi::Env env, gpointer ptr, GType gtype, bool owns) {
  BoxedHandle* bh = new BoxedHandle{ptr, gtype, owns};
  Napi::External<BoxedHandle> ext =
      Napi::External<BoxedHandle>::New(env, bh, [](Napi::Env, BoxedHandle* h) {
        if (h->owns && h->ptr != nullptr && h->gtype != G_TYPE_INVALID) {
          // GVariant is a fundamental (NOT a boxed) GType, so it cannot go
          // through g_boxed_free — it is reference-counted via g_variant_unref.
          // (GLib.Variant flows through this handle so it reuses the boxed
          // method-resolution + IN-arg-unwrap path; only the free differs.)
          if (h->gtype == G_TYPE_VARIANT) {
            g_variant_unref(static_cast<GVariant*>(h->ptr));
          } else if (G_TYPE_IS_BOXED(h->gtype)) {
            g_boxed_free(h->gtype, h->ptr);
          }
        }
        delete h;
      });
  ext.TypeTag(&kBoxedHandleTag);
  return ext;
}

// Wrap a GVariant pointer as a node-gi boxed handle tagged with G_TYPE_VARIANT.
// GVariant is a fundamental ref-counted (de)floating type, so ownership differs
// from g_boxed types: TAKE the handed ref on transfer-full (sinking a floating
// one), else add our own ref on a borrow. The finalizer (MakeBoxedHandle) drops
// exactly the one ref we end up owning via g_variant_unref. The L1 layer turns
// this handle into a GLib.Variant wrapper (deepUnpack/unpack/recursiveUnpack/…).
static Napi::Value WrapVariant(Napi::Env env, GVariant* var, GITransfer transfer) {
  if (var == nullptr) return env.Null();
  if (transfer == GI_TRANSFER_EVERYTHING)
    g_variant_take_ref(var);
  else
    g_variant_ref_sink(var);
  return MakeBoxedHandle(env, var, G_TYPE_VARIANT, true);
}

// Wrap a returned struct/boxed pointer. `structInfo` is the GIStructInfo (or
// union info) for the static type; the runtime GType (if registered + boxed)
// drives ownership + later method resolution.
static Napi::Value WrapBoxed(Napi::Env env, gpointer ptr, GIBaseInfo* structInfo,
                             GITransfer transfer) {
  if (ptr == nullptr) return env.Null();
  GType gt = G_TYPE_INVALID;
  if (structInfo != nullptr && (GI_IS_STRUCT_INFO(structInfo) || GI_IS_UNION_INFO(structInfo))) {
    gt = gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(structInfo));
  }
  if (gt == G_TYPE_VARIANT) return WrapVariant(env, static_cast<GVariant*>(ptr), transfer);
  bool boxed = gt != G_TYPE_INVALID && gt != G_TYPE_NONE && G_TYPE_IS_BOXED(gt);
  bool owns = boxed && transfer == GI_TRANSFER_EVERYTHING;
  return MakeBoxedHandle(env, ptr, boxed ? gt : G_TYPE_INVALID, owns);
}

// Read a boxed handle (ptr + boxed GType) if `v` is one (tag-checked; no deref of
// ptr). Returns nullptr when `v` is not a node-gi boxed handle. The returned handle
// is owned by the External — never free it. Callers that need the GType (boxed
// type-safety checks before g_value_set_boxed / a struct IN arg) use this; the
// pointer-only TryGetBoxedPtr below is the thin wrapper for everyone else.
static BoxedHandle* TryGetBoxedHandle(Napi::Value v) {
  if (!v.IsExternal()) return nullptr;
  Napi::External<BoxedHandle> ext = v.As<Napi::External<BoxedHandle>>();
  if (!ext.CheckTypeTag(&kBoxedHandleTag)) return nullptr;
  return ext.Data();
}

// Read a boxed handle's pointer if `v` is one (tag-checked; no deref of ptr).
static bool TryGetBoxedPtr(Napi::Value v, gpointer* out) {
  if (!v.IsExternal()) return false;
  Napi::External<BoxedHandle> ext = v.As<Napi::External<BoxedHandle>>();
  if (!ext.CheckTypeTag(&kBoxedHandleTag)) return false;
  BoxedHandle* h = ext.Data();
  *out = h != nullptr ? h->ptr : nullptr;
  return true;
}

// `ownedStrings` (optional): when a transfer-full string IN/INOUT arg is g_strdup'd
// here, the freshly-allocated pointer is appended so the caller can g_free it if the
// invoke never adopts it (an arg-marshal error before the call, or a failed invoke).
// nullptr (the default) → no tracking, for the vfunc-return / signal-arg callers.
static bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                           std::string* heldString,
                           GITransfer transfer = GI_TRANSFER_NOTHING,
                           std::vector<gpointer>* ownedStrings = nullptr) {
  GITypeTag tag = gi_type_info_get_tag(type);
  switch (tag) {
    case GI_TYPE_TAG_BOOLEAN: out->v_boolean = v.ToBoolean().Value(); return true;
    case GI_TYPE_TAG_INT8: out->v_int8 = static_cast<int8_t>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT8: out->v_uint8 = static_cast<uint8_t>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT16: out->v_int16 = static_cast<int16_t>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT16: out->v_uint16 = static_cast<uint16_t>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT32: out->v_int32 = v.ToNumber().Int32Value(); return true;
    case GI_TYPE_TAG_UINT32: out->v_uint32 = v.ToNumber().Uint32Value(); return true;
    case GI_TYPE_TAG_INT64: out->v_int64 = v.ToNumber().Int64Value(); return true;
    case GI_TYPE_TAG_UINT64: out->v_uint64 = static_cast<uint64_t>(v.ToNumber().Int64Value()); return true;
    case GI_TYPE_TAG_FLOAT: out->v_float = static_cast<float>(v.ToNumber().DoubleValue()); return true;
    case GI_TYPE_TAG_DOUBLE: out->v_double = v.ToNumber().DoubleValue(); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      if (v.IsNull() || v.IsUndefined()) {
        out->v_string = nullptr;
        return true;
      }
      if (transfer == GI_TRANSFER_EVERYTHING) {
        // The callee adopts the string and g_free's it. heldString points into a
        // std::string buffer (NOT g_malloc'd) → an invalid free. Hand over a
        // g_strdup'd copy the callee can legally free; we keep no reference. Track
        // it so a NON-adopting caller (error before / failed invoke) can free it.
        out->v_string = g_strdup(v.ToString().Utf8Value().c_str());
        if (ownedStrings != nullptr) ownedStrings->push_back(out->v_string);
      } else {
        *heldString = v.ToString().Utf8Value();
        out->v_string = const_cast<char*>(heldString->c_str());
      }
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      // Object/interface instances arrive as opaque External<GObject> handles;
      // enums/flags as plain numbers. Other interface kinds (structs/unions/
      // callbacks) follow with the full-marshalling drop.
      GIBaseInfo* iface = gi_type_info_get_interface(type);
      bool handled = false;
      if (iface != nullptr) {
        if (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface)) {
          if (v.IsNull() || v.IsUndefined()) {
            out->v_pointer = nullptr;
            handled = true;
          } else if (v.IsExternal()) {
            out->v_pointer = v.As<Napi::External<GObject>>().Data();
            handled = true;
          }
        } else if (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface)) {
          out->v_int = v.ToNumber().Int32Value();
          handled = true;
        } else if (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface)) {
          // Boxed/struct IN args arrive as boxed handles; null/undefined maps to
          // a NULL pointer (e.g. GLib.MainLoop.new(null, false)).
          if (v.IsNull() || v.IsUndefined()) {
            out->v_pointer = nullptr;
            handled = true;
          } else {
            BoxedHandle* h = TryGetBoxedHandle(v);
            if (h != nullptr) {
              // Type-safety: handing a wrong boxed handle's raw pointer to the
              // callee is undefined behaviour. Reject a mismatch with a clean
              // TypeError. Only checkable when BOTH the handle and the expected
              // struct carry a known registered GType (non-registered C structs are
              // G_TYPE_INVALID → no GType to compare, fall through as before).
              GType expected = gi_registered_type_info_get_g_type(
                  reinterpret_cast<GIRegisteredTypeInfo*>(iface));
              if (h->gtype != G_TYPE_INVALID && expected != G_TYPE_INVALID &&
                  expected != G_TYPE_NONE && !g_type_is_a(h->gtype, expected)) {
                gi_base_info_unref(iface);
                Napi::TypeError::New(env, std::string("expected a ") + g_type_name(expected) +
                                              " boxed handle, got " + g_type_name(h->gtype))
                    .ThrowAsJavaScriptException();
                return false;
              }
              out->v_pointer = h->ptr;
              handled = true;
            }
          }
        }
        gi_base_info_unref(iface);
      }
      if (!handled) {
        Napi::TypeError::New(
            env,
            "Unsupported interface IN argument (expected a GObject/boxed handle, enum or flags number)")
            .ThrowAsJavaScriptException();
        return false;
      }
      return true;
    }
    default:
      Napi::TypeError::New(
          env, "Unsupported IN argument type tag " + std::to_string(static_cast<int>(tag)) +
                   " (milestone 1 supports numbers, booleans and strings)")
          .ThrowAsJavaScriptException();
      return false;
  }
}

// A process-unique type tag distinguishing node-gi's GObject-instance Externals
// from other Externals (notably registerClass's GType handle). isGObjectHandle /
// UnwrapGObject validate against it WITHOUT dereferencing the pointer — a GType
// handle holds a small integer, not a valid GObject*, so a blind G_IS_OBJECT on
// it would segfault.
static const napi_type_tag kGObjectHandleTag = {0x9f3c1a7b5e2d4068ULL,
                                                0xa1b2c3d4e5f60718ULL};

// ====================================================================
// ---- toggle-ref instance GC bridge ---------------------------------
// ====================================================================
//
// Derivation: refs/node-gtk src/gobject.cc (romgrk et al., MIT, the #446/#439
// ownership fixes) + refs/gjs gi/{object.cpp,toggle.{h,cpp}} (the thread-safe
// ToggleQueue gold standard), ported to N-API. See scratchpad design doc.
//
// One canonical, type-tagged External per live GObject, cached on the GObject as
// qdata. The binding owns a SINGLE g_object_add_toggle_ref; the toggle-notify
// flips the cached External's napi_ref between STRONG (C also holds the object →
// rooted, survives GC) and WEAK (JS is the sole owner → collectable). This gives:
//   (a) wrapper IDENTITY — same GObject ⇒ same External ⇒ `===` + Map-key stable;
//   (b) collectability of reference cycles;
//   (c) resurrection — a GObject handed back from C re-wraps to a fresh wrapper
//       after its old one was collected, without clobbering a pending teardown.
//
// Crash-mode discipline (the three the design calls out):
//   1. N-API finalizers run OUTSIDE GC, but g_object_remove_toggle_ref can drive
//      dispose → synchronous signal emission → re-entrant JS, which is unsafe
//      from a finalizer / non-main thread. So the finalizer ONLY schedules a
//      g_idle_add teardown; ALL GObject teardown runs from that main-loop idle.
//   2. Toggle-up on a maybe-collected wrapper probes napi_get_reference_value;
//      empty ⇒ skip (a later WrapGObject resurrects). No during-GC flag dance is
//      needed — N-API finalizers are post-GC.
//   3. Cross-thread toggles + double-free: off-thread toggles are marshalled to
//      the JS thread via a mutex-guarded queue drained on the GLib main context;
//      a g_object_weak_ref safety net nulls the cached pointer if C finalizes the
//      object under us; the idle clears qdata only if it still points at THIS
//      wrapper (resurrection-safe); a shutdown flag disables toggles at teardown.

static GQuark NodeGiWrapperQuark() {
  static GQuark q = g_quark_from_static_string("node-gi::wrapper");
  return q;
}

struct NodeGiInstance {
  napi_env env;
  GObject* gobject;        // nulled by the weak-ref safety net if C finalizes it
  napi_ref handle_ref;     // ref to the canonical External; strong=rooted, weak=not
  bool rooted;             // true ⇒ handle_ref currently strong (mirrors node-gtk !dying)
  bool toggle_added;       // a toggle ref is currently installed
  bool teardown_queued;    // a finalizer already scheduled the idle teardown (dedupe)
};

// The single N-API env that OWNS the toggle machinery (qdata cache + global drain
// queues + drain async). Claimed by the FIRST env that wraps a GObject. A second
// env (a worker_threads Worker on another thread) must NOT touch this env's
// napi_refs (cross-env = UAF) nor its qdata cache / queues, so its wraps take the
// plain strong-ref path (no identity / GC-bridge, but safe). Atomic: read lock-free
// in MakeGObjectHandle, claimed once via compare_exchange there.
static std::atomic<napi_env> g_owner_env{nullptr};

// JS/main thread id of the owner env (captured at first wrap in EnsureDrainAsync).
// napi_reference_ref/unref are only valid there; off-thread toggles are queued +
// drained on the main context.
static std::thread::id g_main_thread_id;
static bool g_main_thread_id_set = false;
static bool OnMainThread() {
  return g_main_thread_id_set && std::this_thread::get_id() == g_main_thread_id;
}

// Set at env cleanup: ToggleNotify early-returns so no toggle touches a
// torn-down env (GJS's gjs_object_shutdown_toggle_queue equivalent).
static std::atomic<bool> g_toggle_shutdown{false};

// Deferred-work queues, drained on the JS thread by a libuv async handle.
//
// Why libuv, not g_idle_add: a GLib idle only runs while the GLib default context
// is iterated, which in pure Node usage (a script that never calls
// MainLoop.run / Application.run) NEVER happens → idle teardowns pile up and the
// GObjects leak. A uv_async fires whenever the libuv loop turns, which covers
// BOTH modes: plain Node (uv runs on its own) and a blocking GLib loop (the
// uv_source bridge below pumps uv_run(NOWAIT), which dispatches the async). The
// async is uv_unref'd so it never keeps the process alive on its own.
//
// Two queues share one mutex: TOGGLES (off-thread toggle-notifies marshalled to
// the JS thread — the rare GIO/GStreamer-worker path) and TEARDOWNS (wrappers
// whose External was finalized; the finalizer must not touch GObject directly).
struct ToggleItem {
  NodeGiInstance* inst;
  bool down;  // true = toggle-down (→ weak), false = toggle-up (→ strong)
};
// RECURSIVE (defensive, mirrors GJS's recursive ToggleQueue lock). The lock is held
// only across SHORT critical sections — never across RunTeardown's dispose → JS (the
// drain pops one item under the lock, RELEASES it, then processes; see DrainAsyncCb).
// So a reentrant SettleCollectedInstance / NodeGiToggleNotify fired from a dispose
// re-acquires the lock as a FRESH (non-nested) acquire today. Keeping it recursive
// guarantees that even if a future change widens a critical section a same-thread
// re-acquire can never self-deadlock; it does not weaken the no-lock-across-dispose
// invariant the liveness test enforces.
static std::recursive_mutex g_queue_mutex;
static std::deque<ToggleItem> g_toggle_queue;
static std::deque<NodeGiInstance*> g_teardown_queue;
static uv_async_t g_drain_async;
static bool g_drain_async_inited = false;
static napi_env g_async_env = nullptr;                 // captured for the drain callback
static napi_async_context g_async_context = nullptr;   // async context for the drain

static void DrainAsyncCb(uv_async_t*);
static void NodeGiToggleNotify(gpointer, GObject*, gboolean);
static void OnGObjectFinalized(gpointer, GObject*);

// Lazily init the drain async on the JS thread (the only legal thread for
// uv_async_init / napi_async_init). Called only by the OWNER env's MakeGObjectHandle
// (the multi-env gate runs first), so it runs serially on one thread — hence before
// any object exists, and before any toggle or teardown can be queued. The flag +
// g_async_* are read off-thread (WakeDrain), so they are written under g_queue_mutex.
static void EnsureDrainAsync(napi_env env) {
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    if (g_drain_async_inited) return;
  }
  uv_loop_t* loop = nullptr;
  if (napi_get_uv_event_loop(env, &loop) != napi_ok || loop == nullptr) return;
  if (uv_async_init(loop, &g_drain_async, DrainAsyncCb) != 0) return;
  uv_unref(reinterpret_cast<uv_handle_t*>(&g_drain_async));  // don't keep the loop alive
  // An async context so the drain — which re-enters JS via signal emission during
  // dispose (remove_toggle_ref → dispose → ::destroy) — runs in a valid N-API
  // callback scope, not a bare libuv callback (which lacks a V8 HandleScope).
  napi_value name = nullptr;
  napi_create_string_utf8(env, "node-gi:toggle-drain", NAPI_AUTO_LENGTH, &name);
  napi_async_context ctx = nullptr;
  napi_async_init(env, nullptr, name, &ctx);
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    g_async_env = env;
    g_async_context = ctx;
    // This env owns the machinery; its thread is the JS/main thread for toggles.
    g_main_thread_id = std::this_thread::get_id();
    g_main_thread_id_set = true;
    g_drain_async_inited = true;
  }
}

// Wake the JS-thread drain. Holds g_queue_mutex and re-checks both the init flag and
// the shutdown flag immediately before uv_async_send, paired with OnEnvShutdown's
// locked flag-flip-before-close — so an off-thread toggle can never uv_async_send a
// handle that is being / has been closed (the shutdown TOCTOU that aborted libuv).
static void WakeDrain() {
  std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
  if (g_drain_async_inited && !g_toggle_shutdown.load()) {
    uv_async_send(&g_drain_async);
  }
}

// Apply a toggle on the JS thread: flip the canonical napi_ref strong↔weak.
// Only flips on a real state transition (mirrors node-gtk's dying flag) and
// probes liveness before touching a possibly-collected handle (crash mode 2).
static void ApplyToggle(NodeGiInstance* inst, bool down) {
  if (down) {
    if (!inst->rooted) return;  // already weak
    napi_value v = nullptr;
    if (napi_get_reference_value(inst->env, inst->handle_ref, &v) == napi_ok && v != nullptr) {
      uint32_t r = 0;
      napi_reference_unref(inst->env, inst->handle_ref, &r);  // strong → weak
    }
    inst->rooted = false;
  } else {
    if (inst->rooted) return;  // already strong
    napi_value v = nullptr;
    if (napi_get_reference_value(inst->env, inst->handle_ref, &v) == napi_ok && v != nullptr) {
      uint32_t r = 0;
      napi_reference_ref(inst->env, inst->handle_ref, &r);  // weak → strong
      inst->rooted = true;
    }
    // empty ⇒ the wrapper was already collected; a later WrapGObject resurrects.
  }
}

// Run one wrapper's teardown on the JS thread: drop the toggle ref (may dispose →
// emit → re-enter JS — legal here, not in a finalizer/off-thread), resurrection-
// safely, then free the wrapper.
//
// ORDER MATTERS (node-gtk's GObjectTeardownIdle): remove_toggle_ref is LAST,
// because dropping the last ref can take refcount to 0 → dispose → finalize → the
// GObject is freed; any qdata/weak op after that would touch freed memory. So:
//   (1) under the queue lock: detach qdata (only if it still points at US —
//       resurrection-safe) AND cancel any queued off-thread toggles for this inst.
//       Both under the lock — paired with the off-thread enqueue path, which
//       re-reads qdata under the SAME lock — so a racing toggle either enqueues
//       then gets cancelled here, or sees the cleared qdata and never enqueues;
//       after this no NodeGiToggleNotify can find this inst.
//   (2) g_object_weak_unref (drop the safety net before the unref below).
//   (3) g_object_remove_toggle_ref LAST (may dispose → emit → re-enter JS, legal
//       here on the JS thread; the object may be freed afterwards).
static void RunTeardown(NodeGiInstance* inst) {
  GObject* obj = inst->gobject;  // null if the weak-ref net already fired
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    if (obj != nullptr && g_object_get_qdata(obj, NodeGiWrapperQuark()) == inst) {
      g_object_set_qdata(obj, NodeGiWrapperQuark(), nullptr);
    }
    for (auto it = g_toggle_queue.begin(); it != g_toggle_queue.end();) {
      it = (it->inst == inst) ? g_toggle_queue.erase(it) : it + 1;
    }
  }
  if (obj != nullptr) {
    g_object_weak_unref(obj, OnGObjectFinalized, inst);
    if (inst->toggle_added) g_object_remove_toggle_ref(obj, NodeGiToggleNotify, nullptr);
  }
  if (inst->handle_ref != nullptr) napi_delete_reference(inst->env, inst->handle_ref);
  delete inst;
}

// Drain both queues on the JS/main thread. Pop ONE item from the LIVE queue UNDER
// the lock, RELEASE the lock, then process it WITHOUT the lock; loop until empty.
//
// The lock must NOT be held across RunTeardown: it calls g_object_remove_toggle_ref
// → dispose → arbitrary JS (signal/vfunc). Holding a lock across reentrant user code
// (a) STALLS an off-thread NodeGiToggleNotify (which blocks acquiring g_queue_mutex)
// for the whole dispose — a priority inversion, not a "brief" block; and (b) risks an
// ABBA deadlock if a dispose vfunc synchronously waits on a worker thread that is
// itself blocked on g_queue_mutex. GJS likewise holds its ToggleQueue lock only
// across the rooting flip (== ApplyToggle), NEVER across remove_toggle_ref + dispose.
//
// The DEFECT-2 fix is preserved: the current item is removed from the LIVE queue
// UNDER the lock BEFORE release, so it is never double-processed; and a reentrant
// SettleCollectedInstance (same drain thread, fired from a dispose) re-acquires the
// lock and still sees + cancels the OTHER pending teardowns left in the live queue
// (a swap-then-process snapshot would hide them → double-free). Toggles drain first
// (FIFO); a toggle enqueued during a teardown's dispose is picked up on the next
// iteration. Terminates when both queues are empty.
static void DrainAsyncCb(uv_async_t*) {
  if (g_async_env == nullptr || g_toggle_shutdown.load()) return;
  Napi::Env env(g_async_env);
  // A HandleScope is mandatory: ApplyToggle's napi_get_reference_value and the
  // JS re-entry during teardown both create V8 handles, and a bare libuv callback
  // has no scope. The CallbackScope additionally establishes the async context so
  // signal emission during dispose runs as a proper N-API callback.
  Napi::HandleScope handleScope(env);
  Napi::CallbackScope callbackScope(env, g_async_context);

  while (true) {
    if (g_toggle_shutdown.load()) return;
    ToggleItem toggle{nullptr, false};
    NodeGiInstance* teardown = nullptr;
    {
      std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
      if (g_toggle_shutdown.load()) return;
      if (!g_toggle_queue.empty()) {            // toggles first (FIFO)
        toggle = g_toggle_queue.front();
        g_toggle_queue.pop_front();
      } else if (!g_teardown_queue.empty()) {
        teardown = g_teardown_queue.front();
        g_teardown_queue.pop_front();           // removed from the LIVE queue under the lock
      } else {
        return;                                  // both queues drained
      }
    }  // lock RELEASED before any processing — never held across dispose/JS
    if (toggle.inst != nullptr) {
      ApplyToggle(toggle.inst, toggle.down);     // napi-only, main-thread state, no reentry
    } else {
      RunTeardown(teardown);                      // dispose → JS, NO lock held
    }
  }
}

// Queue helpers — caller MUST hold g_queue_mutex. Mirror GJS ToggleQueue::is_queued
// + ToggleQueue::enqueue (refs/gjs gi/toggle.cpp): a main-thread toggle may apply
// directly ONLY when nothing is queued for the inst; otherwise it is enqueued, and
// an OPPOSITE-direction queued toggle CANCELS with the new one (both removed). That
// cancellation is what fixes the cross-thread wrong-flip / lost-toggle bug — a
// stale queued flip can never be applied after its inverse already happened.
static bool IsQueuedLocked(NodeGiInstance* inst) {
  for (const ToggleItem& item : g_toggle_queue)
    if (item.inst == inst) return true;
  return false;
}

// Returns true iff a toggle was actually left on the queue (→ caller wakes drain).
static bool EnqueueToggleLocked(NodeGiInstance* inst, bool down) {
  for (auto it = g_toggle_queue.begin(); it != g_toggle_queue.end(); ++it) {
    if (it->inst != inst) continue;
    if (it->down != down) {
      g_toggle_queue.erase(it);  // opposite direction queued → the two cancel
      return false;
    }
    return false;  // same direction already queued → dedupe (ApplyToggle is idempotent)
  }
  g_toggle_queue.push_back({inst, down});
  return true;
}

// The single toggle-notify for every node-gi GObject. Registered with data=NULL
// (fungible — node-gtk pattern): the live wrapper is found via qdata, so a stale
// teardown can remove ANY one toggle ref without orphaning a resurrected wrapper.
//
// ALL toggles route through the queue logic (GJS wrapped_gobj_toggle_notify): we
// apply directly ONLY on the main thread when NOTHING is queued for this inst;
// otherwise we enqueue (where opposite-direction toggles cancel). The qdata lookup
// + decision + direct-apply/enqueue are all done UNDER g_queue_mutex (GJS holds its
// ToggleQueue lock across the whole notify, including the direct apply) so an
// off-thread toggle cannot interleave between the is-queued check and the apply, and
// RunTeardown — which clears qdata under the SAME lock — can never be acted on after
// it has freed an inst.
static void NodeGiToggleNotify(gpointer /*data*/, GObject* obj, gboolean is_last_ref) {
  if (g_toggle_shutdown.load()) return;
  bool down = is_last_ref != FALSE;
  bool main_thread = OnMainThread();
  bool enqueued = false;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    if (g_toggle_shutdown.load()) return;  // re-check under the lock
    NodeGiInstance* inst =
        static_cast<NodeGiInstance*>(g_object_get_qdata(obj, NodeGiWrapperQuark()));
    if (inst == nullptr) return;
    if (main_thread && !IsQueuedLocked(inst)) {
      ApplyToggle(inst, down);  // direct apply, under the lock (as GJS does)
    } else {
      enqueued = EnqueueToggleLocked(inst, down);
    }
  }
  if (enqueued) WakeDrain();  // outside the lock
}

// Weak-ref safety net: if C finalizes the GObject while we still hold the toggle
// ref (defensive — a correct toggle ref prevents this), null the cached pointer
// so teardown never touches freed memory.
static void OnGObjectFinalized(gpointer data, GObject* /*where_the_object_was*/) {
  NodeGiInstance* inst = static_cast<NodeGiInstance*>(data);
  inst->gobject = nullptr;
}

// The canonical External's finalizer (napi_finalize, runs at a safe point post-GC
// but where re-entering GObject teardown is still unsafe). Do the MINIMUM: queue
// the teardown + wake the drain async (crash mode 1).
static void NodeGiInstanceFinalize(Napi::Env /*env*/, GObject* /*data*/, NodeGiInstance* inst) {
  if (inst == nullptr || inst->teardown_queued) return;
  inst->teardown_queued = true;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    // After shutdown nothing will drain, so don't grow the queue (the env is going
    // away; the inst leaks with it — same as a dropped pending teardown).
    if (g_toggle_shutdown.load()) return;
    g_teardown_queue.push_back(inst);
  }
  WakeDrain();
}

// Synchronously dispose a COLLECTED wrapper's binding state so a fresh wrapper can
// be built for the same GObject without ever installing a SECOND toggle ref on it.
// GLib suppresses toggle-notify while >=2 toggle refs exist, so a refcount change in
// the two-toggle-ref window would be LOST → the wrapper pinned/leaked (GJS keeps ONE
// toggle ref per GObject). The caller holds a construction ref on obj, so dropping
// the old toggle ref here cannot drive refcount to 0 / dispose. Main-thread only (==
// the drain thread), so the pending idle teardown cannot be running concurrently.
static void SettleCollectedInstance(GObject* obj, NodeGiInstance* old) {
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    // Cancel old's pending teardown + any queued toggles that reference it, so the
    // drain never touches a freed inst (paired with the off-thread enqueue, which
    // re-reads qdata under this SAME lock — and we clear qdata below).
    for (auto it = g_teardown_queue.begin(); it != g_teardown_queue.end();)
      it = (*it == old) ? g_teardown_queue.erase(it) : it + 1;
    for (auto it = g_toggle_queue.begin(); it != g_toggle_queue.end();)
      it = (it->inst == old) ? g_toggle_queue.erase(it) : it + 1;
    // Detach qdata only if it still points at old (resurrection-safe).
    if (g_object_get_qdata(obj, NodeGiWrapperQuark()) == old)
      g_object_set_qdata(obj, NodeGiWrapperQuark(), nullptr);
  }
  if (old->gobject != nullptr) {
    g_object_weak_unref(obj, OnGObjectFinalized, old);
    // Remove old's toggle ref BEFORE the fresh one is added below — never two at
    // once. We hold a construction ref, so this cannot dispose obj.
    if (old->toggle_added) g_object_remove_toggle_ref(obj, NodeGiToggleNotify, nullptr);
  }
  if (old->handle_ref != nullptr) napi_delete_reference(old->env, old->handle_ref);
  delete old;
}

// Cache-aware factory: the caller owns exactly ONE non-floating "construction"
// ref on obj. Returns the canonical External, establishing the toggle ref on a
// cache miss / resurrecting on a collected hit, or adopting + balancing the ref
// on a live hit.
static Napi::Value MakeGObjectHandle(Napi::Env env, GObject* obj) {
  // Multi-env (worker_threads) safety: claim / honour the toggle-machinery owner.
  // The FIRST env to wrap a GObject wins (compare_exchange under a concurrent race);
  // every later env that is NOT the owner takes the plain strong-ref path.
  napi_env owner = g_owner_env.load();
  if (owner == nullptr) {
    napi_env expected = nullptr;
    owner = g_owner_env.compare_exchange_strong(expected, static_cast<napi_env>(env))
                ? static_cast<napi_env>(env)
                : expected;
  }
  if (owner != static_cast<napi_env>(env)) {
    // A non-owner env must not touch the owner's napi_refs / qdata cache / queues
    // (cross-env napi = UAF). Give it a plain strong-ref handle: it adopts the
    // single construction ref and drops it in its OWN finalizer (correct
    // refcounting; any toggle the ref churn triggers is handled by the OWNER on the
    // owner thread). Trade-off: no wrapper identity / GC-bridge for worker envs — a
    // documented limitation, but no cross-env UAF.
    Napi::External<GObject> plain = Napi::External<GObject>::New(
        env, obj, [](Napi::Env, GObject* p) { g_object_unref(p); });
    plain.TypeTag(&kGObjectHandleTag);
    return plain;
  }

  EnsureDrainAsync(env);  // wire the JS-thread drain before any toggle/teardown can queue
  NodeGiInstance* existing =
      static_cast<NodeGiInstance*>(g_object_get_qdata(obj, NodeGiWrapperQuark()));
  if (existing != nullptr) {
    napi_value cached = nullptr;
    if (napi_get_reference_value(env, existing->handle_ref, &cached) == napi_ok &&
        cached != nullptr) {
      g_object_unref(obj);  // drop the surplus construction ref; toggle ref owns obj
      return Napi::Value(env, cached);
    }
    // Collected hit (wrapper GC'd, idle teardown still PENDING — the drain runs on
    // THIS thread, so it cannot have run concurrently). Settle the dead wrapper
    // synchronously first (drops its toggle ref while we hold the construction ref),
    // then build a fresh wrapper below — never two toggle refs on obj at once.
    SettleCollectedInstance(obj, existing);
  }

  NodeGiInstance* inst = new NodeGiInstance();
  inst->env = env;
  inst->gobject = obj;
  inst->rooted = true;
  inst->toggle_added = false;
  inst->teardown_queued = false;

  Napi::External<GObject> ext =
      Napi::External<GObject>::New(env, obj, NodeGiInstanceFinalize, inst);
  ext.TypeTag(&kGObjectHandleTag);
  napi_create_reference(env, ext, 1, &inst->handle_ref);  // start STRONG (node-gtk invariant)

  g_object_set_qdata(obj, NodeGiWrapperQuark(), inst);     // overwrite (resurrection-safe)
  g_object_weak_ref(obj, OnGObjectFinalized, inst);        // safety net
  g_object_add_toggle_ref(obj, NodeGiToggleNotify, nullptr);
  inst->toggle_added = true;
  // Drop the construction ref → only the toggle ref remains. If nothing else
  // holds obj (refcount 2→1) this fires toggle-down synchronously, flipping the
  // fresh wrapper to weak; if C holds another ref it stays strong (rooted).
  g_object_unref(obj);
  return ext;
}

// Wrap a borrowed/owned GObject pointer as the canonical node-gi handle. The
// cache lookup happens BEFORE any refcount change so a live hit causes no
// spurious toggle churn; only the miss/resurrect path takes a construction ref.
static Napi::Value WrapGObject(Napi::Env env, GObject* obj, GITransfer transfer) {
  if (obj == nullptr) return env.Null();

  NodeGiInstance* inst =
      static_cast<NodeGiInstance*>(g_object_get_qdata(obj, NodeGiWrapperQuark()));
  // Multi-env (worker_threads) safety: the qdata cache is process-global, but
  // inst->handle_ref is a napi_ref rooted in inst->env's isolate. ONLY that env may
  // dereference it — napi_get_reference_value with a FOREIGN env is a cross-env UAF /
  // V8 abort (e.g. a worker that obtains a process-shared singleton like
  // Gio.Vfs.get_default() that the owner env already wrapped). A non-owner env skips
  // the cache and takes the plain strong-ref path via MakeGObjectHandle (which gates
  // the same way). inst->env is immutable, so this guard is race-free regardless of
  // g_owner_env store ordering — MakeGObjectHandle's gate alone was NOT enough,
  // because this cache-hit fast path runs BEFORE MakeGObjectHandle.
  if (inst != nullptr && inst->env == static_cast<napi_env>(env)) {
    napi_value cached = nullptr;
    if (napi_get_reference_value(env, inst->handle_ref, &cached) == napi_ok && cached != nullptr) {
      // Identity hit: return the canonical External, balancing the transfer (we
      // already own obj via the toggle ref, so any ref the caller hands us is
      // surplus and must be dropped).
      if (g_object_is_floating(obj)) {
        g_object_ref_sink(obj);
        g_object_unref(obj);
      } else if (transfer == GI_TRANSFER_EVERYTHING) {
        g_object_unref(obj);
      }
      return Napi::Value(env, cached);
    }
    // collected hit (our env) → fall through and (re)build a fresh wrapper (resurrection).
  }

  // Miss / resurrect / cross-env share: own exactly one non-floating construction ref.
  if (g_object_is_floating(obj)) {
    g_object_ref_sink(obj);
  } else if (transfer == GI_TRANSFER_NOTHING) {
    g_object_ref(obj);
  }  // GI_TRANSFER_EVERYTHING (non-floating): the caller already gave us the ref.
  return MakeGObjectHandle(env, obj);
}

// Marshal a return-value GIArgument into a JS value, honouring transfer.
static Napi::Value GIArgumentToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                                  GITransfer transfer) {
  GITypeTag tag = gi_type_info_get_tag(type);
  switch (tag) {
    case GI_TYPE_TAG_VOID: return env.Undefined();
    case GI_TYPE_TAG_BOOLEAN: return Napi::Boolean::New(env, arg->v_boolean);
    case GI_TYPE_TAG_INT8: return Napi::Number::New(env, arg->v_int8);
    case GI_TYPE_TAG_UINT8: return Napi::Number::New(env, arg->v_uint8);
    case GI_TYPE_TAG_INT16: return Napi::Number::New(env, arg->v_int16);
    case GI_TYPE_TAG_UINT16: return Napi::Number::New(env, arg->v_uint16);
    case GI_TYPE_TAG_INT32: return Napi::Number::New(env, arg->v_int32);
    case GI_TYPE_TAG_UINT32: return Napi::Number::New(env, arg->v_uint32);
    case GI_TYPE_TAG_INT64: return Napi::Number::New(env, static_cast<double>(arg->v_int64));
    case GI_TYPE_TAG_UINT64: return Napi::Number::New(env, static_cast<double>(arg->v_uint64));
    case GI_TYPE_TAG_FLOAT: return Napi::Number::New(env, arg->v_float);
    case GI_TYPE_TAG_DOUBLE: return Napi::Number::New(env, arg->v_double);
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME: {
      if (arg->v_string == nullptr) return env.Null();
      Napi::Value str = Napi::String::New(env, arg->v_string);
      if (transfer == GI_TRANSFER_EVERYTHING) g_free(arg->v_string);
      return str;
    }
    case GI_TYPE_TAG_INTERFACE: {
      GIBaseInfo* iface = gi_type_info_get_interface(type);
      Napi::Value result;
      if (iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface))) {
        result = WrapGObject(env, static_cast<GObject*>(arg->v_pointer), transfer);
      } else if (iface != nullptr && (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface))) {
        result = Napi::Number::New(env, arg->v_int);
      } else if (iface != nullptr && (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface))) {
        result = WrapBoxed(env, arg->v_pointer, iface, transfer);
      } else {
        Napi::TypeError::New(
            env,
            "Unsupported interface return type (milestone: objects, interfaces, enums, flags, boxed)")
            .ThrowAsJavaScriptException();
        result = env.Undefined();
      }
      if (iface != nullptr) gi_base_info_unref(iface);
      return result;
    }
    default:
      Napi::TypeError::New(env, "Unsupported return type tag " +
                                    std::to_string(static_cast<int>(tag)) + " (milestone 1)")
          .ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// ====================================================================
// ---- array / GList / GSList / GHashTable / GStrv marshalling --------
// ====================================================================
//
// Compound container marshalling for IN, return, and OUT directions. Reference:
// refs/node-gtk src/{value,function}.cc (romgrk, MIT), retargeted to the
// girepository-2.0 API and the dense in_args/out_args layout this addon uses.
//
// SCOPE (the common cases real GJS code hits): C arrays + GStrv, GByteArray,
// GArray, GPtrArray (read), GList/GSList, GHashTable with string keys. Element
// types: utf8/filename (strings), the numeric fundamentals + boolean, and
// GObject/interface instances. EXOTIC combos (struct/union/enum/flags/nested-
// container elements, non-string hash keys, GArray/GPtrArray as IN, INOUT
// containers) are DEFERRED with a clear "<type> not yet supported" thrown BEFORE
// the invoke — mirroring the #652 IsSupportedOutType pattern.
//
// OWNERSHIP (the leak/UAF surface — scrutinise here):
//  * Returns / OUT (caller-owns per gi_arg_info_get_ownership_transfer /
//    gi_callable_info_get_caller_owns): TRANSFER_EVERYTHING frees both the
//    container AND its elements after the read (strings g_free'd, object refs
//    adopted by the JS wrapper); TRANSFER_CONTAINER frees only the container
//    (elements stay callee-owned); TRANSFER_NOTHING frees nothing.
//  * IN: TRANSFER_NOTHING means the callee borrows — we build the container,
//    pass it, and free it (container + any g_strdup'd strings) AFTER the invoke.
//    TRANSFER_EVERYTHING / TRANSFER_CONTAINER means the callee adopts what we
//    built — we must NOT free it (that would UAF / double-free).

// Element-type support shared by every container kind. *why receives a short
// label on refusal (so the caller can throw a precise deferral message).
static bool IsSupportedElementType(GITypeInfo* elem, std::string* why) {
  switch (gi_type_info_get_tag(elem)) {
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
      GIBaseInfo* iface = gi_type_info_get_interface(elem);
      bool ok = iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface));
      if (!ok && why != nullptr) *why = "struct/union/enum element";
      if (iface != nullptr) gi_base_info_unref(iface);
      return ok;
    }
    default:
      if (why != nullptr) *why = "nested-container element";
      return false;
  }
}

// Whether a container type (ARRAY/GLIST/GSLIST/GHASH) is marshallable. Used by
// IsSupportedOutType (OUT/return) and the IN path to defer the unsupported cases
// up front. Array-type kind is intentionally NOT restricted here — the read side
// (GIArrayToJs) handles C/BYTE_ARRAY/GArray/GPtrArray; the IN side rejects
// GArray/GPtrArray separately (they're rare as IN in headless GLib).
static bool IsSupportedContainerType(GITypeInfo* type, std::string* why) {
  switch (gi_type_info_get_tag(type)) {
    case GI_TYPE_TAG_ARRAY:
    case GI_TYPE_TAG_GLIST:
    case GI_TYPE_TAG_GSLIST: {
      GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
      if (elem == nullptr) {
        if (why != nullptr) *why = "untyped container";
        return false;
      }
      bool ok = IsSupportedElementType(elem, why);
      gi_base_info_unref(elem);
      return ok;
    }
    case GI_TYPE_TAG_GHASH: {
      GITypeInfo* kt = gi_type_info_get_param_type(type, 0);
      GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
      GITypeTag ktag = kt != nullptr ? gi_type_info_get_tag(kt) : GI_TYPE_TAG_VOID;
      bool kok = ktag == GI_TYPE_TAG_UTF8 || ktag == GI_TYPE_TAG_FILENAME;
      bool vok = vt != nullptr && IsSupportedElementType(vt, nullptr);
      if (!kok && why != nullptr) *why = "non-string GHashTable key";
      else if (!vok && why != nullptr) *why = "unsupported GHashTable value";
      if (kt != nullptr) gi_base_info_unref(kt);
      if (vt != nullptr) gi_base_info_unref(vt);
      return kok && vok;
    }
    default:
      if (why != nullptr) *why = "container";
      return false;
  }
}

// In-memory size of one C-array element. 0 for an unsupported element type.
static size_t CElementSize(GITypeInfo* elem) {
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN: return sizeof(gboolean);
    case GI_TYPE_TAG_INT8:
    case GI_TYPE_TAG_UINT8: return 1;
    case GI_TYPE_TAG_INT16:
    case GI_TYPE_TAG_UINT16: return 2;
    case GI_TYPE_TAG_INT32:
    case GI_TYPE_TAG_UINT32: return 4;
    case GI_TYPE_TAG_INT64:
    case GI_TYPE_TAG_UINT64: return 8;
    case GI_TYPE_TAG_FLOAT: return sizeof(gfloat);
    case GI_TYPE_TAG_DOUBLE: return sizeof(gdouble);
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
    case GI_TYPE_TAG_INTERFACE: return sizeof(gpointer);
    default: return 0;
  }
}

// Write the array's element count into a length arg's GIArgument slot (IN length
// autofill). The field is selected by the length arg's own tag; the slot is
// zero-initialised so writing the matching field is correct on little-endian
// (the only targets — Fedora x86_64/aarch64).
static void WriteLengthValue(GITypeInfo* lenType, GIArgument* slot, long n) {
  switch (gi_type_info_get_tag(lenType)) {
    case GI_TYPE_TAG_INT8: slot->v_int8 = static_cast<gint8>(n); break;
    case GI_TYPE_TAG_UINT8: slot->v_uint8 = static_cast<guint8>(n); break;
    case GI_TYPE_TAG_INT16: slot->v_int16 = static_cast<gint16>(n); break;
    case GI_TYPE_TAG_UINT16: slot->v_uint16 = static_cast<guint16>(n); break;
    case GI_TYPE_TAG_INT32: slot->v_int32 = static_cast<gint32>(n); break;
    case GI_TYPE_TAG_UINT32: slot->v_uint32 = static_cast<guint32>(n); break;
    case GI_TYPE_TAG_INT64: slot->v_int64 = static_cast<gint64>(n); break;
    case GI_TYPE_TAG_UINT64: slot->v_uint64 = static_cast<guint64>(n); break;
    default: slot->v_int64 = static_cast<gint64>(n); break;  // gsize/gtype: LE-safe
  }
}

// Read a length value the callee wrote into a length arg's slot (OUT length).
static long ReadLengthValue(GITypeInfo* lenType, GIArgument* slot) {
  switch (gi_type_info_get_tag(lenType)) {
    case GI_TYPE_TAG_INT8: return slot->v_int8;
    case GI_TYPE_TAG_UINT8: return slot->v_uint8;
    case GI_TYPE_TAG_INT16: return slot->v_int16;
    case GI_TYPE_TAG_UINT16: return slot->v_uint16;
    case GI_TYPE_TAG_INT32: return slot->v_int32;
    case GI_TYPE_TAG_UINT32: return static_cast<long>(slot->v_uint32);
    case GI_TYPE_TAG_INT64: return static_cast<long>(slot->v_int64);
    case GI_TYPE_TAG_UINT64: return static_cast<long>(slot->v_uint64);
    default: return static_cast<long>(slot->v_int64);  // gsize/gtype: LE-safe
  }
}

// Read one C-array element from raw storage into a JS value, honouring the
// per-element transfer (EVERYTHING frees strings / adopts object refs).
static Napi::Value ReadCElement(Napi::Env env, GITypeInfo* elem, const void* src,
                                GITransfer elemTransfer) {
  GIArgument a;
  memset(&a, 0, sizeof(a));
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN: a.v_boolean = *static_cast<const gboolean*>(src); break;
    case GI_TYPE_TAG_INT8: a.v_int8 = *static_cast<const gint8*>(src); break;
    case GI_TYPE_TAG_UINT8: a.v_uint8 = *static_cast<const guint8*>(src); break;
    case GI_TYPE_TAG_INT16: a.v_int16 = *static_cast<const gint16*>(src); break;
    case GI_TYPE_TAG_UINT16: a.v_uint16 = *static_cast<const guint16*>(src); break;
    case GI_TYPE_TAG_INT32: a.v_int32 = *static_cast<const gint32*>(src); break;
    case GI_TYPE_TAG_UINT32: a.v_uint32 = *static_cast<const guint32*>(src); break;
    case GI_TYPE_TAG_INT64: a.v_int64 = *static_cast<const gint64*>(src); break;
    case GI_TYPE_TAG_UINT64: a.v_uint64 = *static_cast<const guint64*>(src); break;
    case GI_TYPE_TAG_FLOAT: a.v_float = *static_cast<const gfloat*>(src); break;
    case GI_TYPE_TAG_DOUBLE: a.v_double = *static_cast<const gdouble*>(src); break;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME: a.v_string = *static_cast<char* const*>(src); break;
    case GI_TYPE_TAG_INTERFACE: a.v_pointer = *static_cast<gpointer const*>(src); break;
    default: return env.Undefined();
  }
  return GIArgumentToJs(env, elem, &a, elemTransfer);
}

// Free a read-side array container after marshalling out its elements. For
// TRANSFER_EVERYTHING the elements were already released per-element during the
// read; this frees the container itself. NOTHING frees nothing (callee owns).
static void FreeReadArrayContainer(gpointer container, GIArrayType at, GITransfer transfer) {
  if (container == nullptr || transfer == GI_TRANSFER_NOTHING) return;
  switch (at) {
    case GI_ARRAY_TYPE_C: g_free(container); break;
    case GI_ARRAY_TYPE_BYTE_ARRAY:
      // CONTAINER frees only the GByteArray wrapper (callee keeps the bytes);
      // EVERYTHING frees the segment too. Mirrors the GArray/GPtrArray cases.
      g_byte_array_free(static_cast<GByteArray*>(container), transfer == GI_TRANSFER_EVERYTHING);
      break;
    case GI_ARRAY_TYPE_ARRAY:
      g_array_free(static_cast<GArray*>(container), transfer == GI_TRANSFER_EVERYTHING);
      break;
    case GI_ARRAY_TYPE_PTR_ARRAY:
      g_ptr_array_free(static_cast<GPtrArray*>(container), transfer == GI_TRANSFER_EVERYTHING);
      break;
  }
}

// Marshal a C array / GStrv / GByteArray / GArray / GPtrArray into a JS value.
// `length` is the resolved element count (or -1 = derive from zero-terminated /
// fixed-size). guint8/gint8 arrays surface as a Node Buffer; everything else as
// a JS Array. Frees the container per `transfer`.
static Napi::Value GIArrayToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                               GITransfer transfer, long length) {
  GIArrayType at = gi_type_info_get_array_type(type);
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITypeTag etag = elem != nullptr ? gi_type_info_get_tag(elem) : GI_TYPE_TAG_VOID;
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
  gpointer container = arg->v_pointer;
  void* data = container;
  size_t elemSize = CElementSize(elem);
  bool isByte = etag == GI_TYPE_TAG_UINT8 || etag == GI_TYPE_TAG_INT8;

  // Resolve data + length for the boxed array kinds (their own struct carries it).
  if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
    GByteArray* ba = static_cast<GByteArray*>(container);
    data = ba != nullptr ? ba->data : nullptr;
    length = ba != nullptr ? static_cast<long>(ba->len) : 0;
    isByte = true;
    elemSize = 1;
  } else if (at == GI_ARRAY_TYPE_ARRAY) {
    GArray* ga = static_cast<GArray*>(container);
    data = ga != nullptr ? ga->data : nullptr;
    length = ga != nullptr ? static_cast<long>(ga->len) : 0;
    if (ga != nullptr) elemSize = g_array_get_element_size(ga);
  } else if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
    GPtrArray* pa = static_cast<GPtrArray*>(container);
    data = pa != nullptr ? pa->pdata : nullptr;
    length = pa != nullptr ? static_cast<long>(pa->len) : 0;
    elemSize = sizeof(gpointer);
  } else if (length < 0) {  // C array, length not given by a length arg
    if (gi_type_info_is_zero_terminated(type)) {
      length = 0;
      if (data != nullptr) {
        if (etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME ||
            etag == GI_TYPE_TAG_INTERFACE) {
          gpointer* p = static_cast<gpointer*>(data);
          while (p[length] != nullptr) length++;
        } else {  // numeric: scan for an all-zero element
          for (;; length++) {
            const char* e = static_cast<const char*>(data) + length * elemSize;
            bool zero = true;
            for (size_t b = 0; b < elemSize; b++)
              if (e[b] != 0) {
                zero = false;
                break;
              }
            if (zero) break;
          }
        }
      }
    } else {
      size_t fixed = 0;
      length = gi_type_info_get_array_fixed_size(type, &fixed) ? static_cast<long>(fixed) : 0;
    }
  }

  // Byte arrays → a Node Buffer (a Uint8Array subclass).
  if (isByte) {
    Napi::Value buf = (data == nullptr || length <= 0)
                          ? static_cast<Napi::Value>(Napi::Buffer<uint8_t>::New(env, 0))
                          : static_cast<Napi::Value>(Napi::Buffer<uint8_t>::Copy(
                                env, static_cast<const uint8_t*>(data), static_cast<size_t>(length)));
    FreeReadArrayContainer(container, at, transfer);
    if (elem != nullptr) gi_base_info_unref(elem);
    return buf;
  }

  Napi::Array out = Napi::Array::New(env, (data != nullptr && length > 0) ? length : 0);
  for (long i = 0; data != nullptr && i < length && !env.IsExceptionPending(); i++) {
    if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
      GIArgument a;
      memset(&a, 0, sizeof(a));
      a.v_pointer = static_cast<gpointer*>(data)[i];
      out.Set(static_cast<uint32_t>(i), GIArgumentToJs(env, elem, &a, elemTransfer));
    } else {
      out.Set(static_cast<uint32_t>(i),
              ReadCElement(env, elem, static_cast<const char*>(data) + i * elemSize, elemTransfer));
    }
  }
  FreeReadArrayContainer(container, at, transfer);
  if (elem != nullptr) gi_base_info_unref(elem);
  return out;
}

// Marshal a GList / GSList into a JS Array. Elements are unpacked from each
// node's data pointer via the introspection helper (strings/objects keep the
// pointer, fundamentals are GPOINTER_TO_INT-style unpacked). Frees the node
// chain (not the elements — those follow `transfer` per element) for
// EVERYTHING/CONTAINER.
static Napi::Value GListToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                             GITransfer transfer, bool isSList) {
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
  Napi::Array out = Napi::Array::New(env);
  uint32_t i = 0;
  if (!isSList) {
    for (GList* l = static_cast<GList*>(arg->v_pointer); l != nullptr && !env.IsExceptionPending();
         l = l->next) {
      GIArgument a;
      gi_type_info_argument_from_hash_pointer(elem, l->data, &a);
      out.Set(i++, GIArgumentToJs(env, elem, &a, elemTransfer));
    }
  } else {
    for (GSList* l = static_cast<GSList*>(arg->v_pointer); l != nullptr && !env.IsExceptionPending();
         l = l->next) {
      GIArgument a;
      gi_type_info_argument_from_hash_pointer(elem, l->data, &a);
      out.Set(i++, GIArgumentToJs(env, elem, &a, elemTransfer));
    }
  }
  if (transfer == GI_TRANSFER_EVERYTHING || transfer == GI_TRANSFER_CONTAINER) {
    if (!isSList) g_list_free(static_cast<GList*>(arg->v_pointer));
    else g_slist_free(static_cast<GSList*>(arg->v_pointer));
  }
  if (elem != nullptr) gi_base_info_unref(elem);
  return out;
}

// Marshal a GHashTable into a plain JS object (string keys). Keys + values are
// read with TRANSFER_NOTHING (copied / ref'd) because, for an owned table, the
// table's own GDestroyNotify funcs free the originals when we g_hash_table_unref
// below — freeing here too would double-free.
static Napi::Value GHashToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                             GITransfer transfer) {
  GHashTable* ht = static_cast<GHashTable*>(arg->v_pointer);
  Napi::Object out = Napi::Object::New(env);
  if (ht != nullptr) {
    GITypeInfo* kt = gi_type_info_get_param_type(type, 0);
    GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
    GHashTableIter it;
    gpointer k = nullptr;
    gpointer v = nullptr;
    g_hash_table_iter_init(&it, ht);
    while (g_hash_table_iter_next(&it, &k, &v) && !env.IsExceptionPending()) {
      GIArgument ka;
      GIArgument va;
      gi_type_info_argument_from_hash_pointer(kt, k, &ka);
      gi_type_info_argument_from_hash_pointer(vt, v, &va);
      Napi::Value key = GIArgumentToJs(env, kt, &ka, GI_TRANSFER_NOTHING);
      Napi::Value value = GIArgumentToJs(env, vt, &va, GI_TRANSFER_NOTHING);
      if (env.IsExceptionPending()) break;
      out.Set(key, value);
    }
    if (kt != nullptr) gi_base_info_unref(kt);
    if (vt != nullptr) gi_base_info_unref(vt);
  }
  if (ht != nullptr && (transfer == GI_TRANSFER_EVERYTHING || transfer == GI_TRANSFER_CONTAINER)) {
    // CONTAINER transfers the table but NOT its keys/values (callee keeps them).
    // g_hash_table_unref would run the key/value destroy-notifiers → over-free,
    // so steal the entries first; the unref then frees only the table itself.
    // EVERYTHING keeps the destroy-notifiers (we own keys + values). Mirrors the
    // C-array / GList CONTAINER handling that frees only the container.
    if (transfer == GI_TRANSFER_CONTAINER) g_hash_table_steal_all(ht);
    g_hash_table_unref(ht);
  }
  return out;
}

// Dispatch a return / OUT GIArgument to the right reader. `slots` lets an array
// resolve its length from the (already-populated) length arg slot. Scalars fall
// through to GIArgumentToJs.
static Napi::Value ReadOutOrReturn(Napi::Env env, GICallableInfo* callable, GITypeInfo* ti,
                                   GIArgument* arg, GITransfer transfer,
                                   std::vector<GIArgument>* slots) {
  switch (gi_type_info_get_tag(ti)) {
    case GI_TYPE_TAG_ARRAY: {
      long len = -1;
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(ti, &L) && slots != nullptr && L < slots->size()) {
        GIArgInfo* la = gi_callable_info_get_arg(callable, L);
        GITypeInfo* lt = gi_arg_info_get_type_info(la);
        len = ReadLengthValue(lt, &(*slots)[L]);
        gi_base_info_unref(lt);
        gi_base_info_unref(la);
      }
      return GIArrayToJs(env, ti, arg, transfer, len);
    }
    case GI_TYPE_TAG_GLIST: return GListToJs(env, ti, arg, transfer, false);
    case GI_TYPE_TAG_GSLIST: return GListToJs(env, ti, arg, transfer, true);
    case GI_TYPE_TAG_GHASH: return GHashToJs(env, ti, arg, transfer);
    default: return GIArgumentToJs(env, ti, arg, transfer);
  }
}

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

// Fill a GIArgument for a single list/hash element from a JS value. Strings are
// g_strdup'd (the container owns them); objects contribute their borrowed
// handle pointer. Throws + returns false on an unsupported element.
static bool ElementToGIArgument(Napi::Env env, GITypeInfo* elem, Napi::Value v, GIArgument* a) {
  memset(a, 0, sizeof(*a));
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN: a->v_boolean = v.ToBoolean().Value(); return true;
    case GI_TYPE_TAG_INT8: a->v_int8 = static_cast<gint8>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT8: a->v_uint8 = static_cast<guint8>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT16: a->v_int16 = static_cast<gint16>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT16: a->v_uint16 = static_cast<guint16>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT32: a->v_int32 = v.ToNumber().Int32Value(); return true;
    case GI_TYPE_TAG_UINT32: a->v_uint32 = v.ToNumber().Uint32Value(); return true;
    case GI_TYPE_TAG_INT64: a->v_int64 = v.ToNumber().Int64Value(); return true;
    case GI_TYPE_TAG_UINT64: a->v_uint64 = static_cast<guint64>(v.ToNumber().Int64Value()); return true;
    case GI_TYPE_TAG_FLOAT: a->v_float = static_cast<gfloat>(v.ToNumber().DoubleValue()); return true;
    case GI_TYPE_TAG_DOUBLE: a->v_double = v.ToNumber().DoubleValue(); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      a->v_string = (v.IsNull() || v.IsUndefined())
                        ? nullptr
                        : g_strdup(v.ToString().Utf8Value().c_str());
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      if (v.IsNull() || v.IsUndefined()) {
        a->v_pointer = nullptr;
        return true;
      }
      if (v.IsExternal() && v.As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag)) {
        a->v_pointer = v.As<Napi::External<GObject>>().Data();
        return true;
      }
      Napi::TypeError::New(env, "expected a GObject handle as a container element")
          .ThrowAsJavaScriptException();
      return false;
    }
    default:
      Napi::TypeError::New(env, "unsupported container element type")
          .ThrowAsJavaScriptException();
      return false;
  }
}

// Build a C array / GStrv / GByteArray from a JS value. *outCount = element
// count (for the IN length autofill + later free). GArray/GPtrArray IN are
// deferred. Throws + returns false on refusal (BEFORE the invoke).
static bool JsToCArray(Napi::Env env, Napi::Value v, GITypeInfo* type, gpointer* outPtr,
                       long* outCount) {
  GIArrayType at = gi_type_info_get_array_type(type);
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITypeTag etag = gi_type_info_get_tag(elem);
  bool zt = gi_type_info_is_zero_terminated(type);
  size_t elemSize = CElementSize(elem);
  bool isByte = etag == GI_TYPE_TAG_UINT8 || etag == GI_TYPE_TAG_INT8;
  *outPtr = nullptr;
  *outCount = 0;

  // Raw bytes from a TypedArray / Buffer (Uint8Array round-trips, etc.).
  const uint8_t* rawBytes = nullptr;
  size_t rawLen = 0;
  if (v.IsBuffer()) {
    Napi::Buffer<uint8_t> b = v.As<Napi::Buffer<uint8_t>>();
    rawBytes = b.Data();
    rawLen = b.Length();
  } else if (v.IsTypedArray()) {
    Napi::TypedArray ta = v.As<Napi::TypedArray>();
    rawBytes = static_cast<const uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
    rawLen = ta.ByteLength();
  }

  if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
    GByteArray* ba = g_byte_array_new();
    if (rawBytes != nullptr) {
      g_byte_array_append(ba, rawBytes, static_cast<guint>(rawLen));
      *outCount = static_cast<long>(rawLen);
    } else if (v.IsArray()) {
      Napi::Array arr = v.As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        guint8 byte = static_cast<guint8>(arr.Get(i).ToNumber().Uint32Value());
        g_byte_array_append(ba, &byte, 1);
      }
      *outCount = static_cast<long>(arr.Length());
    } else {
      g_byte_array_unref(ba);
      gi_base_info_unref(elem);
      Napi::TypeError::New(env, "expected an array or Uint8Array for the GByteArray argument")
          .ThrowAsJavaScriptException();
      return false;
    }
    *outPtr = ba;
    gi_base_info_unref(elem);
    return true;
  }

  if (at != GI_ARRAY_TYPE_C) {
    gi_base_info_unref(elem);
    Napi::TypeError::New(env, "GArray/GPtrArray IN parameters are not yet supported")
        .ThrowAsJavaScriptException();
    return false;
  }

  // Byte C array from a TypedArray / Buffer.
  if (isByte && rawBytes != nullptr) {
    void* buf = g_malloc0(elemSize * (rawLen + (zt ? 1 : 0)));
    memcpy(buf, rawBytes, rawLen);
    *outPtr = buf;
    *outCount = static_cast<long>(rawLen);
    gi_base_info_unref(elem);
    return true;
  }

  if (!v.IsArray()) {
    gi_base_info_unref(elem);
    Napi::TypeError::New(env, "expected an array for the array argument")
        .ThrowAsJavaScriptException();
    return false;
  }
  Napi::Array arr = v.As<Napi::Array>();
  long count = static_cast<long>(arr.Length());
  void* buf = g_malloc0(elemSize * (count + (zt ? 1 : 0)));
  bool ok = true;
  for (long i = 0; i < count && ok; i++) {
    GIArgument a;
    ok = ElementToGIArgument(env, elem, arr.Get(static_cast<uint32_t>(i)), &a);
    if (!ok) break;
    void* dst = static_cast<char*>(buf) + i * elemSize;
    // Copy the element's storage bytes (LE: the low elemSize bytes of the union
    // alias the active field — v_string/v_pointer for pointers, the scalar
    // otherwise).
    memcpy(dst, &a, elemSize);
  }
  if (!ok) {
    g_free(buf);  // partial g_strdup'd strings leak on this error path (pre-checked, rare)
    gi_base_info_unref(elem);
    return false;
  }
  *outPtr = buf;
  *outCount = count;
  gi_base_info_unref(elem);
  return true;
}

// Build a GList / GSList from a JS array.
static bool JsToGListLike(Napi::Env env, Napi::Value v, GITypeInfo* type, bool isSList,
                          gpointer* outPtr) {
  *outPtr = nullptr;
  if (!v.IsArray()) {
    Napi::TypeError::New(env, "expected an array for the list argument").ThrowAsJavaScriptException();
    return false;
  }
  Napi::Array arr = v.As<Napi::Array>();
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GList* glist = nullptr;
  GSList* gslist = nullptr;
  bool ok = true;
  for (uint32_t i = 0; i < arr.Length() && ok; i++) {
    GIArgument a;
    ok = ElementToGIArgument(env, elem, arr.Get(i), &a);
    if (!ok) break;
    gpointer p = gi_type_info_hash_pointer_from_argument(elem, &a);
    if (!isSList) glist = g_list_prepend(glist, p);
    else gslist = g_slist_prepend(gslist, p);
  }
  if (!isSList) *outPtr = g_list_reverse(glist);
  else *outPtr = g_slist_reverse(gslist);
  gi_base_info_unref(elem);
  return ok;
}

// Build a GHashTable (string keys) from a JS object. Value type ∈ {string,
// object}. Keys + (string) values are g_strdup'd and owned by the table.
static bool JsToGHashIn(Napi::Env env, Napi::Value v, GITypeInfo* type, gpointer* outPtr) {
  *outPtr = nullptr;
  if (!v.IsObject() || v.IsArray()) {
    Napi::TypeError::New(env, "expected an object for the GHashTable argument")
        .ThrowAsJavaScriptException();
    return false;
  }
  GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
  GITypeTag vtag = gi_type_info_get_tag(vt);
  bool valueIsString = vtag == GI_TYPE_TAG_UTF8 || vtag == GI_TYPE_TAG_FILENAME;
  // String values get g_free'd by the table; borrowed object pointers do not.
  GHashTable* ht =
      g_hash_table_new_full(g_str_hash, g_str_equal, g_free, valueIsString ? g_free : nullptr);
  Napi::Object obj = v.As<Napi::Object>();
  Napi::Array keys = obj.GetPropertyNames();
  bool ok = true;
  for (uint32_t i = 0; i < keys.Length() && ok; i++) {
    Napi::Value key = keys.Get(i);
    std::string ks = key.ToString().Utf8Value();
    Napi::Value val = obj.Get(key);
    gpointer vp = nullptr;
    if (valueIsString) {
      vp = (val.IsNull() || val.IsUndefined()) ? nullptr : g_strdup(val.ToString().Utf8Value().c_str());
    } else {
      GIArgument a;
      ok = ElementToGIArgument(env, vt, val, &a);
      if (!ok) break;
      vp = a.v_pointer;
    }
    g_hash_table_insert(ht, g_strdup(ks.c_str()), vp);
  }
  *outPtr = ht;
  gi_base_info_unref(vt);
  return ok;
}

// Free an IN container after the invoke. Only TRANSFER_NOTHING is freed here —
// EVERYTHING/CONTAINER were adopted by the callee.
static void FreeInContainer(const InContainer& c) {
  if (c.ptr == nullptr || c.transfer != GI_TRANSFER_NOTHING) {
    gi_base_info_unref(c.type);
    return;
  }
  GITypeTag tag = gi_type_info_get_tag(c.type);
  if (tag == GI_TYPE_TAG_ARRAY) {
    GIArrayType at = gi_type_info_get_array_type(c.type);
    GITypeInfo* elem = gi_type_info_get_param_type(c.type, 0);
    GITypeTag etag = elem != nullptr ? gi_type_info_get_tag(elem) : GI_TYPE_TAG_VOID;
    if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
      g_byte_array_unref(static_cast<GByteArray*>(c.ptr));
    } else {  // C array
      if (etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME) {
        char** s = static_cast<char**>(c.ptr);
        if (gi_type_info_is_zero_terminated(c.type)) {
          g_strfreev(s);
        } else {
          for (long i = 0; i < c.count; i++) g_free(s[i]);
          g_free(s);
        }
      } else {
        g_free(c.ptr);
      }
    }
    if (elem != nullptr) gi_base_info_unref(elem);
  } else if (tag == GI_TYPE_TAG_GLIST || tag == GI_TYPE_TAG_GSLIST) {
    GITypeInfo* elem = gi_type_info_get_param_type(c.type, 0);
    GITypeTag etag = elem != nullptr ? gi_type_info_get_tag(elem) : GI_TYPE_TAG_VOID;
    bool freeStrings = etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME;
    if (tag == GI_TYPE_TAG_GLIST) {
      if (freeStrings)
        for (GList* l = static_cast<GList*>(c.ptr); l != nullptr; l = l->next) g_free(l->data);
      g_list_free(static_cast<GList*>(c.ptr));
    } else {
      if (freeStrings)
        for (GSList* l = static_cast<GSList*>(c.ptr); l != nullptr; l = l->next) g_free(l->data);
      g_slist_free(static_cast<GSList*>(c.ptr));
    }
    if (elem != nullptr) gi_base_info_unref(elem);
  } else if (tag == GI_TYPE_TAG_GHASH) {
    g_hash_table_unref(static_cast<GHashTable*>(c.ptr));  // destroy funcs free keys/values
  }
  gi_base_info_unref(c.type);
}

// Build any supported IN container from a JS value, recording cleanup. The
// container type must already have passed IsSupportedContainerType. Throws +
// returns false on refusal (BEFORE the invoke).
static bool JsToInContainer(Napi::Env env, Napi::Value v, GITypeInfo* type, GITransfer transfer,
                            gpointer* outPtr, long* outCount,
                            std::vector<InContainer>* containers) {
  GITypeTag tag = gi_type_info_get_tag(type);
  *outCount = 0;
  bool ok = false;
  if (tag == GI_TYPE_TAG_ARRAY) {
    ok = JsToCArray(env, v, type, outPtr, outCount);
  } else if (tag == GI_TYPE_TAG_GLIST || tag == GI_TYPE_TAG_GSLIST) {
    ok = JsToGListLike(env, v, type, tag == GI_TYPE_TAG_GSLIST, outPtr);
  } else if (tag == GI_TYPE_TAG_GHASH) {
    ok = JsToGHashIn(env, v, type, outPtr);
  }
  if (ok && *outPtr != nullptr) {
    containers->push_back(InContainer{
        reinterpret_cast<GITypeInfo*>(gi_base_info_ref(type)), *outPtr, transfer, *outCount});
  } else if (!ok && *outPtr != nullptr) {
    // An element conversion threw mid-build (JsToGListLike / JsToGHashIn still
    // published the partial container). It was never recorded for cleanup, so
    // the nodes (and any g_strdup'd keys/string values) would leak. Free it now
    // with NOTHING semantics — we still own all of it; the callee never saw it.
    InContainer partial{reinterpret_cast<GITypeInfo*>(gi_base_info_ref(type)), *outPtr,
                        GI_TRANSFER_NOTHING, *outCount};
    FreeInContainer(partial);  // unrefs the type ref taken above
    *outPtr = nullptr;
  }
  return ok;
}

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

// The ffi closure entry point: marshal C args -> JS, call the JS fn, marshal the
// JS return -> C. Runs on the main thread (the GLib loop the bridge pumps).
static void NodeGiCallbackTrampoline(ffi_cif* /*cif*/, void* result, void** args,
                                     gpointer user_data) {
  NodeGiCallback* cb = static_cast<NodeGiCallback*>(user_data);
  napi_env env = cb->env;
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);

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
  // A pending JS exception surfaces at the next N-API boundary (e.g. when the
  // blocking run() that pumped this callback returns).

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
// fundamentals (numbers/bool), strings (utf8/filename), and GObject/interface +
// enums/flags. Compound OUT types — arrays, GList/GSList/GHashTable, GError, and
// structs/unions (their own roadmap PR) — are deferred: they get a clear error
// rather than silent mis-handling. *why receives a short type label on refusal.
static bool IsSupportedOutType(GITypeInfo* type, std::string* why) {
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
      GIBaseInfo* iface = gi_type_info_get_interface(type);
      bool ok = iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface) ||
                                     GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface));
      if (!ok && why != nullptr) {
        *why = (iface != nullptr && (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface)))
                   ? "struct/union"
                   : "interface";
      }
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
static void ThrowGError(Napi::Env env, GError* error, const std::string& context) {
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
        // Caller-allocates is the compound-struct path (the callee fills storage
        // we provide); the supported OUT types here are all callee-set. Defer it.
        Napi::TypeError::New(
            env, displayName + ": caller-allocates OUT parameters are not yet supported")
            .ThrowAsJavaScriptException();
        ok = false;
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
  // A (skip)-annotated return is omitted from BOTH the count and the tuple — the
  // OUT params alone shape the result (mirrors GJS/node-gtk ShouldSkipReturn).
  if (gi_type_info_get_tag(return_type) != GI_TYPE_TAG_VOID &&
      !gi_callable_info_skip_return(callable)) {
    results.push_back(ReadOutOrReturn(env, callable, return_type, &retval, return_transfer, &slots));
  }
  gi_base_info_unref(return_type);

  for (unsigned int i = 0; i < n_args && !env.IsExceptionPending(); i++) {
    if (dirs[i] != GI_DIRECTION_OUT && dirs[i] != GI_DIRECTION_INOUT) continue;
    if (skip[i]) continue;  // an array length arg — surfaced via its array, not on its own
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    GITransfer transfer = gi_arg_info_get_ownership_transfer(ai);
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

// ---- GObject lifecycle + properties (milestone 1) ----
//
// Construct GObjects and read/write their properties. Ownership now flows through
// the toggle-ref instance GC bridge above: ConstructGObject hands its single
// construction ref to the cache-aware MakeGObjectHandle, which installs the
// canonical toggle ref (so the wrapper is collectable when JS is the sole owner,
// rooted when C also holds the object, and identity-stable + resurrectable).
//
// Instances are handed back as opaque Napi::External<GObject> handles; the
// ergonomic class/prototype surface is layered in the GJS-compat runtime.

// Forward declaration: JsToGValue (below) marshals object/boxed-typed property
// values, which need to unwrap a node-gi GObject handle; UnwrapGObject is defined
// further down (it shares the validation logic with the property/method paths).
static GObject* UnwrapGObject(Napi::Env env, Napi::Value handle);

// Forward declaration: ConstructGObject calls gtk_widget_init_template on a
// freshly-built widget whose registered type carries a Gtk.Widget template. The
// helper (and the NodeGiClassData/GtkTemplateApi it reads) is defined with the
// registerClass machinery further down; a no-op for any non-templated type.
static void MaybeInitTemplate(GObject* obj);

// Marshal a GValue into a JS value (fundamental types).
static Napi::Value GValueToJs(Napi::Env env, const GValue* v) {
  GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v));
  switch (ft) {
    case G_TYPE_BOOLEAN: return Napi::Boolean::New(env, g_value_get_boolean(v));
    case G_TYPE_CHAR: return Napi::Number::New(env, g_value_get_schar(v));
    case G_TYPE_UCHAR: return Napi::Number::New(env, g_value_get_uchar(v));
    case G_TYPE_INT: return Napi::Number::New(env, g_value_get_int(v));
    case G_TYPE_UINT: return Napi::Number::New(env, g_value_get_uint(v));
    case G_TYPE_LONG: return Napi::Number::New(env, static_cast<double>(g_value_get_long(v)));
    case G_TYPE_ULONG: return Napi::Number::New(env, static_cast<double>(g_value_get_ulong(v)));
    case G_TYPE_INT64: return Napi::Number::New(env, static_cast<double>(g_value_get_int64(v)));
    case G_TYPE_UINT64: return Napi::Number::New(env, static_cast<double>(g_value_get_uint64(v)));
    case G_TYPE_FLOAT: return Napi::Number::New(env, g_value_get_float(v));
    case G_TYPE_DOUBLE: return Napi::Number::New(env, g_value_get_double(v));
    case G_TYPE_ENUM: return Napi::Number::New(env, g_value_get_enum(v));
    case G_TYPE_FLAGS: return Napi::Number::New(env, g_value_get_flags(v));
    case G_TYPE_STRING: {
      const char* s = g_value_get_string(v);
      return s != nullptr ? Napi::Value(Napi::String::New(env, s)) : env.Null();
    }
    case G_TYPE_VARIANT: {
      // A GVariant-typed property (e.g. Gio.SimpleAction:state) or signal
      // parameter (Gio.SimpleAction::change-state). g_value_get_variant borrows
      // (transfer none) → wrap as a node-gi GLib.Variant handle (own a ref).
      GVariant* var = g_value_get_variant(v);
      if (var == nullptr) return env.Null();
      return WrapVariant(env, var, GI_TRANSFER_NOTHING);
    }
    case G_TYPE_OBJECT:
      // Signal/property object values are transfer-none borrows; WrapGObject refs.
      return WrapGObject(env, static_cast<GObject*>(g_value_get_object(v)), GI_TRANSFER_NOTHING);
    case G_TYPE_PARAM: {
      // GParamSpec (e.g. the `notify` signal argument) — surface the changed
      // property's name so a `notify` handler can read it.
      GParamSpec* p = g_value_get_param(v);
      if (p == nullptr) return env.Null();
      Napi::Object o = Napi::Object::New(env);
      o.Set("name", Napi::String::New(env, p->name));
      o.Set("valueType", Napi::String::New(env, g_type_name(p->value_type)));
      return o;
    }
    default:
      Napi::TypeError::New(env, std::string("Unsupported property GType ") +
                                    g_type_name(G_VALUE_TYPE(v)) + " (milestone 1: fundamentals only)")
          .ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// Marshal a JS value into an already-g_value_init'd GValue.
static bool JsToGValue(Napi::Env env, Napi::Value js, GValue* v) {
  GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v));
  switch (ft) {
    case G_TYPE_BOOLEAN: g_value_set_boolean(v, js.ToBoolean().Value()); return true;
    case G_TYPE_CHAR: g_value_set_schar(v, static_cast<gint8>(js.ToNumber().Int32Value())); return true;
    case G_TYPE_UCHAR: g_value_set_uchar(v, static_cast<guchar>(js.ToNumber().Uint32Value())); return true;
    case G_TYPE_INT: g_value_set_int(v, js.ToNumber().Int32Value()); return true;
    case G_TYPE_UINT: g_value_set_uint(v, js.ToNumber().Uint32Value()); return true;
    case G_TYPE_LONG: g_value_set_long(v, static_cast<glong>(js.ToNumber().Int64Value())); return true;
    case G_TYPE_ULONG: g_value_set_ulong(v, static_cast<gulong>(js.ToNumber().Int64Value())); return true;
    case G_TYPE_INT64: g_value_set_int64(v, js.ToNumber().Int64Value()); return true;
    case G_TYPE_UINT64: g_value_set_uint64(v, static_cast<guint64>(js.ToNumber().Int64Value())); return true;
    case G_TYPE_FLOAT: g_value_set_float(v, static_cast<float>(js.ToNumber().DoubleValue())); return true;
    case G_TYPE_DOUBLE: g_value_set_double(v, js.ToNumber().DoubleValue()); return true;
    case G_TYPE_ENUM: g_value_set_enum(v, js.ToNumber().Int32Value()); return true;
    case G_TYPE_FLAGS: g_value_set_flags(v, js.ToNumber().Uint32Value()); return true;
    case G_TYPE_STRING:
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_string(v, nullptr);
      } else {
        std::string s = js.ToString().Utf8Value();
        g_value_set_string(v, s.c_str());  // g_value_set_string copies
      }
      return true;
    case G_TYPE_VARIANT: {
      // A GLib.Variant handle (or null) into a GVariant-typed GValue.
      // g_value_set_variant refs (and sinks a floating ref); our handle keeps
      // its own ref, so no double-free.
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_variant(v, nullptr);
        return true;
      }
      gpointer p = nullptr;
      if (!TryGetBoxedPtr(js, &p) || p == nullptr) {
        Napi::TypeError::New(env, "expected a GLib.Variant for a GVariant value")
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_set_variant(v, static_cast<GVariant*>(p));
      return true;
    }
    case G_TYPE_OBJECT: {
      // An object-typed property (e.g. Gtk.ApplicationWindow:application,
      // Gtk.Widget:child, :transient-for, :model …). Mirrors GValueToJs's
      // G_TYPE_OBJECT case in the other direction: unwrap the node-gi GObject
      // handle and hand it to g_value_set_object, which takes its OWN ref (our
      // wrapper keeps its handle ref → no double-free). null/undefined clears it.
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_object(v, nullptr);
        return true;
      }
      GObject* obj = UnwrapGObject(env, js);
      if (obj == nullptr) return false;  // UnwrapGObject threw a TypeError
      // Type-safety: g_value_set_object only g_warning's on a type mismatch (then
      // sets NULL) — but that warning ABORTS under G_DEBUG=fatal-criticals. Pre-check
      // with g_type_is_a and throw a clean, catchable JS TypeError instead (#659).
      if (!g_type_is_a(G_OBJECT_TYPE(obj), G_VALUE_TYPE(v))) {
        Napi::TypeError::New(env, std::string("expected a ") + g_type_name(G_VALUE_TYPE(v)) +
                                      ", got " + g_type_name(G_OBJECT_TYPE(obj)))
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_set_object(v, obj);
      return true;
    }
    case G_TYPE_BOXED: {
      // A boxed-typed property (e.g. a GdkRGBA, Gtk.Border, …). g_value_set_boxed
      // COPIES the boxed payload, so handing it our handle's pointer is safe — the
      // handle retains ownership. null/undefined clears it.
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_boxed(v, nullptr);
        return true;
      }
      BoxedHandle* h = TryGetBoxedHandle(js);
      if (h == nullptr || h->ptr == nullptr) {
        Napi::TypeError::New(env, std::string("expected a boxed handle for a ") +
                                      g_type_name(G_VALUE_TYPE(v)) + " property")
            .ThrowAsJavaScriptException();
        return false;
      }
      // Type-safety: g_value_set_boxed blind-copies per the GValue's boxed GType, so
      // a wrong boxed handle is undefined behaviour (no GLib guard at all). Reject a
      // mismatch with a clean TypeError. Only checkable when the handle carries a
      // known boxed GType (non-registered C structs are G_TYPE_INVALID) (#659).
      if (h->gtype != G_TYPE_INVALID && !g_type_is_a(h->gtype, G_VALUE_TYPE(v))) {
        Napi::TypeError::New(env, std::string("expected a ") + g_type_name(G_VALUE_TYPE(v)) +
                                      " boxed handle, got " + g_type_name(h->gtype))
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_set_boxed(v, h->ptr);
      return true;
    }
    default:
      Napi::TypeError::New(env, std::string("Unsupported property GType ") +
                                    g_type_name(G_VALUE_TYPE(v)))
          .ThrowAsJavaScriptException();
      return false;
  }
}

static GObject* UnwrapGObject(Napi::Env env, Napi::Value handle) {
  // Tag-check before touching Data() — a GType handle (registerClass) is also an
  // External but holds a non-dereferenceable integer; G_IS_OBJECT on it crashes.
  if (!handle.IsExternal() ||
      !handle.As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag)) {
    Napi::TypeError::New(env, "expected a node-gi GObject handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  GObject* obj = handle.As<Napi::External<GObject>>().Data();
  if (obj == nullptr || !G_IS_OBJECT(obj)) {
    Napi::TypeError::New(env, "invalid GObject handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  return obj;
}

// Shared constructor core: realise the class, marshal `props` into a GValue
// vector against the type's (inherited) GParamSpecs, g_object_new_with_properties,
// and hand back an owned External<GObject>. Used by both newObject (resolve by
// namespace.typeName) and constructType (resolve by a registered GType handle).
static Napi::Value ConstructGObject(Napi::Env env, GType gtype, Napi::Object props,
                                    const std::string& displayName) {
  Napi::Array names = props.GetPropertyNames();
  guint n = names.Length();
  std::vector<GValue> values(n);  // zero-initialised == G_VALUE_INIT
  std::vector<std::string> nameStorage(n);
  std::vector<const char*> cnames(n);

  gpointer klass = g_type_class_ref(gtype);  // realises the class so pspecs exist
  guint initialised = 0;
  bool ok = true;
  for (guint i = 0; i < n; i++) {
    nameStorage[i] = names.Get(i).ToString().Utf8Value();
    GParamSpec* pspec =
        g_object_class_find_property(reinterpret_cast<GObjectClass*>(klass), nameStorage[i].c_str());
    if (pspec == nullptr) {
      Napi::TypeError::New(env, displayName + " has no property '" + nameStorage[i] + "'")
          .ThrowAsJavaScriptException();
      ok = false;
      break;
    }
    g_value_init(&values[i], pspec->value_type);
    initialised = i + 1;
    if (!JsToGValue(env, props.Get(nameStorage[i]), &values[i])) {
      ok = false;
      break;
    }
    cnames[i] = nameStorage[i].c_str();
  }

  GObject* obj = nullptr;
  if (ok) {
    obj = g_object_new_with_properties(gtype, n, cnames.data(), values.data());
  }
  for (guint j = 0; j < initialised; j++) g_value_unset(&values[j]);
  g_type_class_unref(klass);

  if (!ok) return env.Null();
  if (obj == nullptr) {
    Napi::Error::New(env, "Failed to construct " + displayName).ThrowAsJavaScriptException();
    return env.Null();
  }
  // Take a single strong, non-floating ref; the finalizer releases it.
  if (g_object_is_floating(obj)) {
    g_object_ref_sink(obj);
  }
  // Gtk.Widget composite template: instantiate the template tree on this
  // instance. The canonical GTK call is from instance_init; calling it here —
  // right after construction, before the wrapper reaches JS — is equivalent for a
  // templated leaf type (the widget is fully constructed; init_template builds the
  // declared children + binds them so get_template_child resolves). A no-op unless
  // the constructed type carries node-gi template data (defined below; forward-
  // declared above), so plain introspected construction (newObject) is untouched.
  MaybeInitTemplate(obj);
  return MakeGObjectHandle(env, obj);
}

// newObject(namespace, typeName, props?: Record<string, unknown>) -> External<GObject>
Napi::Value NewObject(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "newObject(namespace: string, typeName: string, props?: object)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string tn = info[1].As<Napi::String>().Utf8Value();
  Napi::Object props =
      (info.Length() >= 3 && info[2].IsObject()) ? info[2].As<Napi::Object>() : Napi::Object::New(env);

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  bool isObject = base != nullptr && GI_IS_OBJECT_INFO(base);
  GType gtype = isObject
                    ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
                    : G_TYPE_INVALID;
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  if (!isObject || gtype == G_TYPE_INVALID || gtype == G_TYPE_NONE) {
    Napi::TypeError::New(env, ns + "." + tn + " is not a constructible GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return ConstructGObject(env, gtype, props, ns + "." + tn);
}

// ---- subclassing (registerClass — minimal: subtype + construct) ----
//
// Register a new GObject subclass of `parentNamespace.parentTypeName` named
// `name`, inheriting the parent's class/instance layout. Supports custom
// properties + signals (installed in class_init — see below) and vfunc overrides.
// A dynamic subtype's instances are ordinary GObjects owned through the canonical
// toggle-ref bridge (so a JS-subclassed instance kept by C stays rooted, keeping
// its overridden-vfunc wrapper + JS state alive). Returns an opaque type handle
// (the GType) for constructType().

// GTypes are process-stable and never freed (static registration), so the
// handle carries no finalizer.
static GType UnwrapGType(Napi::Env env, Napi::Value v) {
  if (!v.IsExternal()) {
    Napi::TypeError::New(env, "expected a node-gi type handle from registerClass()")
        .ThrowAsJavaScriptException();
    return 0;
  }
  return reinterpret_cast<GType>(v.As<Napi::External<void>>().Data());
}

// ---- registerClass custom properties + signals (class_init) ----
//
// A registered subclass can declare custom GObject properties and signals.
// In class_init we install the GParamSpecs + override get/set_property (routing
// custom props to a per-instance value store) and g_signal_newv each signal.
// Inherited (introspected-parent) properties still flow through the parent's
// vfuncs — a property is "ours" iff its owner GType carries node-gi class-data.
// Backing the values with a per-instance store (not C struct fields) keeps a
// plain dynamic subtype's instances ordinary GObjects, owned through the
// canonical toggle-ref bridge above.

// Map a JS type-name to a GType (shared by property + signal specs).
static GType TypeNameToGType(const std::string& t) {
  if (t == "string" || t == "utf8") return G_TYPE_STRING;
  if (t == "boolean" || t == "bool") return G_TYPE_BOOLEAN;
  if (t == "int") return G_TYPE_INT;
  if (t == "uint") return G_TYPE_UINT;
  if (t == "int64") return G_TYPE_INT64;
  if (t == "uint64") return G_TYPE_UINT64;
  if (t == "double") return G_TYPE_DOUBLE;
  if (t == "float") return G_TYPE_FLOAT;
  if (t == "object") return G_TYPE_OBJECT;
  if (t == "void" || t == "none") return G_TYPE_NONE;
  return G_TYPE_INVALID;
}

// Build a floating GParamSpec from a JS spec `{ name, type, flags?, default?,
// minimum?, maximum? }`. Returns nullptr + sets *err on an unsupported type.
static GParamSpec* BuildParamSpec(Napi::Env env, Napi::Object spec, std::string* err) {
  if (!spec.Has("name") || !spec.Get("name").IsString()) {
    *err = "property requires a string 'name'";
    return nullptr;
  }
  std::string name = spec.Get("name").As<Napi::String>().Utf8Value();
  std::string type = (spec.Has("type") && spec.Get("type").IsString())
                         ? spec.Get("type").As<Napi::String>().Utf8Value()
                         : std::string("string");
  GParamFlags flags = (spec.Has("flags") && spec.Get("flags").IsNumber())
                          ? static_cast<GParamFlags>(spec.Get("flags").As<Napi::Number>().Int32Value())
                          : G_PARAM_READWRITE;
  Napi::Value def = spec.Get("default");
  bool hasMin = spec.Has("minimum") && spec.Get("minimum").IsNumber();
  bool hasMax = spec.Has("maximum") && spec.Get("maximum").IsNumber();
  double mn = hasMin ? spec.Get("minimum").As<Napi::Number>().DoubleValue() : 0;
  double mx = hasMax ? spec.Get("maximum").As<Napi::Number>().DoubleValue() : 0;
  const char* nm = name.c_str();

  if (type == "string" || type == "utf8") {
    std::string d = def.IsString() ? def.As<Napi::String>().Utf8Value() : std::string();
    return g_param_spec_string(nm, nm, nm, def.IsString() ? d.c_str() : nullptr, flags);
  }
  if (type == "boolean" || type == "bool") {
    gboolean d = def.IsBoolean() ? def.As<Napi::Boolean>().Value()
                                 : (def.IsNumber() ? def.ToBoolean().Value() : FALSE);
    return g_param_spec_boolean(nm, nm, nm, d, flags);
  }
  if (type == "int") {
    return g_param_spec_int(nm, nm, nm, hasMin ? static_cast<gint>(mn) : G_MININT,
                            hasMax ? static_cast<gint>(mx) : G_MAXINT,
                            def.IsNumber() ? def.As<Napi::Number>().Int32Value() : 0, flags);
  }
  if (type == "uint") {
    return g_param_spec_uint(nm, nm, nm, hasMin ? static_cast<guint>(mn) : 0,
                             hasMax ? static_cast<guint>(mx) : G_MAXUINT,
                             def.IsNumber() ? def.As<Napi::Number>().Uint32Value() : 0, flags);
  }
  if (type == "int64") {
    return g_param_spec_int64(nm, nm, nm, hasMin ? static_cast<gint64>(mn) : G_MININT64,
                              hasMax ? static_cast<gint64>(mx) : G_MAXINT64,
                              def.IsNumber() ? def.As<Napi::Number>().Int64Value() : 0, flags);
  }
  if (type == "uint64") {
    return g_param_spec_uint64(nm, nm, nm, hasMin ? static_cast<guint64>(mn) : 0,
                               hasMax ? static_cast<guint64>(mx) : G_MAXUINT64,
                               def.IsNumber() ? static_cast<guint64>(def.As<Napi::Number>().Int64Value())
                                              : 0,
                               flags);
  }
  if (type == "double") {
    return g_param_spec_double(nm, nm, nm, hasMin ? mn : -G_MAXDOUBLE, hasMax ? mx : G_MAXDOUBLE,
                               def.IsNumber() ? def.As<Napi::Number>().DoubleValue() : 0, flags);
  }
  if (type == "float") {
    return g_param_spec_float(nm, nm, nm, hasMin ? static_cast<gfloat>(mn) : -G_MAXFLOAT,
                              hasMax ? static_cast<gfloat>(mx) : G_MAXFLOAT,
                              def.IsNumber() ? static_cast<gfloat>(def.As<Napi::Number>().DoubleValue())
                                             : 0,
                              flags);
  }
  *err = "unsupported property type '" + type + "'";
  return nullptr;
}

struct NodeGiSignalDef {
  std::string name;
  std::vector<GType> paramTypes;
  GType returnType;
  GSignalFlags flags;
};

// ---- registerClass vfunc overrides (class-level refs; no toggle-ref) ----
//
// A registered subclass can override a parent GObject vfunc with a JS function.
// Each override is held by a per-CLASS record carrying a STRONG napi_ref to the
// JS impl plus the ffi closure written into the class vtable. Both live for the
// class lifetime and are NEVER freed — a GType is process-permanent, so this is
// the same ownership model as the signal class-handler (the override fn is
// class-level, not per-instance). The INSTANCE the trampoline passes as `this`
// goes through WrapGObject, so it resolves to the canonical toggle-ref wrapper —
// the same handle construct returns (and that vfunc `this` keeps that wrapper +
// its JS state alive while C owns a JS-subclassed instance).
//
// In class_init the vfunc info is resolved by walking the parent object-info
// chain (gi_object_info_find_vfunc), the vtable slot is located via the matching
// class-struct FIELD offset (gi_vfunc_info_get_offset is GI_UNKNOWN/0xFFFF for
// GObject's own vfuncs, so the GJS field-offset approach is authoritative), and
// the closure's native address is written into the class struct at that offset.
//
// CHAIN-UP: immediately BEFORE the trampoline address is written, the value
// currently in the vtable slot is captured in `parentPtr` — at class_init time
// the new type's class struct is a memcpy of the parent's, so the slot holds the
// parent's implementation (the C default, or a JS override further up the chain).
// That captured pointer is the `super.vfunc_<name>(...)` target: callParentVfunc
// ffi_call's it through `cif` (which already describes the exact instance+args→ret
// signature). Mirrors GJS's gi/object.cpp, where the introspected base's vfunc
// thunk calls the actual C parent vtable entry.
struct NodeGiVFunc {
  napi_env env;
  std::string name;
  napi_ref fn;           // strong ref to the JS impl (class lifetime; never freed)
  GIVFuncInfo* info;     // resolved vfunc info (owned; kept alive for the closure)
  ffi_cif cif;           // stable storage for the closure's cif (also used to call up)
  ffi_closure* closure;  // ffi closure (class lifetime; never freed)
  gpointer parentPtr;    // parent vtable fn captured pre-override (chain-up target)
};

// The ffi closure entry point invoked when C calls the overridden vfunc. For a
// method vfunc the ffi args are [instance, declared-arg-0, declared-arg-1, ...];
// the instance is passed as the JS receiver (`this`, GJS-faithful: vfunc impls
// are methods on the instance) and the declared args become the JS arguments.
// The return is marshalled into `result` exactly like NodeGiCallbackTrampoline.
static void NodeGiVFuncTrampoline(ffi_cif* /*cif*/, void* result, void** args,
                                  gpointer user_data) {
  NodeGiVFunc* vf = static_cast<NodeGiVFunc*>(user_data);
  napi_env env = vf->env;
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);

  GICallableInfo* ci = reinterpret_cast<GICallableInfo*>(vf->info);
  // args[0] is the instance; declared args follow at args[1..].
  Napi::Value recv = WrapGObject(
      napiEnv, static_cast<GObject*>(static_cast<GIArgument*>(args[0])->v_pointer),
      GI_TRANSFER_NOTHING);

  unsigned int n = gi_callable_info_get_n_args(ci);
  std::vector<napi_value> jsArgs;
  jsArgs.reserve(n);
  bool ok = true;
  for (unsigned int i = 0; i < n; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    Napi::Value v =
        GIArgumentToJs(napiEnv, ti, static_cast<GIArgument*>(args[i + 1]), GI_TRANSFER_NOTHING);
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
    if (napi_get_reference_value(env, vf->fn, &fn) == napi_ok && fn != nullptr) {
      napi_value ret = nullptr;
      // napi_make_callback drains nextTick/microtasks around the call; the
      // wrapped instance is the receiver (`this`).
      napi_status st =
          napi_make_callback(env, nullptr, recv, fn, jsArgs.size(), jsArgs.data(), &ret);
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
  // A pending JS exception surfaces at the next N-API boundary (e.g. when the
  // constructType / method call that triggered this vfunc returns).
}

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
  bool ok;
};

// Resolve the GTK template API once (C++11 function-local static init is
// thread-safe; node-gi calls these only on the main thread). dlopen with
// RTLD_NOLOAD first — requireGi('Gtk','4.0') already dlopened libgtk-4 via the
// typelib, so this just bumps the refcount; fall back to a plain dlopen so a
// caller that never required Gtk through the typelib still resolves the symbols.
static const GtkTemplateApi* GetGtkTemplateApi() {
  static GtkTemplateApi api = {};
  static bool initialised = false;
  if (initialised) return &api;
  initialised = true;
  void* lib = dlopen("libgtk-4.so.1", RTLD_LAZY | RTLD_NOLOAD);
  if (lib == nullptr) lib = dlopen("libgtk-4.so.1", RTLD_LAZY);
  if (lib == nullptr) return &api;  // api.ok stays false → callers warn + no-op
  api.set_template = reinterpret_cast<decltype(api.set_template)>(
      dlsym(lib, "gtk_widget_class_set_template"));
  api.set_template_from_resource = reinterpret_cast<decltype(api.set_template_from_resource)>(
      dlsym(lib, "gtk_widget_class_set_template_from_resource"));
  api.bind_template_child_full = reinterpret_cast<decltype(api.bind_template_child_full)>(
      dlsym(lib, "gtk_widget_class_bind_template_child_full"));
  api.set_css_name =
      reinterpret_cast<decltype(api.set_css_name)>(dlsym(lib, "gtk_widget_class_set_css_name"));
  api.init_template =
      reinterpret_cast<decltype(api.init_template)>(dlsym(lib, "gtk_widget_init_template"));
  api.get_template_child = reinterpret_cast<decltype(api.get_template_child)>(
      dlsym(lib, "gtk_widget_get_template_child"));
  api.ok = api.set_template != nullptr && api.set_template_from_resource != nullptr &&
           api.bind_template_child_full != nullptr && api.set_css_name != nullptr &&
           api.init_template != nullptr && api.get_template_child != nullptr;
  return &api;
}

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

static GQuark NodeGiClassDataQuark() {
  static GQuark q = g_quark_from_static_string("node-gi-class-data");
  return q;
}
static GQuark NodeGiInstancePropsQuark() {
  static GQuark q = g_quark_from_static_string("node-gi-instance-props");
  return q;
}

static void FreeStoredGValue(gpointer p) {
  GValue* v = static_cast<GValue*>(p);
  g_value_unset(v);
  g_free(v);
}

// Nearest ancestor (incl. self) carrying node-gi class-data.
static NodeGiClassData* FindClassData(GType type) {
  for (GType t = type; t != 0; t = g_type_parent(t)) {
    NodeGiClassData* cd = static_cast<NodeGiClassData*>(g_type_get_qdata(t, NodeGiClassDataQuark()));
    if (cd != nullptr) return cd;
  }
  return nullptr;
}

// Find the vfunc override record named `name` nearest the instance type — the one
// whose trampoline owns the vtable slot the override is running in. Walks the same
// ancestry as FindClassData but stops at the first class-data carrying a matching
// override, returning its captured parent pointer + signature for chain-up.
static NodeGiVFunc* FindVFuncRecord(GType type, const std::string& name) {
  for (GType t = type; t != 0; t = g_type_parent(t)) {
    NodeGiClassData* cd = static_cast<NodeGiClassData*>(g_type_get_qdata(t, NodeGiClassDataQuark()));
    if (cd != nullptr) {
      for (NodeGiVFunc* vf : cd->vfuncs) {
        if (vf->name == name) return vf;
      }
    }
  }
  return nullptr;
}

// Instantiate the Gtk.Widget template on a freshly-constructed instance (see the
// forward declaration above ConstructGObject). A no-op unless the instance's
// registered type carries node-gi template data, so it is safe on every GObject
// construction. Uses the instance's actual type's class data (single-level
// registered templated type — the construct() case).
static void MaybeInitTemplate(GObject* obj) {
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd == nullptr || !cd->hasTemplate) return;
  const GtkTemplateApi* gtk = GetGtkTemplateApi();
  if (!gtk->ok) return;
  // Only a Gtk.Widget can be init_template'd (class_init also skips a non-widget
  // template). g_type_from_name is 0 if GTK never loaded → guard is false → skip.
  GType widgetType = g_type_from_name("GtkWidget");
  if (widgetType != 0 && g_type_is_a(G_OBJECT_TYPE(obj), widgetType)) gtk->init_template(obj);
}

// A property is custom iff its owner GType carries node-gi class-data; otherwise
// it is inherited from the introspected parent and chains to the parent vfunc.
static void NodeGiGetProperty(GObject* obj, guint prop_id, GValue* value, GParamSpec* pspec) {
  NodeGiClassData* ownerCd =
      static_cast<NodeGiClassData*>(g_type_get_qdata(pspec->owner_type, NodeGiClassDataQuark()));
  if (ownerCd != nullptr) {
    GHashTable* store = static_cast<GHashTable*>(g_object_get_qdata(obj, NodeGiInstancePropsQuark()));
    GValue* stored = store ? static_cast<GValue*>(g_hash_table_lookup(store, pspec->name)) : nullptr;
    if (stored != nullptr && G_IS_VALUE(stored)) {
      g_value_copy(stored, value);
    } else {
      g_param_value_set_default(pspec, value);
    }
    return;
  }
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd != nullptr && cd->parentGet != nullptr) cd->parentGet(obj, prop_id, value, pspec);
}

static void NodeGiSetProperty(GObject* obj, guint prop_id, const GValue* value, GParamSpec* pspec) {
  NodeGiClassData* ownerCd =
      static_cast<NodeGiClassData*>(g_type_get_qdata(pspec->owner_type, NodeGiClassDataQuark()));
  if (ownerCd != nullptr) {
    GHashTable* store = static_cast<GHashTable*>(g_object_get_qdata(obj, NodeGiInstancePropsQuark()));
    if (store == nullptr) {
      store = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, FreeStoredGValue);
      g_object_set_qdata_full(obj, NodeGiInstancePropsQuark(), store,
                              reinterpret_cast<GDestroyNotify>(g_hash_table_destroy));
    }
    GValue* copy = g_new0(GValue, 1);
    g_value_init(copy, G_VALUE_TYPE(value));
    g_value_copy(value, copy);
    g_hash_table_replace(store, g_strdup(pspec->name), copy);
    g_object_notify_by_pspec(obj, pspec);
    return;
  }
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd != nullptr && cd->parentSet != nullptr) cd->parentSet(obj, prop_id, value, pspec);
}

static void NodeGiClassInit(gpointer g_class, gpointer class_data) {
  NodeGiClassData* cd = static_cast<NodeGiClassData*>(class_data);
  GObjectClass* oc = G_OBJECT_CLASS(g_class);
  g_type_set_qdata(G_TYPE_FROM_CLASS(g_class), NodeGiClassDataQuark(), cd);

  if (!cd->properties.empty()) {
    cd->parentGet = oc->get_property;  // capture before override (chain target)
    cd->parentSet = oc->set_property;
    oc->get_property = NodeGiGetProperty;
    oc->set_property = NodeGiSetProperty;
    guint id = 1;
    for (GParamSpec* p : cd->properties) {
      g_object_class_install_property(oc, id++, p);
    }
  }
  for (const NodeGiSignalDef& s : cd->signals) {
    g_signal_newv(s.name.c_str(), G_TYPE_FROM_CLASS(g_class), s.flags, nullptr, nullptr, nullptr,
                  nullptr, s.returnType, static_cast<guint>(s.paramTypes.size()),
                  s.paramTypes.empty() ? nullptr : const_cast<GType*>(s.paramTypes.data()));
  }

  if (!cd->vfuncs.empty()) {
    GType newType = G_TYPE_FROM_CLASS(g_class);
    GType parentType = g_type_parent(newType);
    GIRepository* repo = gi_repository_dup_default();
    for (NodeGiVFunc* vf : cd->vfuncs) {
      // Resolve the vfunc info by walking the parent object-info chain; the
      // declarer's class struct holds the vtable slot we write into.
      GIVFuncInfo* vi = nullptr;
      GIObjectInfo* declarer = nullptr;
      for (GType t = parentType; t != 0 && vi == nullptr; t = g_type_parent(t)) {
        GIBaseInfo* bi = gi_repository_find_by_gtype(repo, t);
        if (bi != nullptr) {
          if (GI_IS_OBJECT_INFO(bi)) {
            vi = gi_object_info_find_vfunc(reinterpret_cast<GIObjectInfo*>(bi), vf->name.c_str());
            if (vi != nullptr)
              declarer = reinterpret_cast<GIObjectInfo*>(gi_base_info_ref(bi));
          }
          gi_base_info_unref(bi);
        }
      }
      if (vi == nullptr) {
        g_warning("node-gi: registerClass vfunc '%s' not found on any ancestor of %s",
                  vf->name.c_str(), g_type_name(newType));
        continue;
      }

      // Locate the vtable slot. gi_vfunc_info_get_offset is GI_UNKNOWN (0xFFFF)
      // for GObject's own vfuncs, so match the vfunc name to a class-struct field
      // and use that field's offset (the GJS approach); fall back to the recorded
      // offset only when the field lookup fails.
      int offset = -1;
      GIStructInfo* cs = gi_object_info_get_class_struct(declarer);
      if (cs != nullptr) {
        unsigned int nf = gi_struct_info_get_n_fields(cs);
        for (unsigned int fi = 0; fi < nf && offset < 0; fi++) {
          GIFieldInfo* f = gi_struct_info_get_field(cs, fi);
          const char* fn = gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(f));
          if (fn != nullptr && vf->name == fn) offset = gi_field_info_get_offset(f);
          gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(f));
        }
        gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(cs));
      }
      if (offset < 0) {
        size_t off = gi_vfunc_info_get_offset(vi);
        if (off != 0 && off != 0xFFFF) offset = static_cast<int>(off);
      }
      if (offset < 0) {
        g_warning("node-gi: could not resolve a vtable slot for vfunc '%s' on %s",
                  vf->name.c_str(), g_type_name(newType));
        gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(vi));
        gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(declarer));
        continue;
      }

      // Create the ffi closure and write its native address into the class vtable.
      // The vfunc info + closure + cif are kept alive for the class lifetime.
      vf->info = vi;  // retained (kept alive); never unref'd — class is permanent
      vf->closure = gi_callable_info_create_closure(reinterpret_cast<GICallableInfo*>(vi), &vf->cif,
                                                    NodeGiVFuncTrampoline, vf);
      gpointer native =
          gi_callable_info_get_closure_native_address(reinterpret_cast<GICallableInfo*>(vi),
                                                      vf->closure);
      if (native == nullptr) native = vf->closure;
      // Capture the parent implementation BEFORE overwriting the slot: at this
      // point g_class is a memcpy of the parent class struct, so the slot holds
      // the parent's vfunc pointer (the C default, or a JS override further up).
      // That is the super.vfunc_<name>() chain-up target (see callParentVfunc).
      gpointer* slotAddr = reinterpret_cast<gpointer*>(reinterpret_cast<guint8*>(g_class) + offset);
      vf->parentPtr = *slotAddr;
      *slotAddr = native;
      gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(declarer));
    }
    g_object_unref(repo);
  }

  // ---- Gtk.Widget composite template ----
  // Install the template + bind the declared children on the new GtkWidgetClass.
  // g_class is the new type's class struct, which derives from GtkWidgetClass for
  // any Gtk.Widget subtype — exactly the pointer gtk_widget_class_set_template*
  // expects. Done in class_init, the idiomatic GTK lifecycle point (C widgets
  // call set_template in their class_init too). get_template_child / init_template
  // run later, per instance.
  if (cd->hasTemplate) {
    const GtkTemplateApi* gtk = GetGtkTemplateApi();
    GType widgetType = g_type_from_name("GtkWidget");
    bool isWidget = widgetType != 0 && g_type_is_a(G_TYPE_FROM_CLASS(g_class), widgetType);
    if (gtk->ok && isWidget) {
      if (!cd->cssName.empty()) gtk->set_css_name(g_class, cd->cssName.c_str());
      if (cd->templateBytes != nullptr) {
        gtk->set_template(g_class, cd->templateBytes);
      } else if (!cd->templateResource.empty()) {
        gtk->set_template_from_resource(g_class, cd->templateResource.c_str());
      }
      for (const std::string& c : cd->children)
        gtk->bind_template_child_full(g_class, c.c_str(), FALSE, 0);
      for (const std::string& c : cd->internalChildren)
        gtk->bind_template_child_full(g_class, c.c_str(), TRUE, 0);
    } else if (!isWidget) {
      g_warning(
          "node-gi: a Template was set on %s, which is not a Gtk.Widget subclass — "
          "composite templates require a Gtk.Widget ancestor; ignoring the template",
          g_type_name(G_TYPE_FROM_CLASS(g_class)));
    } else {
      g_warning(
          "node-gi: a Gtk.Widget Template was requested but the libgtk-4 template "
          "API could not be resolved (is GTK 4 installed?)");
    }
  }
}

// callParentVfunc(handle, vfuncName, args?) -> unknown
//
// Chain up to the parent implementation of an overridden vfunc — the engine half
// of `super.vfunc_<name>(...)`. Resolves the NodeGiVFunc record for `vfuncName`
// nearest the instance's type (the record whose trampoline currently owns the
// vtable slot) and ffi_call's its captured parentPtr — the function that was in
// the slot BEFORE the override was installed (the C default, or a JS override
// further up the chain). The same `cif` the override's closure was built from
// describes the call signature (instance + declared args → return), so it is
// reused to call out. `this` (args[0]) goes back in as the instance, keeping the
// canonical toggle-ref wrapper identity. Marshals IN args (JsToGIArgument) +
// the return (gi_type_info_extract_ffi_return_value → GIArgumentToJs); throws a
// GLib.Error for a can-throw vfunc whose parent set the GError.
//
// SCOPE: single-level-over-C is the target. A vfunc with ANY declared OUT/INOUT
// arg is REJECTED with a clear error BEFORE the ffi_call (a non-optional OUT slot
// is a location the C parent writes THROUGH — passing null would SIGSEGV the
// process; "not yet supported" must mean a catchable throw, not a crash). This
// also forecloses the IN-indexing mismatch (the JS caller passes IN values
// positionally, while declared indices interleave OUT params). The dominant
// chain-up cases (constructed/dispose/activate; IN object/primitive args) are
// covered. Multi-level JS-override chains are gated out at the L1 registerClass
// layer (multi-level registered subclassing is unsupported), so they do not reach
// here; were they enabled, parentPtr would correctly resolve to the next JS
// trampoline up the chain.
Napi::Value CallParentVfunc(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "callParentVfunc(handle, vfuncName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();  // UnwrapGObject threw or it was null
  std::string vname = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  NodeGiVFunc* vf = FindVFuncRecord(G_OBJECT_TYPE(obj), vname);
  if (vf == nullptr || vf->parentPtr == nullptr || vf->info == nullptr) {
    Napi::Error::New(env, "no parent vfunc '" + vname + "' to chain up to on " +
                              g_type_name(G_OBJECT_TYPE(obj)) +
                              " (is it overridden by a registerClass subclass?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  GICallableInfo* ci = reinterpret_cast<GICallableInfo*>(vf->info);
  unsigned int nDeclared = gi_callable_info_get_n_args(ci);
  bool canThrow = gi_callable_info_can_throw_gerror(ci);

  // Guard: chain-up of a vfunc with OUT/INOUT args is not yet supported. A
  // non-optional OUT param is a pointer the C parent WRITES THROUGH, so we cannot
  // hand it a null slot (→ NULL-deref crash) and we do not yet marshal OUT values
  // back to JS. Reject with a catchable error BEFORE any ffi_call. (Also avoids the
  // declared-vs-positional IN index mismatch once an OUT precedes an IN.)
  for (unsigned int i = 0; i < nDeclared; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GIDirection dir = gi_arg_info_get_direction(ai);
    gi_base_info_unref(ai);
    if (dir != GI_DIRECTION_IN) {
      Napi::Error::New(env, "chain-up of vfunc '" + vname +
                                "' with OUT/INOUT args is not yet supported")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  // ffi argument value array: [instance, declared-arg-0 .., (GError** if can-throw)].
  // Each entry points at the value's storage; for the GIArgument union, &arg is the
  // address of every member (they overlap at offset 0), so &giArgs[i] works for any
  // primitive/pointer-typed argument.
  std::vector<GIArgument> giArgs(1 + nDeclared);
  std::vector<std::string> holds(nDeclared);
  std::vector<void*> avalue;
  avalue.reserve(1 + nDeclared + (canThrow ? 1 : 0));
  giArgs[0].v_pointer = obj;
  avalue.push_back(&giArgs[0]);

  // All declared args are IN here (the guard above rejected OUT/INOUT). They map
  // 1:1 to the positional JS args.
  bool ok = true;
  for (unsigned int i = 0; i < nDeclared && ok; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    Napi::Value v = i < args.Length() ? args.Get(i) : env.Undefined();
    if (!JsToGIArgument(env, v, ti, &giArgs[1 + i], &holds[i])) ok = false;  // already threw
    avalue.push_back(&giArgs[1 + i]);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  if (!ok) return env.Null();

  // can-throw vfuncs take a trailing GError** the parent writes the error into.
  // libffi reads each argument's VALUE from the location avalue[i] points at, so
  // for the GError** slot avalue must point at a variable holding &error (a
  // GError**) — i.e. one extra level of indirection (&errorPtr), NOT &error
  // (which would pass NULL as the GError** and silently swallow the parent error).
  GError* error = nullptr;
  GError** errorPtr = &error;
  if (canThrow) avalue.push_back(&errorPtr);

  GITypeInfo* retType = gi_callable_info_get_return_type(ci);
  GIFFIReturnValue ffiRet;
  ffiRet.v_uint64 = 0;
  ffi_call(&vf->cif, reinterpret_cast<void (*)(void)>(vf->parentPtr), &ffiRet, avalue.data());

  if (canThrow && error != nullptr) {
    gi_base_info_unref(retType);
    ThrowGError(env, error, "super." + vname);
    return env.Null();
  }

  Napi::Value result = env.Undefined();
  if (gi_type_info_get_tag(retType) != GI_TYPE_TAG_VOID) {
    // Extract the (possibly narrowed) ffi return into a normalised GIArgument,
    // then marshal it to JS — the portable, endianness-safe path. Honour the
    // vfunc's declared return transfer so a transfer-full parent return (a fresh
    // GObject / utf8 / boxed) is owned by GIArgumentToJs rather than leaked.
    GITransfer retTransfer = gi_callable_info_get_caller_owns(ci);
    GIArgument retArg;
    retArg.v_uint64 = 0;
    gi_type_info_extract_ffi_return_value(retType, &ffiRet, &retArg);
    result = GIArgumentToJs(env, retType, &retArg, retTransfer);
  }
  gi_base_info_unref(retType);
  return result;
}

// registerClass(name, parentNamespace, parentTypeName, options?) -> typeHandle
Napi::Value RegisterClass(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(
        env,
        "registerClass(name: string, parentNamespace: string, parentTypeName: string, options?: "
        "{ properties?, signals?, vfuncs? })")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string name = info[0].As<Napi::String>().Utf8Value();
  std::string pns = info[1].As<Napi::String>().Utf8Value();
  std::string ptn = info[2].As<Napi::String>().Utf8Value();

  if (g_type_from_name(name.c_str()) != 0) {
    Napi::Error::New(env, "a GType named '" + name + "' is already registered")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Resolve the parent GType from its introspection info.
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, pns.c_str(), ptn.c_str());
  bool isObject = base != nullptr && GI_IS_OBJECT_INFO(base);
  GType parentType =
      isObject ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
               : G_TYPE_INVALID;
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  if (!isObject || !G_TYPE_IS_OBJECT(parentType)) {
    Napi::TypeError::New(env, pns + "." + ptn + " is not a subclassable GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  GTypeQuery query;
  g_type_query(parentType, &query);
  if (query.type == 0) {
    Napi::Error::New(env, "failed to query parent type " + pns + "." + ptn)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Parse the optional { properties, signals } and build the class metadata.
  NodeGiClassData* cd = new NodeGiClassData();
  cd->parentGet = nullptr;
  cd->parentSet = nullptr;
  if (info.Length() >= 4 && info[3].IsObject()) {
    Napi::Object opts = info[3].As<Napi::Object>();
    if (opts.Has("properties") && opts.Get("properties").IsArray()) {
      Napi::Array props = opts.Get("properties").As<Napi::Array>();
      for (uint32_t i = 0; i < props.Length(); i++) {
        Napi::Value pv = props.Get(i);
        if (!pv.IsObject()) continue;
        std::string perr;
        GParamSpec* ps = BuildParamSpec(env, pv.As<Napi::Object>(), &perr);
        if (ps == nullptr) {
          for (GParamSpec* done : cd->properties) {
            g_param_spec_ref_sink(done);
            g_param_spec_unref(done);
          }
          delete cd;
          Napi::TypeError::New(env, "registerClass property: " + perr).ThrowAsJavaScriptException();
          return env.Null();
        }
        cd->properties.push_back(ps);
      }
    }
    if (opts.Has("signals") && opts.Get("signals").IsArray()) {
      Napi::Array sigs = opts.Get("signals").As<Napi::Array>();
      for (uint32_t i = 0; i < sigs.Length(); i++) {
        Napi::Value sv = sigs.Get(i);
        if (!sv.IsObject()) continue;
        Napi::Object so = sv.As<Napi::Object>();
        if (!so.Has("name") || !so.Get("name").IsString()) continue;
        NodeGiSignalDef sd;
        sd.name = so.Get("name").As<Napi::String>().Utf8Value();
        sd.returnType = G_TYPE_NONE;
        if (so.Has("returnType") && so.Get("returnType").IsString()) {
          GType rt = TypeNameToGType(so.Get("returnType").As<Napi::String>().Utf8Value());
          if (rt != G_TYPE_INVALID) sd.returnType = rt;
        }
        sd.flags = (so.Has("flags") && so.Get("flags").IsNumber())
                       ? static_cast<GSignalFlags>(so.Get("flags").As<Napi::Number>().Int32Value())
                       : G_SIGNAL_RUN_LAST;
        if (so.Has("paramTypes") && so.Get("paramTypes").IsArray()) {
          Napi::Array pts = so.Get("paramTypes").As<Napi::Array>();
          for (uint32_t j = 0; j < pts.Length(); j++) {
            GType t = TypeNameToGType(pts.Get(j).ToString().Utf8Value());
            if (t != G_TYPE_INVALID && t != G_TYPE_NONE) sd.paramTypes.push_back(t);
          }
        }
        cd->signals.push_back(sd);
      }
    }
    // vfuncs: an object { "<vfunc-name>": <jsFunction>, ... }. Each holds a strong
    // napi_ref for the class lifetime (resolved + hooked up in class_init).
    if (opts.Has("vfuncs") && opts.Get("vfuncs").IsObject()) {
      Napi::Object vf = opts.Get("vfuncs").As<Napi::Object>();
      Napi::Array keys = vf.GetPropertyNames();
      for (uint32_t i = 0; i < keys.Length(); i++) {
        std::string vname = keys.Get(i).ToString().Utf8Value();
        Napi::Value fnv = vf.Get(vname);
        if (!fnv.IsFunction()) continue;
        NodeGiVFunc* rec = new NodeGiVFunc();
        rec->env = env;
        rec->name = vname;
        rec->info = nullptr;
        rec->closure = nullptr;
        rec->fn = nullptr;
        rec->parentPtr = nullptr;
        napi_create_reference(env, fnv, 1, &rec->fn);
        cd->vfuncs.push_back(rec);
      }
    }
    // template: a Gtk.Widget composite template. Accepts a Uint8Array/Buffer of
    // inline UI-XML, a "resource:///…" path string (→ set_template_from_resource),
    // or a plain inline UI-XML string. Installed on the class in class_init.
    if (opts.Has("template")) {
      Napi::Value tv = opts.Get("template");
      if (tv.IsString()) {
        std::string s = tv.As<Napi::String>().Utf8Value();
        const std::string kResource = "resource://";
        if (s.rfind(kResource, 0) == 0) {
          // "resource:///path" → the resource PATH "/path" (strip the scheme +
          // authority "resource://"), matching gtk_widget_class_set_template_from_resource.
          cd->templateResource = s.substr(kResource.size());
          cd->hasTemplate = true;
        } else {
          // Inline UI-XML string → owned GBytes copy.
          cd->templateBytes = g_bytes_new(s.data(), s.size());
          cd->hasTemplate = true;
        }
      } else if (tv.IsBuffer()) {
        Napi::Buffer<uint8_t> b = tv.As<Napi::Buffer<uint8_t>>();
        cd->templateBytes = g_bytes_new(b.Data(), b.Length());
        cd->hasTemplate = true;
      } else if (tv.IsTypedArray()) {
        Napi::TypedArray ta = tv.As<Napi::TypedArray>();
        const uint8_t* data = static_cast<const uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
        cd->templateBytes = g_bytes_new(data, ta.ByteLength());
        cd->hasTemplate = true;
      }
    }
    if (opts.Has("cssName") && opts.Get("cssName").IsString()) {
      cd->cssName = opts.Get("cssName").As<Napi::String>().Utf8Value();
    }
    if (opts.Has("children") && opts.Get("children").IsArray()) {
      Napi::Array arr = opts.Get("children").As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        if (arr.Get(i).IsString()) cd->children.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
      }
    }
    if (opts.Has("internalChildren") && opts.Get("internalChildren").IsArray()) {
      Napi::Array arr = opts.Get("internalChildren").As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        if (arr.Get(i).IsString())
          cd->internalChildren.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
      }
    }
  }

  GTypeInfo typeInfo = {};
  typeInfo.class_size = static_cast<guint16>(query.class_size);
  typeInfo.instance_size = static_cast<guint16>(query.instance_size);
  // class_init installs the custom properties + signals (and records the class
  // data even when there are none, so the property vfuncs can find it).
  typeInfo.class_init = NodeGiClassInit;
  typeInfo.class_data = cd;

  GType newType = g_type_register_static(parentType, name.c_str(), &typeInfo, (GTypeFlags)0);
  if (newType == 0) {
    for (NodeGiVFunc* vf : cd->vfuncs) {
      if (vf->fn != nullptr) napi_delete_reference(env, vf->fn);
      delete vf;
    }
    delete cd;
    Napi::Error::New(env, "g_type_register_static failed for '" + name + "'")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::External<void>::New(env, reinterpret_cast<void*>(newType));
}

// constructType(typeHandle, props?: Record<string, unknown>) -> External<GObject>
Napi::Value ConstructType(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "constructType(typeHandle, props?: object)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GType gtype = UnwrapGType(env, info[0]);
  if (gtype == 0) return env.Null();
  if (!G_TYPE_IS_OBJECT(gtype)) {
    Napi::TypeError::New(env, "type handle is not a constructible GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object props = (info.Length() >= 2 && info[1].IsObject()) ? info[1].As<Napi::Object>()
                                                                 : Napi::Object::New(env);
  return ConstructGObject(env, gtype, props, std::string(g_type_name(gtype)));
}

// getTemplateChild(handle, name) -> wrapped child GObject | null
//
// Resolve a composite-template child bound on the instance's type (declared via
// registerClass Children/InternalChildren) by name. Returns the child wrapped
// through the canonical toggle-ref bridge (GI_TRANSFER_NOTHING — the child is
// owned by the parent widget via the template, a borrowed pointer). The L1 layer
// assigns the result onto the instance (public `this.name`, internal `this._name`).
Napi::Value GetTemplateChild(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "getTemplateChild(handle, name: string)").ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  const GtkTemplateApi* gtk = GetGtkTemplateApi();
  if (!gtk->ok) {
    Napi::Error::New(env, "node-gi: the libgtk-4 template API is unavailable")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // Look the child up against the instance's actual type (the registered
  // templated type for the single-level case the decorator constructs).
  GObject* child = gtk->get_template_child(obj, G_OBJECT_TYPE(obj), name.c_str());
  if (child == nullptr) return env.Null();
  return WrapGObject(env, child, GI_TRANSFER_NOTHING);
}

// getProperty(handle, name) -> unknown
Napi::Value GetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "getProperty(handle, name: string)").ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GParamSpec* pspec = g_object_class_find_property(G_OBJECT_GET_CLASS(obj), name.c_str());
  if (pspec == nullptr) {
    Napi::TypeError::New(env, "no such property '" + name + "'").ThrowAsJavaScriptException();
    return env.Null();
  }
  GValue v = G_VALUE_INIT;
  g_value_init(&v, pspec->value_type);
  g_object_get_property(obj, name.c_str(), &v);
  Napi::Value result = GValueToJs(env, &v);
  g_value_unset(&v);
  return result;
}

// setProperty(handle, name, value) -> void
Napi::Value SetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsString()) {
    Napi::TypeError::New(env, "setProperty(handle, name: string, value)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Undefined();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GParamSpec* pspec = g_object_class_find_property(G_OBJECT_GET_CLASS(obj), name.c_str());
  if (pspec == nullptr) {
    Napi::TypeError::New(env, "no such property '" + name + "'").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  GValue v = G_VALUE_INIT;
  g_value_init(&v, pspec->value_type);
  if (JsToGValue(env, info[2], &v)) {
    g_object_set_property(obj, name.c_str(), &v);
  }
  g_value_unset(&v);
  return env.Undefined();
}

// getTypeName(handle) -> string   (the runtime GType name of an instance)
Napi::Value GetTypeName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  return Napi::String::New(env, G_OBJECT_TYPE_NAME(obj));
}

// isInstanceOf(handle, namespace, typeName) -> boolean
// Whether the instance's GType is-a `namespace.typeName` (g_type_is_a, which also
// returns true when the type IMPLEMENTS an interface). The L1 wrapper uses it to
// pick the right Gio._promisify registration when two classes promisify a method
// of the same name (resolve by the instance's class). False for an unknown type.
Napi::Value IsInstanceOf(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(env, "isInstanceOf(handle, namespace: string, typeName: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();  // already threw
  std::string ns = info[1].As<Napi::String>().Utf8Value();
  std::string tn = info[2].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  GType target = (base != nullptr && GI_IS_REGISTERED_TYPE_INFO(base))
                     ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
                     : 0;
  bool result = target != 0 && g_type_is_a(G_OBJECT_TYPE(obj), target);
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  return Napi::Boolean::New(env, result);
}

// hasProperty(handle, name) -> boolean
// Whether the instance's type has a GObject property by this name. The L1
// wrapper uses it to route `obj.foo` to a property read vs an `obj.foo()` method.
Napi::Value HasProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "hasProperty(handle, name: string)").ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GParamSpec* pspec = g_object_class_find_property(G_OBJECT_GET_CLASS(obj), name.c_str());
  return Napi::Boolean::New(env, pspec != nullptr);
}

// isGObjectHandle(value) -> boolean
// Whether `value` is one of node-gi's GObject-instance handles (tag-checked, no
// dereference). Lets the L1 wrapper detect object-typed return values and wrap
// them as instances for chaining, without misclassifying a GType handle.
Napi::Value IsGObjectHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = info.Length() >= 1 && info[0].IsExternal() &&
            info[0].As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag);
  return Napi::Boolean::New(env, is);
}

// ============================ TEST-ONLY ===============================
// __stressRefUnrefOffThread(handle, iterations) — the GLib-thread vehicle the
// cross-thread GC stress test needs (there is no headless JS way to make another
// OS thread ref/unref a wrapped GObject — GIO local-file async keeps its refcount
// ops on the main thread). A background GThread does g_object_ref/g_object_unref on
// the wrapped GObject `iterations` times, crossing the toggle 1<->2 boundary from a
// NON-main thread → driving NodeGiToggleNotify's OFF-THREAD branch + the
// opposite-direction enqueue cancel + WakeDrain + the JS-thread drain. The CALLER
// MUST keep the handle reachable (and take NO extra ref) for the churn's lifetime:
// the toggle ref + the JS-reachable wrapper keep the GObject alive at refcount 1
// between churn pairs, so the worker's 1<->2 crossings are real toggles, never a
// use-after-free. Poll __stressRefUnrefRunning() for completion. Not part of the
// public API surface — prefixed __ and only used by test/gc-cross-thread.test.mjs.
static std::atomic<int> g_stress_running{0};
// Monotonic count of completed off-thread ref/unref iterations — lets a test prove
// the off-thread churn makes progress WHILE a main-thread dispose vfunc is running
// (i.e. the drain lock is NOT held across dispose). If the lock were held across the
// dispose, the off-thread NodeGiToggleNotify would block on g_queue_mutex and this
// counter would freeze for the dispose's whole duration.
static std::atomic<long> g_stress_progress{0};
// Cooperative stop flag so a test can halt a long-running churn after asserting.
static std::atomic<bool> g_stress_stop{false};
struct StressArgs {
  GObject* obj;
  long iterations;
};
static gpointer StressThreadFunc(gpointer data) {
  StressArgs* a = static_cast<StressArgs*>(data);
  for (long i = 0; i < a->iterations; i++) {
    if (g_stress_stop.load()) break;
    g_object_ref(a->obj);    // 1 -> 2 : toggle UP (off-thread)
    g_object_unref(a->obj);  // 2 -> 1 : toggle DOWN (off-thread)
    g_stress_progress.fetch_add(1);
    if ((i & 0x3f) == 0) g_thread_yield();  // give the main thread the lock + loop
  }
  g_stress_running.fetch_sub(1);
  delete a;
  return nullptr;
}
Napi::Value StressRefUnrefOffThread(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Undefined();
  long iters = info.Length() >= 2 ? static_cast<long>(info[1].As<Napi::Number>().Int64Value()) : 10000;
  g_stress_stop.store(false);  // a fresh churn is not pre-stopped
  StressArgs* a = new StressArgs{obj, iters};
  g_stress_running.fetch_add(1);
  GThread* t = g_thread_new("node-gi-stress", StressThreadFunc, a);
  g_thread_unref(t);  // detached — completion is signalled via g_stress_running
  return env.Undefined();
}
Napi::Value StressRefUnrefRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_stress_running.load() > 0);
}
Napi::Value StressRefUnrefProgress(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(g_stress_progress.load()));
}
Napi::Value StressRefUnrefStop(const Napi::CallbackInfo& info) {
  g_stress_stop.store(true);
  return info.Env().Undefined();
}
// ========================== END TEST-ONLY ============================

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

// ====================================================================
// ---- GVariant build / unpack (the GLib.Variant ergonomics) ---------
// ====================================================================
//
// The native half of GJS's `GLib.Variant` override (gjs/modules/core/overrides/
// GLib.js): a recursive packer `new GLib.Variant(signature, value)` and an
// unpacker driving `.unpack()` / `.deepUnpack()` / `.recursiveUnpack()`. The L1
// layer (gi.js) wires the GJS-shaped surface on top of these primitives.
//
// SCOPE — the common signatures real GAction/GSettings/DBus code hits: the
// basics `b y n q i u x t h d s o g`, `v` (variant), `m*` (maybe), `a*` arrays
// (with the `as` strv + `ay` bytestring fast-paths and `a{..}` dictionaries via
// dict-entries), `(...)` tuples, and `{kv}` dict-entries. Genuinely exotic
// element types fall out of the type grammar with a clear "Invalid GVariant
// signature" error.
//
// OWNERSHIP (the leak/UAF surface — scrutinise here): every `g_variant_new_*`
// and `g_variant_builder_end` returns a FLOATING ref. A child handed to
// g_variant_builder_add_value / g_variant_new_maybe / g_variant_new_dict_entry
// is CONSUMED (its floating ref is taken), so the success path never leaks. The
// single top-level result is g_variant_ref_sink'd exactly once and owned by the
// boxed handle (g_variant_unref on GC). On the UNPACK side g_variant_get_child_
// value / get_variant / get_maybe each return a NEW ref (transfer full): a child
// that "stays a Variant" hands that ref straight to the boxed handle (no extra
// ref), and a child we recurse into is unref'd after the read.

static bool VariantIsSimpleType(char c) {
  switch (c) {
    case 'b': case 'y': case 'n': case 'q': case 'i': case 'u':
    case 'x': case 't': case 'h': case 'd': case 's': case 'o': case 'g':
      return true;
    default:
      return false;
  }
}

// Consume one complete type from `sig` starting at *pos, advancing *pos past it,
// and return that type's string (mirrors GJS `_readSingleType`). `forceSimple`
// rejects a non-basic type (dict keys must be basic). Throws + sets *ok=false on
// a malformed signature.
static std::string VariantReadSingleType(Napi::Env env, const std::string& sig, size_t* pos,
                                         bool forceSimple, bool* ok) {
  if (*pos >= sig.size()) {
    Napi::TypeError::New(env, "Invalid GVariant signature (reached end while expecting a type)")
        .ThrowAsJavaScriptException();
    *ok = false;
    return "";
  }
  char c = sig[(*pos)++];
  bool simple = VariantIsSimpleType(c);
  if (!simple && forceSimple) {
    Napi::TypeError::New(env, "Invalid GVariant signature (a simple type was expected)")
        .ThrowAsJavaScriptException();
    *ok = false;
    return "";
  }
  if (c == 'm' || c == 'a') {
    std::string inner = VariantReadSingleType(env, sig, pos, false, ok);
    if (!*ok) return "";
    return std::string(1, c) + inner;
  }
  if (c == '{') {
    std::string key = VariantReadSingleType(env, sig, pos, true, ok);
    if (!*ok) return "";
    std::string val = VariantReadSingleType(env, sig, pos, false, ok);
    if (!*ok) return "";
    if (*pos >= sig.size() || sig[*pos] != '}') {
      Napi::TypeError::New(env, "Invalid GVariant signature for type DICT_ENTRY (expected \"}\")")
          .ThrowAsJavaScriptException();
      *ok = false;
      return "";
    }
    (*pos)++;
    return std::string("{") + key + val + "}";
  }
  if (c == '(') {
    std::string res = "(";
    while (true) {
      if (*pos >= sig.size()) {
        Napi::TypeError::New(env, "Invalid GVariant signature for type TUPLE (expected \")\")")
            .ThrowAsJavaScriptException();
        *ok = false;
        return "";
      }
      if (sig[*pos] == ')') {
        (*pos)++;
        res += ")";
        return res;
      }
      std::string el = VariantReadSingleType(env, sig, pos, false, ok);
      if (!*ok) return "";
      res += el;
    }
  }
  if (!simple && c != 'v') {
    Napi::TypeError::New(env, std::string("Invalid GVariant signature (") + c + " is not a valid type)")
        .ThrowAsJavaScriptException();
    *ok = false;
    return "";
  }
  return std::string(1, c);
}

// Read a JS value into a byte vector for an `ay` array (Uint8Array/Buffer/
// number[]; a string is UTF-8 encoded with a trailing NUL, matching GJS).
static bool VariantExtractBytes(Napi::Env env, Napi::Value v, std::vector<guint8>* out) {
  if (v.IsBuffer()) {
    Napi::Buffer<uint8_t> b = v.As<Napi::Buffer<uint8_t>>();
    out->assign(b.Data(), b.Data() + b.Length());
    return true;
  }
  if (v.IsTypedArray()) {
    Napi::TypedArray ta = v.As<Napi::TypedArray>();
    const uint8_t* base = static_cast<uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
    out->assign(base, base + ta.ByteLength());
    return true;
  }
  if (v.IsArray()) {
    Napi::Array a = v.As<Napi::Array>();
    uint32_t n = a.Length();
    out->resize(n);
    for (uint32_t i = 0; i < n; i++)
      (*out)[i] = static_cast<guint8>(a.Get(i).ToNumber().Uint32Value());
    return true;
  }
  if (v.IsString()) {
    std::string s = v.As<Napi::String>().Utf8Value();
    out->assign(s.begin(), s.end());
    out->push_back(0);
    return true;
  }
  Napi::TypeError::New(env, "GVariant 'ay' expects a Uint8Array, Buffer, number[] or string")
      .ThrowAsJavaScriptException();
  return false;
}

// Recursively build a (floating) GVariant from `sig` (starting at *pos) + `value`
// — the C twin of GJS `_packVariant`. Returns a FLOATING ref (or nullptr with a
// pending exception + *ok=false). The caller consumes the float.
static GVariant* VariantPack(Napi::Env env, const std::string& sig, size_t* pos,
                             Napi::Value value, bool* ok) {
  if (*pos >= sig.size()) {
    Napi::TypeError::New(env, "GVariant signature cannot be empty").ThrowAsJavaScriptException();
    *ok = false;
    return nullptr;
  }
  char c = sig[(*pos)++];
  switch (c) {
    case 'b': return g_variant_new_boolean(value.ToBoolean().Value());
    case 'y': return g_variant_new_byte(static_cast<guint8>(value.ToNumber().Uint32Value()));
    case 'n': return g_variant_new_int16(static_cast<gint16>(value.ToNumber().Int32Value()));
    case 'q': return g_variant_new_uint16(static_cast<guint16>(value.ToNumber().Uint32Value()));
    case 'i': return g_variant_new_int32(value.ToNumber().Int32Value());
    case 'u': return g_variant_new_uint32(value.ToNumber().Uint32Value());
    case 'x': {
      // GJS accepts a BigInt for 64-bit types (its js_value_to_c<int64_t> branches
      // on isBigInt before ToInt64). ToNumber() throws on a BigInt and rounds a
      // large double — branch on IsBigInt to round-trip the full int64 range.
      bool lossless = false;
      gint64 i = value.IsBigInt() ? value.As<Napi::BigInt>().Int64Value(&lossless)
                                  : value.ToNumber().Int64Value();
      return g_variant_new_int64(i);
    }
    case 't': {
      bool lossless = false;
      guint64 u = value.IsBigInt()
                      ? value.As<Napi::BigInt>().Uint64Value(&lossless)
                      : static_cast<guint64>(value.ToNumber().Int64Value());
      return g_variant_new_uint64(u);
    }
    case 'h': return g_variant_new_handle(value.ToNumber().Int32Value());
    case 'd': return g_variant_new_double(value.ToNumber().DoubleValue());
    case 's': {
      // GJS marshals 's' via new_string, whose UTF8 arg is type-strict (isString
      // or null), so `new GLib.Variant('s', 42)` throws rather than packing "42".
      if (!value.IsString()) {
        Napi::TypeError::New(env, "GVariant 's' expects a string")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      std::string s = value.ToString().Utf8Value();
      return g_variant_new_string(s.c_str());
    }
    case 'o': {
      if (!value.IsString()) {
        Napi::TypeError::New(env, "GVariant 'o' expects an object-path string")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      std::string s = value.ToString().Utf8Value();
      if (!g_variant_is_object_path(s.c_str())) {
        Napi::TypeError::New(env, std::string("Invalid GVariant object path: ") + s)
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      return g_variant_new_object_path(s.c_str());
    }
    case 'g': {
      if (!value.IsString()) {
        Napi::TypeError::New(env, "GVariant 'g' expects a signature string")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      std::string s = value.ToString().Utf8Value();
      if (!g_variant_is_signature(s.c_str())) {
        Napi::TypeError::New(env, std::string("Invalid GVariant signature string: ") + s)
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      return g_variant_new_signature(s.c_str());
    }
    case 'v': {
      gpointer p = nullptr;
      if (!TryGetBoxedPtr(value, &p) || p == nullptr) {
        Napi::TypeError::New(env, "GVariant 'v' expects a GLib.Variant value")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      return g_variant_new_variant(static_cast<GVariant*>(p));
    }
    case 'm': {
      if (!value.IsNull() && !value.IsUndefined()) {
        GVariant* child = VariantPack(env, sig, pos, value, ok);
        if (!*ok) return nullptr;
        return g_variant_new_maybe(nullptr, child);  // consumes the floating child
      }
      std::string elem = VariantReadSingleType(env, sig, pos, false, ok);
      if (!*ok) return nullptr;
      GVariantType* t = g_variant_type_new(elem.c_str());
      GVariant* r = g_variant_new_maybe(t, nullptr);
      g_variant_type_free(t);
      return r;
    }
    case 'a': {
      std::string elemType = VariantReadSingleType(env, sig, pos, false, ok);
      if (!*ok) return nullptr;
      char e0 = elemType.empty() ? '\0' : elemType[0];
      if (e0 == 's') {  // array of strings → g_variant_new_strv
        if (!value.IsArray()) {
          Napi::TypeError::New(env, "GVariant 'as' expects an array of strings")
              .ThrowAsJavaScriptException();
          *ok = false;
          return nullptr;
        }
        Napi::Array a = value.As<Napi::Array>();
        uint32_t n = a.Length();
        std::vector<std::string> store(n);
        std::vector<const gchar*> ptrs(n + 1, nullptr);
        for (uint32_t i = 0; i < n; i++) {
          store[i] = a.Get(i).ToString().Utf8Value();
          ptrs[i] = store[i].c_str();
        }
        return g_variant_new_strv(ptrs.data(), static_cast<gssize>(n));  // copies
      }
      if (e0 == 'y') {  // byte array
        std::vector<guint8> bytes;
        if (!VariantExtractBytes(env, value, &bytes)) {
          *ok = false;
          return nullptr;
        }
        return g_variant_new_fixed_array(G_VARIANT_TYPE_BYTE, bytes.data(), bytes.size(),
                                         sizeof(guint8));  // copies
      }
      std::string fullType = "a" + elemType;
      GVariantType* at = g_variant_type_new(fullType.c_str());
      GVariantBuilder builder;
      g_variant_builder_init(&builder, at);
      if (e0 == '{') {  // dictionary: a plain object keyed by the entry's key type
        if (!value.IsObject()) {
          g_variant_builder_clear(&builder);
          g_variant_type_free(at);
          Napi::TypeError::New(env, "GVariant dictionary expects a plain object")
              .ThrowAsJavaScriptException();
          *ok = false;
          return nullptr;
        }
        Napi::Object obj = value.As<Napi::Object>();
        Napi::Array keys = obj.GetPropertyNames();
        uint32_t n = keys.Length();
        for (uint32_t i = 0; i < n; i++) {
          Napi::Value k = keys.Get(i);
          Napi::Array pair = Napi::Array::New(env, 2);
          pair.Set(static_cast<uint32_t>(0), k);
          pair.Set(static_cast<uint32_t>(1), obj.Get(k));
          size_t p2 = 0;
          GVariant* child = VariantPack(env, elemType, &p2, pair, ok);  // packs the {kv} entry
          if (!*ok) {
            g_variant_builder_clear(&builder);
            g_variant_type_free(at);
            return nullptr;
          }
          g_variant_builder_add_value(&builder, child);  // consumes the floating entry
        }
      } else {  // generic array: re-parse elemType per element
        if (!value.IsArray()) {
          g_variant_builder_clear(&builder);
          g_variant_type_free(at);
          Napi::TypeError::New(env, "GVariant array expects an array value")
              .ThrowAsJavaScriptException();
          *ok = false;
          return nullptr;
        }
        Napi::Array a = value.As<Napi::Array>();
        uint32_t n = a.Length();
        for (uint32_t i = 0; i < n; i++) {
          size_t p2 = 0;
          GVariant* child = VariantPack(env, elemType, &p2, a.Get(i), ok);
          if (!*ok) {
            g_variant_builder_clear(&builder);
            g_variant_type_free(at);
            return nullptr;
          }
          g_variant_builder_add_value(&builder, child);
        }
      }
      GVariant* r = g_variant_builder_end(&builder);
      g_variant_type_free(at);
      return r;
    }
    case '(': {  // tuple: drive children off the signature until ')'
      if (!value.IsArray()) {
        Napi::TypeError::New(env, "GVariant tuple expects an array value")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      Napi::Array a = value.As<Napi::Array>();
      uint32_t n = a.Length();
      GVariantBuilder builder;
      g_variant_builder_init(&builder, G_VARIANT_TYPE_TUPLE);
      // Drive children off the JS array length (GJS: `for i < value.length`), not
      // the signature — a missing position must NOT coerce undefined→garbage.
      for (uint32_t i = 0; i < n; i++) {
        if (*pos < sig.size() && sig[*pos] == ')') break;  // more values than types: stop
        GVariant* child = VariantPack(env, sig, pos, a.Get(i), ok);
        if (!*ok) {
          g_variant_builder_clear(&builder);
          return nullptr;
        }
        g_variant_builder_add_value(&builder, child);
      }
      // Every value consumed: the signature must now close the tuple. If types
      // remain (too few values) this throws, exactly as GJS does.
      if (*pos >= sig.size() || sig[*pos] != ')') {
        g_variant_builder_clear(&builder);
        Napi::TypeError::New(env, "Invalid GVariant signature for type TUPLE (expected \")\")")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      (*pos)++;  // consume ')'
      return g_variant_builder_end(&builder);
    }
    case '{': {  // dict-entry: value is [key, val]
      if (!value.IsArray()) {
        Napi::TypeError::New(env, "GVariant dict-entry expects a [key, value] array")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      Napi::Array a = value.As<Napi::Array>();
      GVariant* key = VariantPack(env, sig, pos, a.Get(static_cast<uint32_t>(0)), ok);
      if (!*ok) return nullptr;
      GVariant* val = VariantPack(env, sig, pos, a.Get(static_cast<uint32_t>(1)), ok);
      if (!*ok) {
        g_variant_unref(g_variant_take_ref(key));
        return nullptr;
      }
      if (*pos >= sig.size() || sig[*pos] != '}') {
        g_variant_unref(g_variant_take_ref(key));
        g_variant_unref(g_variant_take_ref(val));
        Napi::TypeError::New(env, "Invalid GVariant signature for type DICT_ENTRY (expected \"}\")")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      (*pos)++;
      return g_variant_new_dict_entry(key, val);  // consumes both floating children
    }
    default:
      Napi::TypeError::New(
          env, std::string("Invalid GVariant signature (unexpected character ") + c + ")")
          .ThrowAsJavaScriptException();
      *ok = false;
      return nullptr;
  }
}

static Napi::Value VariantToJs(Napi::Env env, GVariant* v, bool deep, bool recursive);

// Shared array/tuple/dict-entry reader: each child either fully unpacks (deep) or
// stays a Variant handle (shallow). The shallow handle adopts the new ref from
// g_variant_get_child_value; the deep path unrefs after the recursive read.
static Napi::Array VariantContainerToArray(Napi::Env env, GVariant* v, bool deep, bool recursive) {
  gsize n = g_variant_n_children(v);
  Napi::Array out = Napi::Array::New(env, n);
  for (gsize i = 0; i < n; i++) {
    GVariant* child = g_variant_get_child_value(v, i);  // transfer full
    if (deep) {
      Napi::Value cj = VariantToJs(env, child, deep, recursive);
      g_variant_unref(child);
      out.Set(static_cast<uint32_t>(i), cj);
    } else {
      out.Set(static_cast<uint32_t>(i), MakeBoxedHandle(env, child, G_TYPE_VARIANT, true));
    }
  }
  return out;
}

// The C twin of GJS `_unpackVariant(variant, deep, recursive)`. `deep` controls
// whether container children are unpacked at all; `recursive` ONLY affects `v`
// (variant) values — deep keeps a nested `v` as a Variant, recursive unwraps it.
// This is the exact distinction behind unpack() / deepUnpack() / recursiveUnpack.
static Napi::Value VariantToJs(Napi::Env env, GVariant* v, bool deep, bool recursive) {
  switch (g_variant_classify(v)) {
    case G_VARIANT_CLASS_BOOLEAN: return Napi::Boolean::New(env, g_variant_get_boolean(v));
    case G_VARIANT_CLASS_BYTE: return Napi::Number::New(env, g_variant_get_byte(v));
    case G_VARIANT_CLASS_INT16: return Napi::Number::New(env, g_variant_get_int16(v));
    case G_VARIANT_CLASS_UINT16: return Napi::Number::New(env, g_variant_get_uint16(v));
    case G_VARIANT_CLASS_INT32: return Napi::Number::New(env, g_variant_get_int32(v));
    case G_VARIANT_CLASS_UINT32: return Napi::Number::New(env, g_variant_get_uint32(v));
    case G_VARIANT_CLASS_INT64:
      return Napi::Number::New(env, static_cast<double>(g_variant_get_int64(v)));
    case G_VARIANT_CLASS_UINT64:
      return Napi::Number::New(env, static_cast<double>(g_variant_get_uint64(v)));
    case G_VARIANT_CLASS_HANDLE: return Napi::Number::New(env, g_variant_get_handle(v));
    case G_VARIANT_CLASS_DOUBLE: return Napi::Number::New(env, g_variant_get_double(v));
    case G_VARIANT_CLASS_STRING:
    case G_VARIANT_CLASS_OBJECT_PATH:
    case G_VARIANT_CLASS_SIGNATURE:
      return Napi::String::New(env, g_variant_get_string(v, nullptr));
    case G_VARIANT_CLASS_VARIANT: {
      GVariant* inner = g_variant_get_variant(v);  // transfer full
      if (deep && recursive) {
        Napi::Value r = VariantToJs(env, inner, deep, recursive);
        g_variant_unref(inner);
        return r;
      }
      return MakeBoxedHandle(env, inner, G_TYPE_VARIANT, true);  // stays a Variant
    }
    case G_VARIANT_CLASS_MAYBE: {
      GVariant* inner = g_variant_get_maybe(v);  // transfer full, or NULL
      if (inner == nullptr) return env.Null();
      if (deep) {
        Napi::Value r = VariantToJs(env, inner, deep, recursive);
        g_variant_unref(inner);
        return r;
      }
      return MakeBoxedHandle(env, inner, G_TYPE_VARIANT, true);
    }
    case G_VARIANT_CLASS_ARRAY: {
      if (g_variant_is_of_type(v, G_VARIANT_TYPE_DICTIONARY)) {  // a{?*}
        Napi::Object out = Napi::Object::New(env);
        gsize n = g_variant_n_children(v);
        for (gsize i = 0; i < n; i++) {
          GVariant* entry = g_variant_get_child_value(v, i);
          GVariant* keyv = g_variant_get_child_value(entry, 0);
          GVariant* valv = g_variant_get_child_value(entry, 1);
          // The key is always fully unpacked (it must be usable as an object
          // key); the value follows the deep/recursive rule.
          Napi::Value keyJs = VariantToJs(env, keyv, true, recursive);
          Napi::Value valJs = deep
              ? VariantToJs(env, valv, deep, recursive)
              : MakeBoxedHandle(env, g_variant_ref(valv), G_TYPE_VARIANT, true);
          out.Set(keyJs, valJs);
          g_variant_unref(keyv);
          g_variant_unref(valv);
          g_variant_unref(entry);
        }
        return out;
      }
      if (g_variant_is_of_type(v, G_VARIANT_TYPE_BYTESTRING)) {  // ay
        gsize n = 0;
        const void* data = g_variant_get_fixed_array(v, &n, sizeof(guint8));
        Napi::Uint8Array arr = Napi::Uint8Array::New(env, n);
        if (n > 0 && data != nullptr) memcpy(arr.Data(), data, n);
        return arr;
      }
      return VariantContainerToArray(env, v, deep, recursive);
    }
    case G_VARIANT_CLASS_TUPLE:
    case G_VARIANT_CLASS_DICT_ENTRY:
      return VariantContainerToArray(env, v, deep, recursive);
    default:
      Napi::Error::New(env, "Unsupported GVariant type in unpack").ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// Read a GVariant pointer from a node-gi GLib.Variant handle (a boxed handle
// tagged with G_TYPE_VARIANT). Throws + returns nullptr otherwise.
static GVariant* UnwrapVariant(Napi::Env env, Napi::Value handle) {
  if (!handle.IsExternal() ||
      !handle.As<Napi::External<BoxedHandle>>().CheckTypeTag(&kBoxedHandleTag)) {
    Napi::TypeError::New(env, "expected a node-gi GLib.Variant handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  BoxedHandle* h = handle.As<Napi::External<BoxedHandle>>().Data();
  if (h == nullptr || h->ptr == nullptr || h->gtype != G_TYPE_VARIANT) {
    Napi::TypeError::New(env, "expected a node-gi GLib.Variant handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  return static_cast<GVariant*>(h->ptr);
}

// variantNew(signature, value?) -> boxed GLib.Variant handle
Napi::Value VariantNew(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "variantNew(signature: string, value?: unknown)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string sig = info[0].As<Napi::String>().Utf8Value();
  if (sig.empty()) {
    Napi::TypeError::New(env, "GVariant signature cannot be empty").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Value value = info.Length() >= 2 ? info[1] : env.Undefined();
  size_t pos = 0;
  bool ok = true;
  GVariant* v = VariantPack(env, sig, &pos, value, &ok);
  if (!ok) return env.Null();  // exception already pending
  if (pos != sig.size()) {
    if (v != nullptr) g_variant_unref(g_variant_take_ref(v));
    Napi::TypeError::New(env, "Invalid GVariant signature (more than one single complete type)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  g_variant_ref_sink(v);  // sink the floating ref → own exactly one
  return MakeBoxedHandle(env, v, G_TYPE_VARIANT, true);
}

// variantUnpack(handle, deep?, recursive?) -> unknown
Napi::Value VariantUnpack(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GVariant* v = UnwrapVariant(env, info.Length() >= 1 ? info[0] : env.Undefined());
  if (v == nullptr) return env.Null();
  bool deep = info.Length() >= 2 && info[1].ToBoolean().Value();
  bool recursive = info.Length() >= 3 && info[2].ToBoolean().Value();
  return VariantToJs(env, v, deep, recursive);
}

// variantGetTypeString(handle) -> string
Napi::Value VariantGetTypeString(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GVariant* v = UnwrapVariant(env, info.Length() >= 1 ? info[0] : env.Undefined());
  if (v == nullptr) return env.Null();
  return Napi::String::New(env, g_variant_get_type_string(v));
}

// isVariantHandle(value) -> boolean (a boxed handle tagged with G_TYPE_VARIANT)
Napi::Value IsVariantHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = false;
  if (info.Length() >= 1 && info[0].IsExternal()) {
    Napi::External<BoxedHandle> ext = info[0].As<Napi::External<BoxedHandle>>();
    if (ext.CheckTypeTag(&kBoxedHandleTag)) {
      BoxedHandle* h = ext.Data();
      is = h != nullptr && h->gtype == G_TYPE_VARIANT;
    }
  }
  return Napi::Boolean::New(env, is);
}

// ---- signals (milestone 1) ----
//
// A GClosure that wraps a JS callback. The callback is held by a strong
// napi_ref; the closure's finalize notifier drops it. The generic marshal
// converts the signal's GValue params to JS (skipping the emitter instance at
// index 0) and the JS return into the signal return GValue.
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

static void JsClosureMarshal(GClosure* closure, GValue* return_value, guint n_param_values,
                             const GValue* param_values, gpointer /*invocation_hint*/,
                             gpointer /*marshal_data*/) {
  JsClosureData* jc = static_cast<JsClosureData*>(closure->data);
  if (jc == nullptr || jc->callback == nullptr) return;
  Napi::Env env(jc->env);
  Napi::HandleScope scope(env);

  napi_value cbv = nullptr;
  if (napi_get_reference_value(jc->env, jc->callback, &cbv) != napi_ok || cbv == nullptr) return;

  // Signal args excluding the emitter instance (param_values[0]).
  std::vector<napi_value> args;
  args.reserve(n_param_values > 0 ? n_param_values - 1 : 0);
  for (guint i = 1; i < n_param_values; i++) {
    Napi::Value v = GValueToJs(env, &param_values[i]);
    if (env.IsExceptionPending()) return;
    args.push_back(v);
  }

  napi_value result = nullptr;
  napi_status st = napi_call_function(jc->env, env.Undefined(), cbv, args.size(), args.data(), &result);
  if (st != napi_ok) return;  // JS threw — leave the pending exception to surface

  if (return_value != nullptr && (G_VALUE_TYPE(return_value) != G_TYPE_INVALID)) {
    JsToGValue(env, Napi::Value(jc->env, result), return_value);
  }
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
  bool after = info.Length() >= 4 && info[3].ToBoolean().Value();

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
    if (!JsToGValue(env, v, &params[i + 1])) {
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
    g_signal_emitv(params.data(), sigid, 0, hasReturn ? &ret : nullptr);
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

// ---- libuv <-> GLib main loop bridge (milestone: mainloop) ----
//
// Port of node-gtk's src/loop.cc (romgrk and contributors, MIT) to N-API. Nests
// Node's libuv loop inside GLib's main loop: a GSource polls libuv's backend fd
// and runs uv_run(UV_RUN_NOWAIT) on dispatch, so a blocking GLib main loop
// (GLib.MainLoop.run / GApplication.run) keeps Node timers/promises/IO alive —
// matching GJS, where the GLib loop IS the process loop. Nesting GLib inside uv
// is impractical (uv exposes no external prepare/check hook), so we nest the
// other way, exactly as node-gtk does.
//
// Main-thread only (worker_threads would need a per-context source); the GLib
// default context is iterated on the same thread Node runs on.
struct UvLoopSource {
  GSource source;
  uv_loop_t* loop;
  gpointer fd_tag;
  gboolean fd_polled;
};

static napi_env g_loop_env = nullptr;       // captured at startMainLoop (main thread)
static gboolean g_loop_started = FALSE;
static napi_ref g_process_ref = nullptr;        // process
static napi_ref g_tick_callback_ref = nullptr;  // process._tickCallback

// Drain Node's nextTick queue + run a microtask checkpoint. process._tickCallback
// invoked through napi_make_callback runs the tick queue, and the surrounding
// callback scope's close performs the microtask checkpoint — the N-API analogue
// of node-gtk's CallMicrotaskHandlers (process._tickCallback +
// Isolate::PerformMicrotaskCheckpoint). Best-effort: skipped if a JS exception is
// already pending (it will surface when the blocking run() returns).
//
// Limitation (node-gtk #442/#121): when the blocking run() is nested inside an
// outer async callback scope (node:test, an await, a signal handler), V8 defers
// the checkpoint to that outer scope, so promise continuations queued before the
// run() do not drain until run() returns. nextTick still drains; timers/I/O the
// loop dispatches are unaffected. The robust fix lives in L1 (defer the run() to
// a macrotask when a microtask checkpoint is in progress).
static void DrainMicrotasks() {
  if (g_loop_env == nullptr || g_tick_callback_ref == nullptr || g_process_ref == nullptr) return;
  napi_env env = g_loop_env;
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) != napi_ok || pending) return;

  napi_handle_scope scope;
  if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value process_v = nullptr, tick = nullptr, result = nullptr;
  if (napi_get_reference_value(env, g_process_ref, &process_v) == napi_ok &&
      napi_get_reference_value(env, g_tick_callback_ref, &tick) == napi_ok &&
      process_v != nullptr && tick != nullptr) {
    napi_make_callback(env, nullptr, process_v, tick, 0, nullptr, &result);
  }
  napi_close_handle_scope(env, scope);
}

static gboolean uv_source_prepare(GSource* base, gint* timeout) {
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  uv_update_time(s->loop);
  DrainMicrotasks();

  gboolean alive = uv_loop_alive(s->loop);
  // Toggle whether GLib polls uv's backend fd: an unref'd-but-active uv handle
  // keeps the backend fd perpetually ready, which would busy-spin GLib at 100%
  // CPU when the loop is otherwise dead. Mask the fd while dead so GLib actually
  // blocks until a GLib source wakes us; restore it the moment uv is alive again.
  if (s->fd_tag != nullptr && alive != s->fd_polled) {
    g_source_modify_unix_fd(
        &s->source, s->fd_tag,
        alive ? static_cast<GIOCondition>(G_IO_IN | G_IO_OUT | G_IO_ERR) : static_cast<GIOCondition>(0));
    s->fd_polled = alive;
  }

  if (!alive) {
    *timeout = -1;  // sleep until a GLib source wakes us
    return FALSE;
  }
  int t = uv_backend_timeout(s->loop);
  *timeout = t;
  return t == 0;  // ready immediately when uv has work due now
}

static gboolean uv_source_dispatch(GSource* base, GSourceFunc /*callback*/, gpointer /*user_data*/) {
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  uv_run(s->loop, UV_RUN_NOWAIT);
  DrainMicrotasks();
  return G_SOURCE_CONTINUE;
}

static GSourceFuncs uv_source_funcs = {
    uv_source_prepare, nullptr, uv_source_dispatch, nullptr, nullptr, nullptr,
};

// startMainLoop() -> void
// Attach the libuv-backed GSource to the default GLib main context (idempotent).
// Harmless until a GLib main loop actually runs — it adds no uv handle, so it
// neither keeps Node alive nor runs uv on its own; it only pumps uv while a GLib
// loop is iterating. The L1 layer calls this once when a namespace is required.
Napi::Value StartMainLoop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_loop_started) return env.Undefined();

  uv_loop_t* loop = nullptr;
  if (napi_get_uv_event_loop(env, &loop) != napi_ok || loop == nullptr) {
    Napi::Error::New(env, "failed to obtain the libuv event loop").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Capture env + process._tickCallback for nextTick/microtask draining.
  g_loop_env = env;
  napi_value global = nullptr, process_v = nullptr, tick = nullptr;
  if (napi_get_global(env, &global) == napi_ok &&
      napi_get_named_property(env, global, "process", &process_v) == napi_ok &&
      process_v != nullptr) {
    napi_create_reference(env, process_v, 1, &g_process_ref);
    if (napi_get_named_property(env, process_v, "_tickCallback", &tick) == napi_ok) {
      napi_valuetype vt;
      if (napi_typeof(env, tick, &vt) == napi_ok && vt == napi_function) {
        napi_create_reference(env, tick, 1, &g_tick_callback_ref);
      }
    }
  }

  GSource* source = g_source_new(&uv_source_funcs, sizeof(UvLoopSource));
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(source);
  s->loop = loop;
  s->fd_polled = TRUE;
  // uv_backend_fd is the epoll/kqueue fd on POSIX. (Windows uses a different
  // wake mechanism — node-gtk guards it; this milestone targets Linux/Fedora.)
  s->fd_tag = g_source_add_unix_fd(source, uv_backend_fd(loop),
                                   static_cast<GIOCondition>(G_IO_IN | G_IO_OUT | G_IO_ERR));
  g_source_attach(source, nullptr);  // default GLib main context
  g_source_unref(source);            // the context holds the surviving ref

  g_loop_started = TRUE;
  return env.Undefined();
}

}  // namespace

// Toggle-queue shutdown: disable toggles before the env tears down so no
// toggle-notify touches a dead env (GJS's gjs_object_shutdown_toggle_queue), and
// close the drain async so the libuv loop can exit cleanly. Any still-queued
// teardowns are intentionally dropped (the process/env is going away).
//
// Sequencing (the fix for the shutdown TOCTOU / data race): under g_queue_mutex,
// set shutdown=true and clear g_drain_async_inited (disabling all further sends)
// BEFORE uv_close runs outside the lock. WakeDrain checks both flags under the same
// lock, so once the flag is cleared no thread can uv_async_send the handle, and
// uv_close only runs after that point — no send can race the close.
static void OnEnvShutdown(void* arg) {
  // Only the env that OWNS the toggle machinery may tear it down — a worker env
  // exiting must not disable the owner's drain async or set the global flag.
  if (g_owner_env.load() != static_cast<napi_env>(arg)) return;
  bool close_async = false;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    g_toggle_shutdown.store(true);
    if (g_drain_async_inited) {
      g_drain_async_inited = false;  // disable further sends FIRST (under the lock)
      close_async = true;
    }
  }
  if (close_async) {
    uv_close(reinterpret_cast<uv_handle_t*>(&g_drain_async), nullptr);
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
  exports.Set("callFunction", Napi::Function::New(env, CallFunction));
  exports.Set("callMethod", Napi::Function::New(env, CallMethod));
  exports.Set("callStaticMethod", Napi::Function::New(env, CallStaticMethod));
  exports.Set("newObject", Napi::Function::New(env, NewObject));
  exports.Set("registerClass", Napi::Function::New(env, RegisterClass));
  exports.Set("constructType", Napi::Function::New(env, ConstructType));
  exports.Set("callParentVfunc", Napi::Function::New(env, CallParentVfunc));
  exports.Set("getTemplateChild", Napi::Function::New(env, GetTemplateChild));
  exports.Set("getProperty", Napi::Function::New(env, GetProperty));
  exports.Set("setProperty", Napi::Function::New(env, SetProperty));
  exports.Set("hasProperty", Napi::Function::New(env, HasProperty));
  exports.Set("getTypeName", Napi::Function::New(env, GetTypeName));
  exports.Set("isInstanceOf", Napi::Function::New(env, IsInstanceOf));
  exports.Set("isGObjectHandle", Napi::Function::New(env, IsGObjectHandle));
  // Test-only (cross-thread GC stress) — see StressRefUnrefOffThread.
  exports.Set("__stressRefUnrefOffThread", Napi::Function::New(env, StressRefUnrefOffThread));
  exports.Set("__stressRefUnrefRunning", Napi::Function::New(env, StressRefUnrefRunning));
  exports.Set("__stressRefUnrefProgress", Napi::Function::New(env, StressRefUnrefProgress));
  exports.Set("__stressRefUnrefStop", Napi::Function::New(env, StressRefUnrefStop));
  exports.Set("callBoxedMethod", Napi::Function::New(env, CallBoxedMethod));
  exports.Set("isBoxedHandle", Napi::Function::New(env, IsBoxedHandle));
  exports.Set("variantNew", Napi::Function::New(env, VariantNew));
  exports.Set("variantUnpack", Napi::Function::New(env, VariantUnpack));
  exports.Set("variantGetTypeString", Napi::Function::New(env, VariantGetTypeString));
  exports.Set("isVariantHandle", Napi::Function::New(env, IsVariantHandle));
  exports.Set("startMainLoop", Napi::Function::New(env, StartMainLoop));
  exports.Set("connectSignal", Napi::Function::New(env, ConnectSignal));
  exports.Set("emitSignal", Napi::Function::New(env, EmitSignal));
  exports.Set("disconnectSignal", Napi::Function::New(env, DisconnectSignal));
  return exports;
}

NODE_API_MODULE(node_gi, Init)
