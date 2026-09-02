/* SPDX-License-Identifier: MIT
 *
 * The backend for every host that is not win32.
 *
 * WHY THIS FILE EXISTS AT ALL, given that ADR 0035 targets exactly one operating
 * system. `g-ir-scanner` does not merely parse the header: it COMPILES AND RUNS
 * a dumper program linked against the library, and that run is where the GType
 * hierarchy, the signals and the installed properties come from. A GIR scanned
 * without it (`--header-only`) carries the functions and loses `load-changed`,
 * `script-message-received` and every property — i.e. loses most of what
 * `@gjsify/iframe` uses.
 *
 * The scanner therefore has to link and run this library somewhere. That
 * somewhere is Fedora, for the same reason `@gjsify/webgl`'s win32 build emits
 * its C and its GIR on Fedora and compiles them with MSVC: the host that HAS the
 * tool produces the intermediate. So the GObject half links against this file on
 * Linux, the scanner runs, and the GIR it produces is compiled to a typelib on
 * Windows beside the real DLL.
 *
 * WHAT THIS FILE MUST NEVER BECOME is a second implementation. It registers no
 * behaviour, holds no state and has exactly one code path: say what is missing,
 * once, and fail. Nothing here is ever loaded by an application — the only
 * program that loads it is the scanner's dumper, which calls `…_get_type()` and
 * exits.
 */

#include "gjsify-webview2-backend.h"

#define GJSIFY_WEBVIEW2_UNSUPPORTED_REASON                                            \
    "@gjsify/webview2-native binds Microsoft's WebView2, which exists only on "        \
    "Windows. This build of the library is the one g-ir-scanner links to produce "     \
    "WebKit-6.0.gir; it has no engine behind it and never ships. On Linux, "           \
    "@gjsify/iframe uses the real gi://WebKit 6.0; on macOS it uses "                  \
    "@gjsify/webkit-native."

struct _GjsifyWebView2Backend {
    int unused;
};

/* Every entry point below routes here, so there is exactly one text and exactly
 * one place a reader has to look. */
static void gjsify_webview2_unsupported(void)
{
    static gsize warned = 0;
    if (g_once_init_enter(&warned)) {
        g_warning("%s", GJSIFY_WEBVIEW2_UNSUPPORTED_REASON);
        g_once_init_leave(&warned, 1);
    }
}

static void gjsify_webview2_unsupported_task(GTask *task)
{
    gjsify_webview2_unsupported();
    g_task_return_new_error(
        task, G_IO_ERROR, G_IO_ERROR_NOT_SUPPORTED, "%s", GJSIFY_WEBVIEW2_UNSUPPORTED_REASON);
    g_object_unref(task);
}

void gjsify_webview2_pump_ref(void)
{
}

void gjsify_webview2_pump_unref(void)
{
}

GjsifyWebView2MessagePumpState gjsify_webview2_pump_state(void)
{
    return GJSIFY_WEBVIEW2_MESSAGE_PUMP_DETACHED;
}

gboolean gjsify_webview2_pump_require(GError **error)
{
    g_set_error_literal(
        error, G_IO_ERROR, G_IO_ERROR_NOT_SUPPORTED, GJSIFY_WEBVIEW2_UNSUPPORTED_REASON);
    return FALSE;
}

GjsifyWebView2Backend *gjsify_webview2_backend_new(GjsifyWebView2WebView *view, GError **error)
{
    (void) view;
    gjsify_webview2_unsupported();
    g_set_error_literal(
        error, G_IO_ERROR, G_IO_ERROR_NOT_SUPPORTED, GJSIFY_WEBVIEW2_UNSUPPORTED_REASON);
    return NULL;
}

void gjsify_webview2_backend_free(GjsifyWebView2Backend *backend)
{
    (void) backend;
}

void gjsify_webview2_backend_load_uri(GjsifyWebView2Backend *backend, const gchar *uri)
{
    (void) backend;
    (void) uri;
    gjsify_webview2_unsupported();
}

void gjsify_webview2_backend_load_html(
    GjsifyWebView2Backend *backend, const gchar *content, const gchar *base_uri)
{
    (void) backend;
    (void) content;
    (void) base_uri;
    gjsify_webview2_unsupported();
}

void gjsify_webview2_backend_reload(GjsifyWebView2Backend *backend)
{
    (void) backend;
    gjsify_webview2_unsupported();
}

void gjsify_webview2_backend_evaluate(
    GjsifyWebView2Backend *backend, const gchar *script, GTask *task)
{
    (void) backend;
    (void) script;
    gjsify_webview2_unsupported_task(task);
}

void gjsify_webview2_backend_snapshot(
    GjsifyWebView2Backend *backend,
    GjsifyWebView2SnapshotRegion region,
    GjsifyWebView2SnapshotOptions options,
    GTask *task)
{
    (void) backend;
    (void) region;
    (void) options;
    gjsify_webview2_unsupported_task(task);
}

void gjsify_webview2_backend_set_parent(GjsifyWebView2Backend *backend, GdkSurface *surface)
{
    (void) backend;
    (void) surface;
}

void gjsify_webview2_backend_set_bounds(
    GjsifyWebView2Backend *backend, int x, int y, int width, int height)
{
    (void) backend;
    (void) x;
    (void) y;
    (void) width;
    (void) height;
}

void gjsify_webview2_backend_set_visible(GjsifyWebView2Backend *backend, gboolean visible)
{
    (void) backend;
    (void) visible;
}

void gjsify_webview2_backend_apply_settings(
    GjsifyWebView2Backend *backend,
    gboolean enable_javascript,
    gboolean enable_developer_extras,
    gboolean enable_write_console_messages_to_stdout)
{
    (void) backend;
    (void) enable_javascript;
    (void) enable_developer_extras;
    (void) enable_write_console_messages_to_stdout;
}

void gjsify_webview2_backend_add_script(
    GjsifyWebView2Backend *backend,
    const gchar *source,
    gboolean top_frame_only,
    gboolean at_document_start)
{
    (void) backend;
    (void) source;
    (void) top_frame_only;
    (void) at_document_start;
}

void gjsify_webview2_backend_remove_all_scripts(GjsifyWebView2Backend *backend)
{
    (void) backend;
}

void gjsify_webview2_backend_register_message_handler(
    GjsifyWebView2Backend *backend, const gchar *name)
{
    (void) backend;
    (void) name;
}

void gjsify_webview2_backend_unregister_message_handler(
    GjsifyWebView2Backend *backend, const gchar *name)
{
    (void) backend;
    (void) name;
}
