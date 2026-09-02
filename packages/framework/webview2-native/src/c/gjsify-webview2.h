/* SPDX-License-Identifier: MIT
 *
 * GjsifyWebView2 — the win32 backend for `@gjsify/iframe` (ADR 0035).
 *
 * The namespace this compiles into is `WebKit-6.0`. The engine behind it is
 * Chromium, through Microsoft's WebView2. That is not a contradiction and it is
 * not hidden: the namespace is an API-SHAPE contract (ADR 0022 decision 3 and
 * ADR 0035 decision 1), the package name says WebView2 because the engine does,
 * and the README says so in its first paragraph.
 *
 * This header is deliberately PURE C with no C++ and no COM in it.
 * g-ir-scanner runs the C preprocessor and parses C declarations; a `class`, a
 * `ComPtr` or a `#include <WebView2.h>` in a scanned header stops it dead. Every
 * WebView2 type therefore stays behind an opaque pointer in the private struct,
 * and all of it lives in `src/cpp/`. That is ADR 0022 decision 2's constraint,
 * one platform over — the reason there is the absent Objective-C front end, the
 * reason here is the absent C++/WinRT one.
 *
 * The API mirrors WebKitGTK 6.0 name for name and signature for signature, so
 * `@gjsify/iframe` selects a backend with ONE import and its ~40 call sites stay
 * untouched. Where WebKitGTK has `webkit_web_view_load_html()`, this has
 * `gjsify_webview2_web_view_load_html()` with the same arguments in the same
 * order.
 *
 * TWO NAMES HERE ARE NOT WebKitGTK'S, and both exist because stage 1 is honest
 * about what it is not (ADR 0035 decision 3 and § What the spike answered):
 * `WebKit.HostingMode` / `get_hosting_mode()` / `get_overlay_constraints()` say
 * that this view is an OS-composited overlay rather than a node in GSK's scene
 * graph, and `WebKit.MessagePumpState` / `get_message_pump_state()` say whether
 * the Win32 message queue is being dispatched for it. A consumer that never
 * asks is unaffected; a consumer whose rounded clip does nothing, or whose page
 * never loads, gets a name for it instead of a timeout.
 */

#ifndef GJSIFY_WEBVIEW2_H
#define GJSIFY_WEBVIEW2_H

#include <gtk/gtk.h>

G_BEGIN_DECLS

/**
 * GjsifyWebView2LoadEvent:
 * @GJSIFY_WEBVIEW2_LOAD_STARTED: a new load request has started.
 * @GJSIFY_WEBVIEW2_LOAD_REDIRECTED: a load request has been redirected.
 * @GJSIFY_WEBVIEW2_LOAD_COMMITTED: the content is being loaded.
 * @GJSIFY_WEBVIEW2_LOAD_FINISHED: the load finished.
 *
 * Mirrors `WebKitLoadEvent`. The numeric values match WebKitGTK's so a consumer
 * that (wrongly) compares integers still agrees across backends.
 */
typedef enum {
    GJSIFY_WEBVIEW2_LOAD_STARTED,
    GJSIFY_WEBVIEW2_LOAD_REDIRECTED,
    GJSIFY_WEBVIEW2_LOAD_COMMITTED,
    GJSIFY_WEBVIEW2_LOAD_FINISHED
} GjsifyWebView2LoadEvent;

/**
 * GjsifyWebView2SnapshotRegion:
 * @GJSIFY_WEBVIEW2_SNAPSHOT_REGION_VISIBLE: the visible viewport.
 * @GJSIFY_WEBVIEW2_SNAPSHOT_REGION_FULL_DOCUMENT: the whole scrollable document.
 */
typedef enum {
    GJSIFY_WEBVIEW2_SNAPSHOT_REGION_VISIBLE,
    GJSIFY_WEBVIEW2_SNAPSHOT_REGION_FULL_DOCUMENT
} GjsifyWebView2SnapshotRegion;

/**
 * GjsifyWebView2SnapshotOptions:
 * @GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_NONE: no special options.
 * @GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_INCLUDE_SELECTION_HIGHLIGHTING: include the selection highlight.
 * @GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_TRANSPARENT_BACKGROUND: do not paint the page background.
 */
