/* SPDX-License-Identifier: MIT
 *
 * The seam between the portable GObject layer and the engine.
 *
 * NOT INSTALLED and NOT SCANNED — this is internal. It is pure C for one
 * reason: `src/cpp/gjsify-webview2-win32.cpp` includes it from C++, so every
 * declaration here has to mean the same thing to both compilers. The public
 * header next to it is pure C for a different reason (g-ir-scanner), and the two
 * constraints happen to agree.
 *
 * WHY THERE IS A SEAM AT ALL, given that ADR 0035 targets exactly one operating
 * system: g-ir-scanner builds and RUNS a dumper program against the library to
 * read the GType hierarchy, the signals and the properties out of it. MSVC and
 * gvsbuild give us a compiler on `windows-latest` but no scanner we can rely on,
 * and the shape this repository already uses for that (`@gjsify/webgl`'s two-job
 * win32 build) is: a host that HAS the tool emits the intermediate, and the
 * Windows half compiles it. Here the intermediate is the GIR, the host that has
 * the tool is Fedora, and this seam is what lets Fedora LINK the library at all.
 *
 * So `gjsify-webview2-unsupported.c` is not a second implementation and must
 * never grow into one: it registers no behaviour, it fails every call loudly by
 * one shared route, and the only program that ever loads it is g-ir-scanner's
 * dumper.
 */

#ifndef GJSIFY_WEBVIEW2_BACKEND_H
#define GJSIFY_WEBVIEW2_BACKEND_H

#include "gjsify-webview2.h"

G_BEGIN_DECLS

typedef struct _GjsifyWebView2Backend GjsifyWebView2Backend;

/* ---------------------------------------------------------------------------
 * The loop bridge.
 *
 * Refcounted on LIVE VIEWS, and attached to the #GMainContext that was
 * thread-default when the first one was constructed. ADR 0035 § What the spike
 * answered is why it hangs off the view rather than off the environment: the
 * environment and controller callbacks arrive with no pump at all, so a backend
 * that installed the source lazily "when something needs it" would install it
 * after the only operations that do not.
 * ------------------------------------------------------------------------- */

void gjsify_webview2_pump_ref(void);
void gjsify_webview2_pump_unref(void);

/* The state a view reports, and the predicate every content-level entry point
 * checks before starting work it cannot finish. */
GjsifyWebView2MessagePumpState gjsify_webview2_pump_state(void);

/* Fills @error and returns %FALSE unless the pump is ATTACHED. One text, one
 * place: the message names the state, what WebView2 needs, and what the caller
 * has to do — it is the whole reason this is an error and not a timeout. */
gboolean gjsify_webview2_pump_require(GError **error);

/* ---------------------------------------------------------------------------
 * The engine, per view.
 * ------------------------------------------------------------------------- */

/* @error is filled when the engine cannot be reached at all — no Evergreen
 * runtime, no environment. The view still constructs (a GObject constructor
 * cannot fail), records the error, and returns it from every operation, which is
 * how "a namespace that resolves, advertises its classes and dies in the
 * constructor" is avoided (ADR 0035 decision 5). */
GjsifyWebView2Backend *gjsify_webview2_backend_new(GjsifyWebView2WebView *view, GError **error);
void gjsify_webview2_backend_free(GjsifyWebView2Backend *backend);

void gjsify_webview2_backend_load_uri(GjsifyWebView2Backend *backend, const gchar *uri);
void gjsify_webview2_backend_load_html(
    GjsifyWebView2Backend *backend, const gchar *content, const gchar *base_uri);
void gjsify_webview2_backend_reload(GjsifyWebView2Backend *backend);

/* Both take ownership of @task and complete it, possibly after returning. */
void gjsify_webview2_backend_evaluate(
    GjsifyWebView2Backend *backend, const gchar *script, GTask *task);
void gjsify_webview2_backend_snapshot(
    GjsifyWebView2Backend *backend,
    GjsifyWebView2SnapshotRegion region,
    GjsifyWebView2SnapshotOptions options,
    GTask *task);

/* Stage-1 hosting. @surface is the toplevel's #GdkSurface, or %NULL to park the
 * content on the view's own hidden host window — which is what an unmapped or
 * display-less view uses, and what makes a view usable headlessly at all.
 *
 * A #GdkSurface rather than the `HWND` itself, because `gdk_win32_surface_get_handle()`
 * lives in `gdk/win32/gdkwin32.h`, which does not exist on the host that builds
 * this library for the scanner. The cast is one line on the far side of the
 * seam; the include would be a `#ifdef` ladder on this side. */
void gjsify_webview2_backend_set_parent(GjsifyWebView2Backend *backend, GdkSurface *surface);
void gjsify_webview2_backend_set_bounds(
    GjsifyWebView2Backend *backend, int x, int y, int width, int height);
void gjsify_webview2_backend_set_visible(GjsifyWebView2Backend *backend, gboolean visible);

/* Settings and user content are pushed rather than pulled: the portable layer
 * owns the GObjects a consumer talks to, and tells the engine when they change,
 * so the engine never has to reach back across the seam. */
void gjsify_webview2_backend_apply_settings(
    GjsifyWebView2Backend *backend,
    gboolean enable_javascript,
    gboolean enable_developer_extras,
    gboolean enable_write_console_messages_to_stdout);

void gjsify_webview2_backend_add_script(
    GjsifyWebView2Backend *backend,
    const gchar *source,
    gboolean top_frame_only,
    gboolean at_document_start);
void gjsify_webview2_backend_remove_all_scripts(GjsifyWebView2Backend *backend);
void gjsify_webview2_backend_register_message_handler(
    GjsifyWebView2Backend *backend, const gchar *name);
void gjsify_webview2_backend_unregister_message_handler(
    GjsifyWebView2Backend *backend, const gchar *name);

/* ---------------------------------------------------------------------------
 * The way back. Implemented in the portable layer, called by the engine —
 * always on the thread the view was created on.
 * ------------------------------------------------------------------------- */

void gjsify_webview2_web_view_emit_load_changed(
    GjsifyWebView2WebView *self, GjsifyWebView2LoadEvent event);
void gjsify_webview2_web_view_emit_load_failed(
    GjsifyWebView2WebView *self,
    GjsifyWebView2LoadEvent event,
    const gchar *failing_uri,
    const gchar *message);
void gjsify_webview2_web_view_set_current_uri(GjsifyWebView2WebView *self, const gchar *uri);
void gjsify_webview2_web_view_emit_script_message(
    GjsifyWebView2WebView *self, const gchar *handler_name, const gchar *json_body);

/* The engine's only constructor for the value type: it always has JSON in hand,
 * never a live JS value. */
GjsifyWebView2Value *gjsify_webview2_value_new_from_json(const gchar *json);

G_END_DECLS

#endif /* GJSIFY_WEBVIEW2_BACKEND_H */
