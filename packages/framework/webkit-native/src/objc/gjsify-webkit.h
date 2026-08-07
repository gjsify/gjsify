/* SPDX-License-Identifier: MIT
 *
 * GjsifyWebKit — the darwin backend for `@gjsify/iframe` (ADR 0022).
 *
 * This header is deliberately PURE C with no Objective-C in it. g-ir-scanner
 * runs the C preprocessor and parses C declarations; an `@interface` in a
 * scanned header stops it dead. Every Objective-C type therefore stays behind
 * an opaque `void *` in the private struct, and all of it lives in the `.m`.
 *
 * The API mirrors WebKitGTK 6.0 name for name and signature for signature, so
 * `@gjsify/iframe` selects a backend with ONE import and its ~40 call sites
 * stay untouched. Where WebKitGTK has `webkit_web_view_load_html()`, this has
 * `gjsify_webkit_web_view_load_html()` with the same arguments in the same
 * order — divergence here would be paid for in every consumer.
 */

#ifndef GJSIFY_WEBKIT_H
#define GJSIFY_WEBKIT_H

#include <gtk/gtk.h>

G_BEGIN_DECLS

/**
 * GjsifyWebKitLoadEvent:
 * @GJSIFY_WEBKIT_LOAD_STARTED: a new load request has started.
 * @GJSIFY_WEBKIT_LOAD_REDIRECTED: a load request has been redirected.
 * @GJSIFY_WEBKIT_LOAD_COMMITTED: the content is being loaded.
 * @GJSIFY_WEBKIT_LOAD_FINISHED: the load finished.
 *
 * Mirrors `WebKitLoadEvent`. The numeric values match WebKitGTK's so a
 * consumer that (wrongly) compares integers still agrees across backends.
 */
typedef enum {
    GJSIFY_WEBKIT_LOAD_STARTED,
    GJSIFY_WEBKIT_LOAD_REDIRECTED,
    GJSIFY_WEBKIT_LOAD_COMMITTED,
    GJSIFY_WEBKIT_LOAD_FINISHED
} GjsifyWebKitLoadEvent;

/**
 * GjsifyWebKitSnapshotRegion:
 * @GJSIFY_WEBKIT_SNAPSHOT_REGION_VISIBLE: the visible viewport.
 * @GJSIFY_WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT: the whole scrollable document.
 */
typedef enum {
    GJSIFY_WEBKIT_SNAPSHOT_REGION_VISIBLE,
    GJSIFY_WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT
} GjsifyWebKitSnapshotRegion;

/**
 * GjsifyWebKitSnapshotOptions:
 * @GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_NONE: no special options.
 * @GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_INCLUDE_SELECTION_HIGHLIGHTING: include the selection highlight.
 * @GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_TRANSPARENT_BACKGROUND: do not paint the page background.
 */
typedef enum {
    GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_NONE = 0,
    GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_INCLUDE_SELECTION_HIGHLIGHTING = 1 << 0,
    GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_TRANSPARENT_BACKGROUND = 1 << 1
} GjsifyWebKitSnapshotOptions;

/**
 * GjsifyWebKitUserContentInjectedFrames:
 * @GJSIFY_WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES: inject into every frame.
 * @GJSIFY_WEBKIT_USER_CONTENT_INJECT_TOP_FRAME: inject into the main frame only.
 */
typedef enum {
    GJSIFY_WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
    GJSIFY_WEBKIT_USER_CONTENT_INJECT_TOP_FRAME
} GjsifyWebKitUserContentInjectedFrames;

/**
 * GjsifyWebKitUserScriptInjectionTime:
 * @GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START: run before the document loads.
 * @GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END: run after the document loads.
 */
typedef enum {
    GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
    GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END
} GjsifyWebKitUserScriptInjectionTime;