typedef enum {
    GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_NONE = 0,
    GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_INCLUDE_SELECTION_HIGHLIGHTING = 1 << 0,
    GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_TRANSPARENT_BACKGROUND = 1 << 1
} GjsifyWebView2SnapshotOptions;

/**
 * GjsifyWebView2UserContentInjectedFrames:
 * @GJSIFY_WEBVIEW2_USER_CONTENT_INJECT_ALL_FRAMES: inject into every frame.
 * @GJSIFY_WEBVIEW2_USER_CONTENT_INJECT_TOP_FRAME: inject into the main frame only.
 */
typedef enum {
    GJSIFY_WEBVIEW2_USER_CONTENT_INJECT_ALL_FRAMES,
    GJSIFY_WEBVIEW2_USER_CONTENT_INJECT_TOP_FRAME
} GjsifyWebView2UserContentInjectedFrames;

/**
 * GjsifyWebView2UserScriptInjectionTime:
 * @GJSIFY_WEBVIEW2_USER_SCRIPT_INJECT_AT_DOCUMENT_START: run before the document loads.
 * @GJSIFY_WEBVIEW2_USER_SCRIPT_INJECT_AT_DOCUMENT_END: run after the document loads.
 */
typedef enum {
    GJSIFY_WEBVIEW2_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
    GJSIFY_WEBVIEW2_USER_SCRIPT_INJECT_AT_DOCUMENT_END
} GjsifyWebView2UserScriptInjectionTime;

/**
 * GjsifyWebView2HostingMode:
 * @GJSIFY_WEBVIEW2_HOSTING_MODE_OVERLAY: the web content is a child `HWND` the
 *   OS composites ABOVE the GTK surface. It is not in GSK's scene graph: it
 *   cannot be clipped by an ancestor, nothing can be drawn over it, and its
 *   opacity and transforms are not applied.
 * @GJSIFY_WEBVIEW2_HOSTING_MODE_COMPOSITED: the web content arrives as a
 *   #GdkTexture the widget paints in its own `snapshot` vfunc, so it behaves
 *   like any other widget. Not produced by this build — ADR 0035 stage 2.
 *
 * What a #GjsifyWebView2WebView actually is on screen. This exists because GTK's
 * failure mode here is exit 0: a rounded clip that does nothing is
 * indistinguishable from an application bug forever, so the answer has a name
 * and a reader.
 */
typedef enum {
    GJSIFY_WEBVIEW2_HOSTING_MODE_OVERLAY,
    GJSIFY_WEBVIEW2_HOSTING_MODE_COMPOSITED
} GjsifyWebView2HostingMode;

/**
 * GjsifyWebView2MessagePumpState:
 * @GJSIFY_WEBVIEW2_MESSAGE_PUMP_ATTACHED: a pump source is attached to the
 *   #GMainContext this view was created on, and this is that thread.
 * @GJSIFY_WEBVIEW2_MESSAGE_PUMP_DETACHED: no pump source is attached. Every
 *   content-level operation on this view will fail with a named error rather
 *   than wait for a callback that cannot arrive.
 * @GJSIFY_WEBVIEW2_MESSAGE_PUMP_FOREIGN_THREAD: a pump source exists, but the
 *   caller is on a different thread from the one that owns it. WebView2 is
 *   apartment-threaded; a call from here is not merely slow, it is wrong.
 *
 * WebView2 delivers content-level callbacks through the thread's Win32 message
 * queue, and `g_main_loop_run()` does not dispatch that queue. Measured on
 * `windows-latest` / Evergreen 151.0.4129.101: `NavigationCompleted` timed out
 * after 8000 ms with no pump and arrived immediately with one, while the
 * environment and controller callbacks needed none. That asymmetry is why this
 * enum exists — a backend can get all the way through its own setup before the
 * gap shows, so the gap is reported where a view becomes live instead of being
 * inferred from a stalled page.
 */
typedef enum {
    GJSIFY_WEBVIEW2_MESSAGE_PUMP_ATTACHED,
    GJSIFY_WEBVIEW2_MESSAGE_PUMP_DETACHED,
    GJSIFY_WEBVIEW2_MESSAGE_PUMP_FOREIGN_THREAD
} GjsifyWebView2MessagePumpState;

