// SPDX-License-Identifier: MIT
// Gtk.Widget composite-template API via dlsym: template init + template children.

#include "common.h"

namespace nodegi {

// Resolve the GTK template API once (C++11 function-local static init is
// thread-safe; node-gi calls these only on the main thread). How the library
// handle is obtained — and why the leaf name has to be per-OS — is documented at
// the dlopen below.
const GtkTemplateApi* GetGtkTemplateApi() {
  static GtkTemplateApi api = {};
  static bool initialised = false;
  if (initialised) return &api;
  initialised = true;
#ifdef _WIN32
  // The Gtk.Widget composite-template API is resolved lazily via dlsym on POSIX
  // only. GTK on Windows is Phase 2; the Phase-1 Windows CI proves the display-
  // free core, which never exercises templates. api.ok stays false → template
  // callers warn + no-op / throw a clear "template API unavailable" error.
  return &api;
#else
  // The library's LEAF NAME IS PER-OS, and hardcoding the ELF soname made the
  // whole composite-template API unavailable on macOS: `libgtk-4.so.1` does not
  // exist there, so every `registerClass({ Template })` widget failed with
  // "the libgtk-4 template API is unavailable" on a host with GTK 4 correctly
  // installed. Invisible until v0.27.0 shipped the first darwin-x64 addon.
  //
  // Candidates are the leaf names GTK 4 actually installs, newest ABI first.
#ifdef __APPLE__
  static const char* const kGtkLeaves[] = {"libgtk-4.1.dylib", "libgtk-4.dylib"};
#else
  static const char* const kGtkLeaves[] = {"libgtk-4.so.1", "libgtk-4.so"};
#endif
  void* lib = nullptr;
  for (const char* leaf : kGtkLeaves) {
    // RTLD_NOLOAD first — requireGi('Gtk','4.0') already dlopened libgtk-4 via the
    // typelib, so this only bumps the refcount; the plain dlopen behind it serves a
    // caller that never required Gtk through the typelib.
    lib = dlopen(leaf, RTLD_LAZY | RTLD_NOLOAD);
    if (lib == nullptr) lib = dlopen(leaf, RTLD_LAZY);
    if (lib != nullptr) break;
  }
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
  api.set_template_scope = reinterpret_cast<decltype(api.set_template_scope)>(
      dlsym(lib, "gtk_widget_class_set_template_scope"));
  api.builder_get_current_object = reinterpret_cast<decltype(api.builder_get_current_object)>(
      dlsym(lib, "gtk_builder_get_current_object"));
  api.builder_scope_get_type = reinterpret_cast<decltype(api.builder_scope_get_type)>(
      dlsym(lib, "gtk_builder_scope_get_type"));
  api.ok = api.set_template != nullptr && api.set_template_from_resource != nullptr &&
           api.bind_template_child_full != nullptr && api.set_css_name != nullptr &&
           api.init_template != nullptr && api.get_template_child != nullptr;
  return &api;
#endif  // _WIN32
}

// The live JS env stamped on a template-callback scope (refreshed each construct).
GQuark NodeGiScopeEnvQuark() {
  static GQuark q = g_quark_from_static_string("node-gi-scope-env");
  return q;
}

// Instantiate the Gtk.Widget template on a freshly-constructed instance (see the
// forward declaration above ConstructGObject). A no-op unless the instance's
// registered type carries node-gi template data, so it is safe on every GObject
// construction. Uses the instance's actual type's class data (single-level
// registered templated type — the construct() case).
void MaybeInitTemplate(Napi::Env env, GObject* obj) {
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd == nullptr || !cd->hasTemplate) return;
  const GtkTemplateApi* gtk = GetGtkTemplateApi();
  if (!gtk->ok) return;
  // Only a Gtk.Widget can be init_template'd (class_init also skips a non-widget
  // template). g_type_from_name is 0 if GTK never loaded → guard is false → skip.
  GType widgetType = g_type_from_name("GtkWidget");
  if (widgetType == 0 || !g_type_is_a(G_OBJECT_TYPE(obj), widgetType)) return;
  // Stamp the live JS env on the template-callback scope BEFORE init_template runs:
  // GtkBuilder resolves every `<signal handler="…">` synchronously inside
  // init_template by calling the scope's create_closure, which needs this env to
  // call back into the L1 resolver. Refreshed each construct so the scope always
  // dispatches in the env that built this instance (GTK template construction is
  // main-thread/single-env; a stale capture would only matter for a cross-env
  // build, which GTK does not do).
  if (cd->templateScope != nullptr) {
    g_object_set_qdata(cd->templateScope, NodeGiScopeEnvQuark(),
                       reinterpret_cast<void*>(static_cast<napi_env>(env)));
  }
  gtk->init_template(obj);
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

}  // namespace nodegi
