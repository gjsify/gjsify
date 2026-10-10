// SPDX-License-Identifier: MIT
// Android only: route GLib's messages into logcat.
//
// On Android an app's stdout/stderr go to /dev/null unless something redirects them,
// so GLib's default handlers — which write to stderr — lose every g_warning,
// g_critical and g_message a GI call produces. The failure mode is the expensive one:
// GTK reports precisely why it refused to start, and the report never leaves the
// process. GTK's own Android runtime installs these four handlers in startRuntime()
// (refs/gtk/gdk/android/gdkandroidruntime.c), but startRuntime also loads an
// application library and spawns GTK's own thread, so a node-gi host must not call
// it — this is the piece of it that a host still needs.
//
// Installed from Init, not on request: a host that has not asked for logging still
// wants to be told why GI failed, and there is no other sink on this platform.
// g_log_set_default_handler / g_log_set_writer_func are process-global and
// last-call-wins, so a later logSetWriterFunc (private.cc) still overrides this.

#include "common.h"

#ifdef __ANDROID__

#include <android/log.h>

namespace nodegi {

static void AndroidPrintHandler(const char* message) {
  __android_log_print(ANDROID_LOG_INFO, "print", "%s", message);
}

static void AndroidPrinterrHandler(const char* message) {
  __android_log_print(ANDROID_LOG_WARN, "print", "%s", message);
}

static int AndroidPriority(GLogLevelFlags log_level) {
  if (log_level & G_LOG_LEVEL_ERROR) return ANDROID_LOG_FATAL;
  if (log_level & G_LOG_LEVEL_CRITICAL) return ANDROID_LOG_ERROR;
  if (log_level & G_LOG_LEVEL_WARNING) return ANDROID_LOG_WARN;
  if (log_level & G_LOG_LEVEL_MESSAGE) return ANDROID_LOG_INFO;
  if (log_level & G_LOG_LEVEL_INFO) return ANDROID_LOG_INFO;
  if (log_level & G_LOG_LEVEL_DEBUG) return ANDROID_LOG_DEBUG;
  return ANDROID_LOG_WARN;
}

static void AndroidLogHandler(const gchar* log_domain, GLogLevelFlags log_level,
                              const gchar* message, gpointer) {
  __android_log_print(AndroidPriority(log_level),
                      log_domain != nullptr ? log_domain : "**", "%s", message);
}

static GLogWriterOutput AndroidLogWriter(GLogLevelFlags log_level, const GLogField* fields,
                                         gsize n_fields, gpointer) {
  const gchar* domain = nullptr;
  const gchar* message = nullptr;
  for (gsize i = 0; (domain == nullptr || message == nullptr) && i < n_fields; i++) {
    if (g_strcmp0(fields[i].key, "GLIB_DOMAIN") == 0)
      domain = static_cast<const gchar*>(fields[i].value);
    else if (g_strcmp0(fields[i].key, "MESSAGE") == 0)
      message = static_cast<const gchar*>(fields[i].value);
  }
  // liblog answers with the bytes it wrote, or a negative errno: anything above zero is
  // a delivery. Reporting UNHANDLED on one sends GLib to its default writer, i.e. to the
  // stderr this whole file exists because of.
  int rc = __android_log_print(AndroidPriority(log_level),
                               domain != nullptr ? domain : "**", "%s",
                               message != nullptr ? message : "(empty)");
  return rc > 0 ? G_LOG_WRITER_HANDLED : G_LOG_WRITER_UNHANDLED;
}

// androidLogBridge() -> boolean — whether GLib's messages reach logcat.
static Napi::Value AndroidLogBridge(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

void InitAndroidLog(Napi::Env env, Napi::Object exports) {
  g_set_print_handler(AndroidPrintHandler);
  g_set_printerr_handler(AndroidPrinterrHandler);
  g_log_set_default_handler(AndroidLogHandler, nullptr);
  g_log_set_writer_func(AndroidLogWriter, nullptr, nullptr);
  exports.Set("androidLogBridge", Napi::Function::New(env, AndroidLogBridge));
}

}  // namespace nodegi

#else

namespace nodegi {

static Napi::Value AndroidLogBridge(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), false);
}

// Off Android stderr is a real sink and GLib's own handlers are the right ones; the
// export stays so a caller can ask without branching on the platform first.
void InitAndroidLog(Napi::Env env, Napi::Object exports) {
  exports.Set("androidLogBridge", Napi::Function::New(env, AndroidLogBridge));
}

}  // namespace nodegi

#endif
