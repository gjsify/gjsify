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

#include <girepository/girepository.h>
#include <glib-object.h>
#include <glib.h>

#include <string>

namespace {

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

}  // namespace

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("requireNamespace", Napi::Function::New(env, RequireNamespace));
  exports.Set("listInfoNames", Napi::Function::New(env, ListInfoNames));
  exports.Set("prependSearchPath", Napi::Function::New(env, PrependSearchPath));
  return exports;
}

NODE_API_MODULE(node_gi, Init)
