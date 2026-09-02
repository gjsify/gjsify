// SPDX-License-Identifier: MIT
// Repository / introspection entry points + per-env instance-data helpers.

#include "common.h"

namespace nodegi {

// gi_repository_dup_default() returns a new owning ref to the process-default
// GIRepository (lazily created). Callers must g_object_unref() it.
GIRepository* DupDefaultRepository() { return gi_repository_dup_default(); }

void NodeGiEnvDataFinalize(napi_env env, void* data, void* /*hint*/) {
  NodeGiEnvData* d = static_cast<NodeGiEnvData*>(data);
  if (d == nullptr) return;
  if (d->errorBuilder != nullptr) napi_delete_reference(env, d->errorBuilder);
  if (d->errorClass != nullptr) napi_delete_reference(env, d->errorClass);
  if (d->templateCallbackResolver != nullptr)
    napi_delete_reference(env, d->templateCallbackResolver);
  if (d->cairoWrappers != nullptr) napi_delete_reference(env, d->cairoWrappers);
  if (d->microtaskDrain != nullptr) napi_delete_reference(env, d->microtaskDrain);
  if (d->constructCallback != nullptr) napi_delete_reference(env, d->constructCallback);
  delete d;
}

// This env's instance data (created in Init); null only if Init's set failed.
NodeGiEnvData* EnvData(napi_env env) {
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

// setErrorBuilder(builder: (domainName, domainQuark, code, message) => Error,
//                 errorClass?: typeof GLib.Error) -> void
// Register the L1 GLib.Error factory the engine calls when a GI invoke fails, so a
// failed sync call throws a real GLib.Error, together with the class it builds —
// which the GError IN-arg path needs to recognise one coming back. Both stored
// per-env (a napi_ref is env-specific; both paths are gated on the same env), in
// ONE call so a registration cannot supply the builder and forget the class.
Napi::Value SetErrorBuilder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "setErrorBuilder(builder: function, errorClass?: function)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr) return env.Undefined();  // instance data unavailable (Init failed)
  if (d->errorBuilder != nullptr) {
    napi_delete_reference(env, d->errorBuilder);
    d->errorBuilder = nullptr;
  }
  napi_create_reference(env, info[0], 1, &d->errorBuilder);
  if (d->errorClass != nullptr) {
    napi_delete_reference(env, d->errorClass);
    d->errorClass = nullptr;
  }
  if (info.Length() >= 2 && info[1].IsFunction())
    napi_create_reference(env, info[1], 1, &d->errorClass);
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

// prependLibraryPath(path: string) -> void
// The LIBRARY twin of PrependSearchPath: where GI looks for the shared object a
// typelib names, as opposed to where it looks for the typelib itself.
//
// Native rather than `requireGi('GIRepository').…` because the bundled runtime
// ships GIRepository 3.0, whose `Repository` this bridge exposes neither as
// constructible nor with a `get_default()` static — measured, both throw. The C
// entry point has no such gap and reuses the same `DupDefaultRepository()` handle.
//
// It is the env-free repair for a typelib backer named by BARE LEAF: no variable,
// no re-exec, identical on node, bun and deno. See `gtk-runtime.js`
// (`activateGiLibraryPath`) for the incident.
Napi::Value PrependLibraryPath(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "prependLibraryPath(path: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  gi_repository_prepend_library_path(repo, path.c_str());
  g_object_unref(repo);
  return env.Undefined();
}

}  // namespace nodegi