/* -------------------------------------------------------------------------
 * GjsifyWebView2Value — the result of an evaluation, and the payload of a
 * script message.
 *
 * WebKitGTK hands back a `JSCValue`. Consumers in this workspace call exactly
 * one method on it (`to_string()`), so this exposes that and the type probes
 * around it rather than re-implementing JavaScriptCore's value API — the same
 * subset ADR 0022 settled on, for the same reason.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBVIEW2_TYPE_VALUE (gjsify_webview2_value_get_type())
G_DECLARE_FINAL_TYPE(GjsifyWebView2Value, gjsify_webview2_value, GJSIFY_WEBVIEW2, VALUE, GObject)

/**
 * gjsify_webview2_value_to_string:
 * @self: a value.
 *
 * WebView2's `ExecuteScript` returns its result as JSON, where WebKitGTK
 * returns a live `JSCValue`. A JSON string is unquoted and unescaped here so a
 * string result reads the same on both backends; everything else is returned as
 * its JSON text, which is what `JSCValue.to_string()` produces for numbers and
 * booleans and is a documented divergence for objects.
 *
 * Returns: (transfer full): the value rendered as a string.
 */
gchar *gjsify_webview2_value_to_string(GjsifyWebView2Value *self);
gboolean gjsify_webview2_value_is_string(GjsifyWebView2Value *self);
gboolean gjsify_webview2_value_is_null(GjsifyWebView2Value *self);
gboolean gjsify_webview2_value_is_undefined(GjsifyWebView2Value *self);

/* -------------------------------------------------------------------------
 * GjsifyWebView2UserScript — mirrors WebKitUserScript.
 * ------------------------------------------------------------------------- */

/* A BOXED type, not a GObject — matching WebKitUserScript, which is ref-counted
 * boxed. The difference is visible in the consumer: GJS maps a boxed type's
 * `new` constructor onto `new WebKit.UserScript(source, frames, time, allow,
 * block)`, while a GObject would demand `new UserScript({property: …})`. ADR
 * 0022 records that getting this wrong compiles, installs, and then breaks the
 * one call the port exists to keep identical. */
typedef struct _GjsifyWebView2UserScript GjsifyWebView2UserScript;

#define GJSIFY_WEBVIEW2_TYPE_USER_SCRIPT (gjsify_webview2_user_script_get_type())
GType gjsify_webview2_user_script_get_type(void) G_GNUC_CONST;

/**
 * gjsify_webview2_user_script_ref:
 * @self: a script.
 *
 * Returns: (transfer full): @self with its reference count increased.
 */
GjsifyWebView2UserScript *gjsify_webview2_user_script_ref(GjsifyWebView2UserScript *self);

void gjsify_webview2_user_script_unref(GjsifyWebView2UserScript *self);

/**
 * gjsify_webview2_user_script_new:
 * @source: the script source.
 * @injected_frames: which frames to inject into.
 * @injection_time: when to inject.
 * @allow_list: (nullable) (array zero-terminated=1): URI patterns to allow, or %NULL for all.
 * @block_list: (nullable) (array zero-terminated=1): URI patterns to block, or %NULL for none.
 *
 * A NON-EMPTY LIST OF EITHER KIND MAKES THE SCRIPT REFUSED, with a warning, by
 * gjsify_webview2_user_content_manager_add_script(). WebView2's
 * `AddScriptToExecuteOnDocumentCreated` carries no URL filter, and injecting the
 * script anyway would run it on origins the caller excluded — the exact failure
 * a block list exists to prevent — so refusing narrows in the safe direction for
 * both list kinds. Porting darwin's in-script guard (the source wrapped in a
 * labelled block that tests the document's URL) is what closes this; it is
 * outside ADR 0035 decision 4's counted subset and is not in this build.
 *
 * The patterns themselves are WebKitGTK's `scheme://host/path` shape and are
 * kept unparsed: nothing here reads them, so a spelling this backend would have
 * got wrong cannot be mistaken for one it honoured.
 *
 * Returns: (transfer full): a new script.
 */
GjsifyWebView2UserScript *gjsify_webview2_user_script_new(
    const gchar *source,
    GjsifyWebView2UserContentInjectedFrames injected_frames,
    GjsifyWebView2UserScriptInjectionTime injection_time,
    const gchar *const *allow_list,
    const gchar *const *block_list);