/* -------------------------------------------------------------------------
 * GjsifyWebKitValue — the result of an evaluation, and the payload of a
 * script message.
 *
 * WebKitGTK hands back a `JSCValue`. Consumers in this workspace call exactly
 * one method on it (`to_string()`), so this exposes that and the type probes
 * around it rather than re-implementing JavaScriptCore's value API. Anything
 * beyond it belongs in a later revision with a consumer to justify it.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBKIT_TYPE_VALUE (gjsify_webkit_value_get_type())
G_DECLARE_FINAL_TYPE(GjsifyWebKitValue, gjsify_webkit_value, GJSIFY_WEBKIT, VALUE, GObject)

/**
 * gjsify_webkit_value_to_string:
 * @self: a value.
 *
 * Returns: (transfer full): the value rendered as a string, matching what
 *   `JSCValue.to_string()` produces for the same script under WebKitGTK.
 */
gchar *gjsify_webkit_value_to_string(GjsifyWebKitValue *self);
gboolean gjsify_webkit_value_is_string(GjsifyWebKitValue *self);
gboolean gjsify_webkit_value_is_null(GjsifyWebKitValue *self);
gboolean gjsify_webkit_value_is_undefined(GjsifyWebKitValue *self);

/* -------------------------------------------------------------------------
 * GjsifyWebKitUserScript — mirrors WebKitUserScript.
 * ------------------------------------------------------------------------- */

/* A BOXED type, not a GObject — matching WebKitUserScript, which is
 * ref-counted boxed. The difference is visible in the consumer: GJS maps a
 * boxed type's `new` constructor onto `new WebKit.UserScript(source, frames,
 * time, allow, block)`, while a GObject would demand
 * `new UserScript({property: …})`. Getting this wrong is not a style question;
 * it changes the call the consumer has to write, which is the one thing this
 * backend exists to keep identical. */
typedef struct _GjsifyWebKitUserScript GjsifyWebKitUserScript;

#define GJSIFY_WEBKIT_TYPE_USER_SCRIPT (gjsify_webkit_user_script_get_type())
GType gjsify_webkit_user_script_get_type(void) G_GNUC_CONST;

/**
 * gjsify_webkit_user_script_ref:
 * @self: a script.
 *
 * Returns: (transfer full): @self with its reference count increased.
 */
GjsifyWebKitUserScript *gjsify_webkit_user_script_ref(GjsifyWebKitUserScript *self);

void gjsify_webkit_user_script_unref(GjsifyWebKitUserScript *self);

/**
 * gjsify_webkit_user_script_new:
 * @source: the script source.
 * @injected_frames: which frames to inject into.
 * @injection_time: when to inject.
 * @allow_list: (nullable) (array zero-terminated=1): URI patterns to allow, or %NULL for all.
 * @block_list: (nullable) (array zero-terminated=1): URI patterns to block, or %NULL for none.
 *
 * The lists are `scheme://host/path` patterns as WebKitGTK's are, with `*`
 * wildcards; `*` as a scheme means http or https, and a `*.` host prefix
 * matches subdomains. Apple's WKUserScript carries no URL filter, so a script
 * with a non-empty list is wrapped in a guard that tests the document's URL
 * before running — which costs one thing worth knowing: the guard is a labelled
 * block, so a filtered script's top-level `let`, `const` and `class` are
 * block-scoped rather than global. `var` and function declarations are
 * unaffected, and a script with no lists is not wrapped at all.
 *
 * Returns: (transfer full): a new script.
 */
GjsifyWebKitUserScript *gjsify_webkit_user_script_new(
    const gchar *source,
    GjsifyWebKitUserContentInjectedFrames injected_frames,
    GjsifyWebKitUserScriptInjectionTime injection_time,
    const gchar *const *allow_list,
    const gchar *const *block_list);

/**
 * gjsify_webkit_user_script_new_for_world:
 * @source: the script source.
 * @injected_frames: which frames to inject into.
 * @injection_time: when to inject.
 * @world_name: (nullable): the script world to inject into, or %NULL for the
 *   page's own world.
 * @allow_list: (nullable) (array zero-terminated=1): URI patterns to allow, or %NULL for all.
 * @block_list: (nullable) (array zero-terminated=1): URI patterns to block, or %NULL for none.
 *
 * Mirrors `webkit_user_script_new_for_world()`. Backed by `WKContentWorld`,
 * public since macOS 11.
 *
 * Returns: (transfer full): a new script.
 */
