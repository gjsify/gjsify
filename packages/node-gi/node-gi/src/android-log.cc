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
//
// GLib is not the only writer: a foreign C library that does fprintf(stderr, ...) and
// abort() (libepoxy's "eglQueryDisplayAttribEXT() not found" was the case) never reaches
// a GLib handler. So fd 1 and fd 2 themselves are pointed at pipes that a reader thread
// forwards to logcat line by line.

#include "common.h"

#ifdef __ANDROID__

#include <android/log.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <mutex>
#include <string>
#include <thread>

namespace nodegi {

// Whether `fd` is the /dev/null an app process starts with. Anything else (a terminal
// under `adb shell`, a file or pipe a host or the launcher set up) is a sink somebody
// chose, and taking it over would hide output from them.
static bool IsDevNull(int fd) {
  struct stat fd_st, null_st;
  return fstat(fd, &fd_st) == 0 && stat("/dev/null", &null_st) == 0 && S_ISCHR(fd_st.st_mode) &&
         fd_st.st_rdev == null_st.st_rdev;
}

// Longest line forwarded whole; logcat truncates an entry near 4 KiB anyway, and a
// writer that never sends '\n' must not grow the buffer without bound.
static const size_t kMaxLine = 4000;

struct StdioPipe {
  int read_fd;
  int priority;
  const char* tag;
};

static void ForwardLoop(StdioPipe pipe_info) {
  std::string line;
  char buf[1024];
  for (;;) {
    ssize_t n = read(pipe_info.read_fd, buf, sizeof buf);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) break;
    for (ssize_t i = 0; i < n; i++) {
      if (buf[i] == '\n') {
        __android_log_write(pipe_info.priority, pipe_info.tag, line.c_str());
        line.clear();
      } else {
        line.push_back(buf[i]);
        if (line.size() >= kMaxLine) {
          __android_log_write(pipe_info.priority, pipe_info.tag, line.c_str());
          line.clear();
        }
      }
    }
  }
  if (!line.empty()) __android_log_write(pipe_info.priority, pipe_info.tag, line.c_str());
}

static void RedirectFd(int fd, int priority, const char* tag) {
  if (!IsDevNull(fd)) return;
  int fds[2];
  if (pipe2(fds, O_CLOEXEC) != 0) return;
  if (dup2(fds[1], fd) < 0) {
    close(fds[0]);
    close(fds[1]);
    return;
  }
  close(fds[1]);
  // Two pipes rather than one: priority is per entry, and stderr must stay WARN so a
  // logcat filter on `*:W` still shows it.
  std::thread(ForwardLoop, StdioPipe{fds[0], priority, tag}).detach();
}

// Once per process: Init runs once per env, but fd 1/2 are process-wide.
//
// Limit: abort() ends the process, and the reader thread with it. stderr is made
// unbuffered so the message at least reaches the pipe before the abort, but whether the
// reader has forwarded it by then is a race the tombstone still backs up.
static void InstallStdioRedirect() {
  static std::once_flag once;
  std::call_once(once, [] {
    RedirectFd(STDOUT_FILENO, ANDROID_LOG_INFO, "stdout");
    RedirectFd(STDERR_FILENO, ANDROID_LOG_WARN, "stderr");
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
  });
}

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
  InstallStdioRedirect();
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