/**
 * gjsify_webview2_user_script_new_for_world:
 * @source: the script source.
 * @injected_frames: which frames to inject into.
 * @injection_time: when to inject.
 * @world_name: (nullable): ignored, and the reason is in the description.
 * @allow_list: (nullable) (array zero-terminated=1): URI patterns to allow, or %NULL for all.
 * @block_list: (nullable) (array zero-terminated=1): URI patterns to block, or %NULL for none.
 *
 * Mirrors `webkit_user_script_new_for_world()` so the call site is portable.
 * WebView2 has no public isolated-world API — `AddScriptToExecuteOnDocumentCreated`
 * runs in the page's own world and `ExecuteScript` evaluates there too — so a
 * non-%NULL @world_name is accepted and WARNED about ONCE per name rather than
 * silently honoured. Silently running an isolated script in the page's world is
 * the failure the argument exists to prevent, and a warning is the only honest
 * report this backend can make of it.
 *
 * Returns: (transfer full): a new script.
 */
GjsifyWebView2UserScript *gjsify_webview2_user_script_new_for_world(
    const gchar *source,
    GjsifyWebView2UserContentInjectedFrames injected_frames,
    GjsifyWebView2UserScriptInjectionTime injection_time,
    const gchar *world_name,
    const gchar *const *allow_list,
    const gchar *const *block_list);

/* -------------------------------------------------------------------------
 * GjsifyWebView2UserContentManager — mirrors WebKitUserContentManager.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBVIEW2_TYPE_USER_CONTENT_MANAGER \
    (gjsify_webview2_user_content_manager_get_type())
G_DECLARE_FINAL_TYPE(
    GjsifyWebView2UserContentManager,
    gjsify_webview2_user_content_manager,
    GJSIFY_WEBVIEW2,
    USER_CONTENT_MANAGER,
    GObject)

/**
 * gjsify_webview2_user_content_manager_new:
 *
 * Returns: (transfer full): a new user content manager.
 */
GjsifyWebView2UserContentManager *gjsify_webview2_user_content_manager_new(void);

void gjsify_webview2_user_content_manager_add_script(
    GjsifyWebView2UserContentManager *self, GjsifyWebView2UserScript *script);

void gjsify_webview2_user_content_manager_remove_all_scripts(
    GjsifyWebView2UserContentManager *self);

/**
 * gjsify_webview2_user_content_manager_register_script_message_handler:
 * @self: the manager.
 * @name: the handler name, reachable from the page as
 *   `window.webkit.messageHandlers.<name>.postMessage()`.
 * @world_name: (nullable): ignored — see gjsify_webview2_user_script_new_for_world().
 *
 * The page-side spelling is WebKit's because the consumer's is: a document-start
 * script defines `window.webkit.messageHandlers.<name>` in terms of
 * `window.chrome.webview.postMessage`, and the resulting message is re-emitted
 * as #GjsifyWebView2UserContentManager::script-message-received.
 *
 * Returns: %TRUE if the handler was registered.
 */
gboolean gjsify_webview2_user_content_manager_register_script_message_handler(
    GjsifyWebView2UserContentManager *self, const gchar *name, const gchar *world_name);

void gjsify_webview2_user_content_manager_unregister_script_message_handler(
    GjsifyWebView2UserContentManager *self, const gchar *name, const gchar *world_name);

/* -------------------------------------------------------------------------
 * GjsifyWebView2Settings — mirrors WebKitSettings for the properties this
 * workspace sets. An unknown property is a warning in GJS, which is the point:
 * a silently-ignored setting is worse than an absent one.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBVIEW2_TYPE_SETTINGS (gjsify_webview2_settings_get_type())
G_DECLARE_FINAL_TYPE(
    GjsifyWebView2Settings, gjsify_webview2_settings, GJSIFY_WEBVIEW2, SETTINGS, GObject)

/**
 * gjsify_webview2_settings_new:
 *
 * Returns: (transfer full): settings with WebKitGTK's defaults.
 */
GjsifyWebView2Settings *gjsify_webview2_settings_new(void);