GjsifyWebKitUserScript *gjsify_webkit_user_script_new_for_world(
    const gchar *source,
    GjsifyWebKitUserContentInjectedFrames injected_frames,
    GjsifyWebKitUserScriptInjectionTime injection_time,
    const gchar *world_name,
    const gchar *const *allow_list,
    const gchar *const *block_list);

/* -------------------------------------------------------------------------
 * GjsifyWebKitUserContentManager — mirrors WebKitUserContentManager.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBKIT_TYPE_USER_CONTENT_MANAGER (gjsify_webkit_user_content_manager_get_type())
G_DECLARE_FINAL_TYPE(
    GjsifyWebKitUserContentManager,
    gjsify_webkit_user_content_manager,
    GJSIFY_WEBKIT,
    USER_CONTENT_MANAGER,
    GObject)

/**
 * gjsify_webkit_user_content_manager_new:
 *
 * Returns: (transfer full): a new user content manager.
 */
GjsifyWebKitUserContentManager *gjsify_webkit_user_content_manager_new(void);

void gjsify_webkit_user_content_manager_add_script(
    GjsifyWebKitUserContentManager *self, GjsifyWebKitUserScript *script);

void gjsify_webkit_user_content_manager_remove_all_scripts(
    GjsifyWebKitUserContentManager *self);

/**
 * gjsify_webkit_user_content_manager_register_script_message_handler:
 * @self: the manager.
 * @name: the handler name, reachable from the page as
 *   `window.webkit.messageHandlers.<name>.postMessage()`.
 * @world_name: (nullable): the script world to register in, or %NULL for the
 *   page's own world. Backed by `WKContentWorld`, public since macOS 11. A
 *   handler in a named world is deliberately NOT reachable from the page's own
 *   scripts, which is the isolation the argument exists for.
 *
 * Returns: %TRUE if the handler was registered.
 */
gboolean gjsify_webkit_user_content_manager_register_script_message_handler(
    GjsifyWebKitUserContentManager *self, const gchar *name, const gchar *world_name);

void gjsify_webkit_user_content_manager_unregister_script_message_handler(
    GjsifyWebKitUserContentManager *self, const gchar *name, const gchar *world_name);

/* -------------------------------------------------------------------------
 * GjsifyWebKitSettings — mirrors WebKitSettings for the properties this
 * workspace sets. Unknown properties are a compile error in C and a warning in
 * GJS, which is the point: a silently-ignored setting is worse than an absent
 * one.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBKIT_TYPE_SETTINGS (gjsify_webkit_settings_get_type())
G_DECLARE_FINAL_TYPE(GjsifyWebKitSettings, gjsify_webkit_settings, GJSIFY_WEBKIT, SETTINGS, GObject)

/**
 * gjsify_webkit_settings_new:
 *
 * Returns: (transfer full): settings with WebKitGTK's defaults.
 */
GjsifyWebKitSettings *gjsify_webkit_settings_new(void);

/* -------------------------------------------------------------------------
 * GjsifyWebKitWebView — a GtkWidget, exactly as WebKitWebView is.
 *
 * This is the decision that keeps the consumer unchanged: `IFrameBridge
 * extends WebKit.WebView` and calls `window.set_child()` on the result, so a
 * backend that is not a GtkWidget would force a rewrite of the package rather
 * than a swap of its backend. WKWebView is an NSView and GTK4 has no foreign
 * embedding, so the widget is BUILT: the web content renders offscreen and is
 * presented as a GdkTexture in the widget's snapshot vfunc.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBKIT_TYPE_WEB_VIEW (gjsify_webkit_web_view_get_type())
/* DERIVABLE, not final — `IFrameBridge extends WebKit.WebView` is the shape
 * every consumer of this package is written in, and GJS refuses to subclass a
 * final type ("Cannot inherit from a final type"). WebKitWebView is derivable;
 * a final shim would have compiled, installed and then broken the one call the
 * port exists to keep working. */
G_DECLARE_DERIVABLE_TYPE(
    GjsifyWebKitWebView, gjsify_webkit_web_view, GJSIFY_WEBKIT, WEB_VIEW, GtkWidget)

