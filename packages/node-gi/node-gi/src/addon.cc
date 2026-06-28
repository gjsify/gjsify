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
// Milestone 1 (headless core, scaffold step): prove the toolchain + the modern
// GIRepository API end to end — resolve the default repository, require a
// namespace, read back its resolved version + introspection-info count, and
// enumerate the top-level info names. Marshalling, GObject/signals, the
// toggle-ref GC dance, and the mainloop bridge land in subsequent steps.

#include <napi.h>
#include <uv.h>

#include <girepository/girepository.h>
#include <glib-object.h>
#include <glib.h>

#include <string>
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
        if (h->owns && h->ptr != nullptr && h->gtype != G_TYPE_INVALID &&
            G_TYPE_IS_BOXED(h->gtype)) {
          g_boxed_free(h->gtype, h->ptr);
        }
        delete h;
      });
  ext.TypeTag(&kBoxedHandleTag);
  return ext;
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
  bool boxed = gt != G_TYPE_INVALID && gt != G_TYPE_NONE && G_TYPE_IS_BOXED(gt);
  bool owns = boxed && transfer == GI_TRANSFER_EVERYTHING;
  return MakeBoxedHandle(env, ptr, boxed ? gt : G_TYPE_INVALID, owns);
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

static bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                           std::string* heldString) {
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
      *heldString = v.ToString().Utf8Value();
      out->v_string = const_cast<char*>(heldString->c_str());
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
            gpointer p = nullptr;
            if (TryGetBoxedPtr(v, &p)) {
              out->v_pointer = p;
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

// Create the owned, type-tagged External that represents a live GObject. The
// finalizer drops the single ref we hold; N-API finalizers run outside GC, so
// the unref (and any resulting GObject finalize) is safe here.
static Napi::Value MakeGObjectHandle(Napi::Env env, GObject* obj) {
  Napi::External<GObject> ext = Napi::External<GObject>::New(
      env, obj, [](Napi::Env, GObject* ptr) { g_object_unref(ptr); });
  ext.TypeTag(&kGObjectHandleTag);
  return ext;
}

// Wrap a borrowed/owned GObject pointer as a node-gi handle. Floating refs are
// sunk; a transfer-none borrow is ref'd so the finalizer has a ref to drop.
static Napi::Value WrapGObject(Napi::Env env, GObject* obj, GITransfer transfer) {
  if (obj == nullptr) return env.Null();
  if (g_object_is_floating(obj)) {
    g_object_ref_sink(obj);
  } else if (transfer == GI_TRANSFER_NOTHING) {
    g_object_ref(obj);
  }
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

// Shared invocation core: marshal the JS args into a GIArgument vector (the
// instance prepended for methods), call gi_function_info_invoke, marshal the
// return. IN-only primitives/strings/objects/enums today; OUT/INOUT follow.
static Napi::Value InvokeFunctionInfo(Napi::Env env, GIFunctionInfo* func, gpointer instance,
                                      Napi::Array args, const std::string& displayName) {
  GICallableInfo* callable = reinterpret_cast<GICallableInfo*>(func);
  unsigned int n_args = gi_callable_info_get_n_args(callable);
  bool isMethod = instance != nullptr;
  size_t offset = isMethod ? 1 : 0;
  std::vector<GIArgument> in_args(n_args + offset);
  std::vector<std::string> held(n_args);
  if (isMethod) in_args[0].v_pointer = instance;

  bool ok = true;
  for (unsigned int i = 0; i < n_args; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GIDirection dir = gi_arg_info_get_direction(ai);
    if (dir != GI_DIRECTION_IN) {
      gi_base_info_unref(ai);
      Napi::TypeError::New(env, displayName + ": OUT/INOUT parameters are not yet supported")
          .ThrowAsJavaScriptException();
      ok = false;
      break;
    }
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    Napi::Value v = i < args.Length() ? args.Get(i) : env.Undefined();
    ok = JsToGIArgument(env, v, ti, &in_args[offset + i], &held[i]);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
    if (!ok) break;
  }
  if (!ok) return env.Null();

  GIArgument retval;
  GError* error = nullptr;
  gboolean success =
      gi_function_info_invoke(func, in_args.data(), in_args.size(), nullptr, 0, &retval, &error);
  if (!success) {
    std::string message = error != nullptr ? error->message : "invocation failed";
    if (error != nullptr) g_error_free(error);
    Napi::Error::New(env, "Calling " + displayName + ": " + message).ThrowAsJavaScriptException();
    return env.Null();
  }

  GITypeInfo* return_type = gi_callable_info_get_return_type(callable);
  GITransfer return_transfer = gi_callable_info_get_caller_owns(callable);
  Napi::Value result = GIArgumentToJs(env, return_type, &retval, return_transfer);
  gi_base_info_unref(return_type);
  return result;
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
// Construct GObjects, read/write their properties, and own them with an N-API
// finalizer. Unlike node-gtk's NAN/V8-weak-callback model (which must defer the
// unref to a GLib idle because V8 forbids calling into GObject during GC),
// N-API finalizers run at a safe point OUTSIDE garbage collection, so a plain
// g_object_unref in the finalizer is correct here. The toggle-ref dance is only
// needed once JS-subclassed objects / JS-connected signal closures enter the
// picture (the signals + registerClass drops); a plain owned ref suffices for
// the headless-core object lifecycle.
//
// Instances are handed back as opaque Napi::External<GObject> handles; the
// ergonomic class/prototype surface is layered in the GJS-compat runtime.

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
// properties + signals (installed in class_init — see below); vfunc overrides
// and the toggle-ref GC bridge a JS vfunc/closure requires land in the next
// drop. A plain dynamic subtype's instances are ordinary GObjects, so the
// existing finalizer-unref ownership is correct. Returns an opaque type handle
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
// plain dynamic subtype's instances ordinary GObjects (the existing
// finalizer-unref ownership stays correct). vfunc overrides + the toggle-ref GC
// bridge a JS method/closure needs land in the next drop.

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

// Per-registered-type metadata, passed as GTypeInfo.class_data → class_init.
// Heap-allocated and intentionally never freed (a GType is process-permanent).
struct NodeGiClassData {
  std::vector<GParamSpec*> properties;  // ownership transfers to the class on install
  std::vector<NodeGiSignalDef> signals;
  void (*parentGet)(GObject*, guint, GValue*, GParamSpec*);
  void (*parentSet)(GObject*, guint, const GValue*, GParamSpec*);
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
}

// registerClass(name, parentNamespace, parentTypeName, options?) -> typeHandle
Napi::Value RegisterClass(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(
        env,
        "registerClass(name: string, parentNamespace: string, parentTypeName: string, options?: "
        "{ properties?, signals? })")
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

// ---- signals (milestone 1) ----
//
// A GClosure that wraps a JS callback. The callback is held by a strong
// napi_ref; the closure's finalize notifier drops it. The generic marshal
// converts the signal's GValue params to JS (skipping the emitter instance at
// index 0) and the JS return into the signal return GValue.
//
// Caveat (documented): if the JS callback closes over the object's handle, that
// forms a handle -> GObject -> closure -> napi_ref -> callback -> handle cycle
// that V8's GC cannot break across the C boundary, so such a handler keeps the
// object alive until explicitly disconnected. The toggle-ref refinement (with
// the subclassing/registerClass drop) addresses this; for now disconnect
// long-lived handlers explicitly.

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

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("requireNamespace", Napi::Function::New(env, RequireNamespace));
  exports.Set("listInfoNames", Napi::Function::New(env, ListInfoNames));
  exports.Set("findInfo", Napi::Function::New(env, FindInfo));
  exports.Set("getConstantValue", Napi::Function::New(env, GetConstantValue));
  exports.Set("getEnumValues", Napi::Function::New(env, GetEnumValues));
  exports.Set("prependSearchPath", Napi::Function::New(env, PrependSearchPath));
  exports.Set("callFunction", Napi::Function::New(env, CallFunction));
  exports.Set("callMethod", Napi::Function::New(env, CallMethod));
  exports.Set("callStaticMethod", Napi::Function::New(env, CallStaticMethod));
  exports.Set("newObject", Napi::Function::New(env, NewObject));
  exports.Set("registerClass", Napi::Function::New(env, RegisterClass));
  exports.Set("constructType", Napi::Function::New(env, ConstructType));
  exports.Set("getProperty", Napi::Function::New(env, GetProperty));
  exports.Set("setProperty", Napi::Function::New(env, SetProperty));
  exports.Set("hasProperty", Napi::Function::New(env, HasProperty));
  exports.Set("getTypeName", Napi::Function::New(env, GetTypeName));
  exports.Set("isGObjectHandle", Napi::Function::New(env, IsGObjectHandle));
  exports.Set("callBoxedMethod", Napi::Function::New(env, CallBoxedMethod));
  exports.Set("isBoxedHandle", Napi::Function::New(env, IsBoxedHandle));
  exports.Set("startMainLoop", Napi::Function::New(env, StartMainLoop));
  exports.Set("connectSignal", Napi::Function::New(env, ConnectSignal));
  exports.Set("emitSignal", Napi::Function::New(env, EmitSignal));
  exports.Set("disconnectSignal", Napi::Function::New(env, DisconnectSignal));
  return exports;
}

NODE_API_MODULE(node_gi, Init)