/* -------------------------------------------------------------------------
 * GjsifyWebView2WebView — a GtkWidget, exactly as WebKitWebView is.
 *
 * This is the decision that keeps the consumer unchanged: `IFrameBridge extends
 * WebKit.WebView` and calls `window.set_child()` on the result, so a backend
 * that is not a GtkWidget would force a rewrite of the package rather than a
 * swap of its backend.
 *
 * What it is NOT, in this stage, is a widget GSK draws. The web content is a
 * child `HWND` under the GTK toplevel's own `HWND`, positioned and clipped to
 * this widget's allocation and hidden when it is unmapped — so input, focus and
 * accessibility come from the OS for free, and clipping, overdraw, opacity and
 * transforms do not work at all. gjsify_webview2_web_view_get_hosting_mode()
 * and gjsify_webview2_web_view_get_overlay_constraints() are how a consumer
 * finds that out from code rather than from a screenshot.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBVIEW2_TYPE_WEB_VIEW (gjsify_webview2_web_view_get_type())
/* DERIVABLE, not final — `IFrameBridge extends WebKit.WebView` is the shape
 * every consumer of this package is written in, and GJS refuses to subclass a
 * final type ("Cannot inherit from a final type"). ADR 0022 paid for this once
 * already: a final shim compiles, installs, and then breaks the one call the
 * port exists to keep working. */
G_DECLARE_DERIVABLE_TYPE(
    GjsifyWebView2WebView, gjsify_webview2_web_view, GJSIFY_WEBVIEW2, WEB_VIEW, GtkWidget)

struct _GjsifyWebView2WebViewClass {
    GtkWidgetClass parent_class;

    /*< private >*/
    gpointer padding[8];
};

/**
 * gjsify_webview2_web_view_new:
 *
 * Returns: (transfer full): a new web view.
 */
GtkWidget *gjsify_webview2_web_view_new(void);

void gjsify_webview2_web_view_load_uri(GjsifyWebView2WebView *self, const gchar *uri);

/**
 * gjsify_webview2_web_view_load_html:
 * @self: the view.
 * @content: the HTML to load.
 * @base_uri: (nullable): the base URI for relative resolution. WebView2's
 *   `NavigateToString` has no base-URI argument, so a non-%NULL value is applied
 *   by injecting a `<base>` element, and a document that already carries one
 *   keeps its own.
 */
void gjsify_webview2_web_view_load_html(
    GjsifyWebView2WebView *self, const gchar *content, const gchar *base_uri);

void gjsify_webview2_web_view_reload(GjsifyWebView2WebView *self);

const gchar *gjsify_webview2_web_view_get_uri(GjsifyWebView2WebView *self);

gboolean gjsify_webview2_web_view_is_loading(GjsifyWebView2WebView *self);

/**
 * gjsify_webview2_web_view_get_user_content_manager:
 * @self: the view.
 *
 * Returns: (transfer none): the manager this view was constructed with.
 */
GjsifyWebView2UserContentManager *gjsify_webview2_web_view_get_user_content_manager(
    GjsifyWebView2WebView *self);

/**
 * gjsify_webview2_web_view_get_settings:
 * @self: the view.
 *
 * Returns: (transfer none): the settings this view was constructed with.
 */
GjsifyWebView2Settings *gjsify_webview2_web_view_get_settings(GjsifyWebView2WebView *self);

/**
 * gjsify_webview2_web_view_get_hosting_mode:
 * @self: the view.
 *
 * ADR 0035 stage 1 always answers %GJSIFY_WEBVIEW2_HOSTING_MODE_OVERLAY. It is a
 * method rather than a constant because stage 2 changes the answer per view and
 * a consumer that branches on it should not have to be rewritten then.
 *
 * Returns: what this view is on screen.
 */
GjsifyWebView2HostingMode gjsify_webview2_web_view_get_hosting_mode(GjsifyWebView2WebView *self);