struct _GjsifyWebKitWebViewClass {
    GtkWidgetClass parent_class;

    /*< private >*/
    gpointer padding[8];
};

/**
 * gjsify_webkit_web_view_new:
 *
 * Returns: (transfer full): a new web view.
 */
GtkWidget *gjsify_webkit_web_view_new(void);

void gjsify_webkit_web_view_load_uri(GjsifyWebKitWebView *self, const gchar *uri);

/**
 * gjsify_webkit_web_view_load_html:
 * @self: the view.
 * @content: the HTML to load.
 * @base_uri: (nullable): the base URI for relative resolution.
 */
void gjsify_webkit_web_view_load_html(
    GjsifyWebKitWebView *self, const gchar *content, const gchar *base_uri);

void gjsify_webkit_web_view_reload(GjsifyWebKitWebView *self);

const gchar *gjsify_webkit_web_view_get_uri(GjsifyWebKitWebView *self);

gboolean gjsify_webkit_web_view_is_loading(GjsifyWebKitWebView *self);

/**
 * gjsify_webkit_web_view_get_user_content_manager:
 * @self: the view.
 *
 * Returns: (transfer none): the manager this view was constructed with.
 */
GjsifyWebKitUserContentManager *gjsify_webkit_web_view_get_user_content_manager(
    GjsifyWebKitWebView *self);

/**
 * gjsify_webkit_web_view_get_settings:
 * @self: the view.
 *
 * Returns: (transfer none): the settings this view was constructed with.
 */
GjsifyWebKitSettings *gjsify_webkit_web_view_get_settings(GjsifyWebKitWebView *self);

/**
 * gjsify_webkit_web_view_evaluate_javascript:
 * @self: the view.
 * @script: the source to evaluate.
 * @length: length of @script in bytes, or -1 if nul-terminated.
 * @world_name: (nullable): the script world to evaluate in, or %NULL for the
 *   page's own world.
 * @source_uri: (nullable): a URI attributed to the script in errors.
 * @cancellable: (nullable): a #GCancellable.
 * @callback: (scope async) (closure user_data) (nullable): called when the
 *   evaluation completes.
 * @user_data: data for @callback.
 *
 * The argument list is WebKitGTK's verbatim so `Gio._promisify` produces the
 * identical Promise signature on both backends.
 */
void gjsify_webkit_web_view_evaluate_javascript(
    GjsifyWebKitWebView *self,
    const gchar *script,
    gssize length,
    const gchar *world_name,
    const gchar *source_uri,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data);

/**
 * gjsify_webkit_web_view_evaluate_javascript_finish: (async-func evaluate_javascript)
 * @self: the view.
 * @result: the #GAsyncResult.
 * @error: return location for a #GError.
 *
 * Returns: (transfer full) (nullable): the value the script evaluated to.
 */
GjsifyWebKitValue *gjsify_webkit_web_view_evaluate_javascript_finish(
    GjsifyWebKitWebView *self, GAsyncResult *result, GError **error);

/**
 * gjsify_webkit_web_view_get_snapshot:
 * @self: the view.
 * @region: which region to capture.
 * @options: snapshot options.
 * @cancellable: (nullable): a #GCancellable.
 * @callback: (scope async) (closure user_data) (nullable): called when the
 *   snapshot completes.
 * @user_data: data for @callback.
 */
void gjsify_webkit_web_view_get_snapshot(
    GjsifyWebKitWebView *self,
    GjsifyWebKitSnapshotRegion region,
    GjsifyWebKitSnapshotOptions options,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data);

/**
 * gjsify_webkit_web_view_get_snapshot_finish: (async-func get_snapshot)
 * @self: the view.
 * @result: the #GAsyncResult.
 * @error: return location for a #GError.
 *
 * Returns: (transfer full) (nullable): the captured content. A real
 *   #GdkTexture, so `save_to_png_bytes()` and friends work unchanged.
 */
GdkTexture *gjsify_webkit_web_view_get_snapshot_finish(
    GjsifyWebKitWebView *self, GAsyncResult *result, GError **error);

G_END_DECLS

#endif /* GJSIFY_WEBKIT_H */