/**
 * gjsify_webview2_web_view_get_overlay_constraints:
 * @self: the view.
 *
 * The arrangements this view is currently in that an OS-composited overlay
 * cannot honour. Detected, on allocation and on map: an ancestor that clips
 * (a #GtkScrolledWindow, a #GtkViewport), an ancestor #GtkPopover, something
 * drawn over it (a #GtkOverlay where this is the main child), and a fractional
 * opacity on this widget or any ancestor. Each is also emitted ONCE per view as
 * a #GLib warning naming the widget, because a consumer who never calls this is
 * exactly the consumer who needs to be told.
 *
 * TWO ARRANGEMENTS ARE BROKEN AND NOT DETECTED, and an empty list therefore
 * does not mean "correct": a CSS `border-radius` reaching this widget is not
 * readable from the public API at all, and a render transform on an ancestor is
 * not looked for. Detection is by widget type and by two GTK properties, which
 * catches every arrangement that has actually been reported against an
 * overlay-hosted web view — but a caller must read this list as a lower bound.
 *
 * Empty otherwise, which is the common case: a full-page document in a window.
 *
 * Returns: (transfer full) (array zero-terminated=1): the constraint messages.
 */
gchar **gjsify_webview2_web_view_get_overlay_constraints(GjsifyWebView2WebView *self);

/**
 * gjsify_webview2_web_view_get_message_pump_state:
 * @self: the view.
 *
 * Whether the Win32 message queue is being dispatched for this view. Every
 * content-level operation below checks this first and fails with a named error
 * when it is not %GJSIFY_WEBVIEW2_MESSAGE_PUMP_ATTACHED, because the alternative
 * is an 8-second timeout a long way from its cause.
 *
 * Returns: the state of this view's pump.
 */
GjsifyWebView2MessagePumpState gjsify_webview2_web_view_get_message_pump_state(
    GjsifyWebView2WebView *self);

/**
 * gjsify_webview2_web_view_evaluate_javascript:
 * @self: the view.
 * @script: the source to evaluate.
 * @length: length of @script in bytes, or -1 if nul-terminated.
 * @world_name: (nullable): ignored — see gjsify_webview2_user_script_new_for_world().
 * @source_uri: (nullable): a URI attributed to the script in errors.
 * @cancellable: (nullable): a #GCancellable.
 * @callback: (scope async) (closure user_data) (nullable): called when the
 *   evaluation completes.
 * @user_data: data for @callback.
 *
 * The argument list is WebKitGTK's verbatim so `Gio._promisify` produces the
 * identical Promise signature on every backend.
 */
void gjsify_webview2_web_view_evaluate_javascript(
    GjsifyWebView2WebView *self,
    const gchar *script,
    gssize length,
    const gchar *world_name,
    const gchar *source_uri,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data);

/**
 * gjsify_webview2_web_view_evaluate_javascript_finish: (async-func evaluate_javascript)
 * @self: the view.
 * @result: the #GAsyncResult.
 * @error: return location for a #GError.
 *
 * Returns: (transfer full) (nullable): the value the script evaluated to.
 */
GjsifyWebView2Value *gjsify_webview2_web_view_evaluate_javascript_finish(
    GjsifyWebView2WebView *self, GAsyncResult *result, GError **error);

/**
 * gjsify_webview2_web_view_get_snapshot:
 * @self: the view.
 * @region: which region to capture. WebView2's `CapturePreview` captures the
 *   viewport only, so %GJSIFY_WEBVIEW2_SNAPSHOT_REGION_FULL_DOCUMENT is a
 *   documented divergence rather than a second code path — it returns the
 *   viewport and warns once.
 * @options: snapshot options.
 * @cancellable: (nullable): a #GCancellable.
 * @callback: (scope async) (closure user_data) (nullable): called when the
 *   snapshot completes.
 * @user_data: data for @callback.
 */
void gjsify_webview2_web_view_get_snapshot(
    GjsifyWebView2WebView *self,
    GjsifyWebView2SnapshotRegion region,
    GjsifyWebView2SnapshotOptions options,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data);

/**
 * gjsify_webview2_web_view_get_snapshot_finish: (async-func get_snapshot)
 * @self: the view.
 * @result: the #GAsyncResult.
 * @error: return location for a #GError.
 *
 * Returns: (transfer full) (nullable): the captured content. A real #GdkTexture,
 *   so `save_to_png_bytes()` and friends work unchanged.
 */
GdkTexture *gjsify_webview2_web_view_get_snapshot_finish(
    GjsifyWebView2WebView *self, GAsyncResult *result, GError **error);

G_END_DECLS

#endif /* GJSIFY_WEBVIEW2_H */
