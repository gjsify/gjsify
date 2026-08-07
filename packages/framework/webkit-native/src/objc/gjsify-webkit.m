/* SPDX-License-Identifier: MIT
 *
 * GjsifyWebKit — Apple WebKit (WKWebView) behind a GObject API shaped like
 * WebKitGTK 6.0. See docs/adr/0022-webkit-on-darwin.md.
 *
 * All Objective-C is confined to this file; the header is pure C so
 * g-ir-scanner can parse it.
 */

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include "gjsify-webkit.h"

/* ==========================================================================
 * The run-loop bridge — the piece without which none of the rest runs.
 *
 * WKWebView delivers everything (navigation callbacks, evaluateJavaScript
 * completion handlers, script messages) through a CFRunLoop. GJS runs a
 * GMainContext. They are separate loops, and a GMainContext does not pump a
 * CFRunLoop: measured on macOS 15.7.8, a WKWebView driven from a bare
 * g_main_loop_run() never even reaches didFinishNavigation — it simply hangs
 * until the test's timeout. Adding the drain below makes the identical program
 * complete. docs/poc/webkit-runloop-darwin.m is that measurement.
 *
 * The drain is attached while at least one WebView is alive and detached with
 * the last one, so an application that has finished with WebKit stops paying
 * for it. The interval is a compromise with no better option available: the
 * CFRunLoop's wakeup port is not public API, so there is nothing to poll on
 * and a timer is the only integration point. 4 ms keeps input latency under a
 * frame without spinning the CPU on an idle page.
 * ========================================================================== */

#define GJSIFY_WEBKIT_PUMP_INTERVAL_MS 4

static guint gjsify_webkit_pump_source_id = 0;
static gsize gjsify_webkit_live_web_views = 0;

static gboolean gjsify_webkit_pump_run_loop(gpointer user_data)
{
    (void) user_data;
    /* Drain every source that is already ready, then return. A zero timeout
     * with returnAfterSourceHandled:YES processes ONE source per call, so the
     * loop is what makes a burst of callbacks arrive in the same iteration
     * rather than one per timer tick. */
    while (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true) == kCFRunLoopRunHandledSource) {
        /* keep draining */
    }
    return G_SOURCE_CONTINUE;
}

static void gjsify_webkit_pump_ref(void)
{
    if (gjsify_webkit_live_web_views++ == 0) {
        gjsify_webkit_pump_source_id =
            g_timeout_add_full(G_PRIORITY_DEFAULT,
                               GJSIFY_WEBKIT_PUMP_INTERVAL_MS,
                               gjsify_webkit_pump_run_loop,
                               NULL,
                               NULL);
    }
}

static void gjsify_webkit_pump_unref(void)
{
    if (gjsify_webkit_live_web_views > 0 && --gjsify_webkit_live_web_views == 0) {
        g_clear_handle_id(&gjsify_webkit_pump_source_id, g_source_remove);
    }
}

/* NSApplication must exist before a WKWebView is instantiated: AppKit asserts
 * on a nil NSApp deep inside WebKit's view setup. `Prohibited` is what keeps a
 * `gjs` CLI process from growing a Dock icon — it is the policy the probe
 * measured, not a cosmetic choice. Idempotent; safe to call per view. */
static void gjsify_webkit_ensure_app(void)
{
    static gsize once = 0;
    if (g_once_init_enter(&once)) {
        @autoreleasepool {
            [NSApplication sharedApplication];
            if ([NSApp activationPolicy] == NSApplicationActivationPolicyRegular) {
                [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
            }
        }
        g_once_init_leave(&once, 1);
    }
}

/* ==========================================================================
 * GjsifyWebKitValue
 * ========================================================================== */

struct _GjsifyWebKitValue {
    GObject parent_instance;
    gchar *string;
    gboolean is_string;
    gboolean is_null;
    gboolean is_undefined;
};

G_DEFINE_FINAL_TYPE(GjsifyWebKitValue, gjsify_webkit_value, G_TYPE_OBJECT)

static void gjsify_webkit_value_finalize(GObject *object)
{
    GjsifyWebKitValue *self = GJSIFY_WEBKIT_VALUE(object);
    g_clear_pointer(&self->string, g_free);
    G_OBJECT_CLASS(gjsify_webkit_value_parent_class)->finalize(object);
}

static void gjsify_webkit_value_class_init(GjsifyWebKitValueClass *klass)
{
    G_OBJECT_CLASS(klass)->finalize = gjsify_webkit_value_finalize;
}

static void gjsify_webkit_value_init(GjsifyWebKitValue *self)
{
    (void) self;
}

/**
 * gjsify_webkit_value_to_string:
 * @self: a #GjsifyWebKitValue.
 *
 * Returns: (transfer full): the value as a string, as `JSCValue.to_string()`
 *   would render it.
 */
gchar *gjsify_webkit_value_to_string(GjsifyWebKitValue *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_VALUE(self), NULL);
    return g_strdup(self->string ? self->string : "");
}

gboolean gjsify_webkit_value_is_string(GjsifyWebKitValue *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_VALUE(self), FALSE);
    return self->is_string;
}

gboolean gjsify_webkit_value_is_null(GjsifyWebKitValue *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_VALUE(self), FALSE);
    return self->is_null;
}

gboolean gjsify_webkit_value_is_undefined(GjsifyWebKitValue *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_VALUE(self), FALSE);
    return self->is_undefined;
}

/* Build a value from whatever `evaluateJavaScript` or a script message handed
 * back. WKWebView bridges JS values to Foundation objects, so the mapping is
 * from NSString/NSNumber/NSNull/NSDictionary rather than from a JS engine
 * type — and `to_string()` has to agree with what JSCValue.to_string() would
 * have produced for the same script, because the consumer JSON.parses it. */
static GjsifyWebKitValue *gjsify_webkit_value_new_from_objc(id object)
{
    GjsifyWebKitValue *self = g_object_new(GJSIFY_WEBKIT_TYPE_VALUE, NULL);

    if (object == nil || [object isKindOfClass:[NSNull class]]) {
        /* WKWebView maps both `null` and `undefined` to nil/NSNull, so the two
         * cannot be told apart here. `null` is the safer rendering: the
         * consumer JSON.parses this, and "null" parses where "undefined" throws. */
        self->is_null = TRUE;
        self->string = g_strdup("null");
        return self;
    }

    if ([object isKindOfClass:[NSString class]]) {
        self->is_string = TRUE;
        self->string = g_strdup([(NSString *) object UTF8String]);
        return self;
    }

    if ([object isKindOfClass:[NSNumber class]]) {
        NSNumber *number = (NSNumber *) object;
        /* A JS boolean arrives as an NSNumber; only the ObjC type encoding
         * distinguishes it, and rendering `true` as `1` would break the
         * consumer's JSON.parse round-trip. */
        if (strcmp([number objCType], @encode(BOOL)) == 0) {
            self->string = g_strdup([number boolValue] ? "true" : "false");
        } else {
            self->string = g_strdup([[number stringValue] UTF8String]);
        }
        return self;
    }

    /* Arrays and dictionaries: render as JSON, which is what the consumer
     * expects from a JSCValue holding an object. */
    if ([NSJSONSerialization isValidJSONObject:object]) {
        NSError *error = nil;
        NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
        if (data != nil && error == nil) {
            NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            self->string = g_strdup([json UTF8String]);
            return self;
        }
    }

    self->string = g_strdup([[object description] UTF8String]);
    return self;
}

/* ==========================================================================
 * GjsifyWebKitUserScript
 * ========================================================================== */

struct _GjsifyWebKitUserScript {
    gatomicrefcount ref_count;
    gchar *source;
    GjsifyWebKitUserContentInjectedFrames injected_frames;
    GjsifyWebKitUserScriptInjectionTime injection_time;
};

G_DEFINE_BOXED_TYPE(GjsifyWebKitUserScript,
                    gjsify_webkit_user_script,
                    gjsify_webkit_user_script_ref,
                    gjsify_webkit_user_script_unref)

GjsifyWebKitUserScript *gjsify_webkit_user_script_ref(GjsifyWebKitUserScript *self)
{
    g_return_val_if_fail(self != NULL, NULL);
    g_atomic_ref_count_inc(&self->ref_count);
    return self;
}

void gjsify_webkit_user_script_unref(GjsifyWebKitUserScript *self)
{
    g_return_if_fail(self != NULL);
    if (g_atomic_ref_count_dec(&self->ref_count)) {
        g_free(self->source);
        g_free(self);
    }
}

GjsifyWebKitUserScript *gjsify_webkit_user_script_new(
    const gchar *source,
    GjsifyWebKitUserContentInjectedFrames injected_frames,
    GjsifyWebKitUserScriptInjectionTime injection_time,
    const gchar *const *allow_list,
    const gchar *const *block_list)
{
    GjsifyWebKitUserScript *self;

    g_return_val_if_fail(source != NULL, NULL);

    /* WKUserScript has no allow/block list — WebKitGTK's are implemented above
     * WebKit, not inside it. Accepting them and dropping them silently would
     * make a script run on origins the caller excluded, so a non-empty list is
     * a warning rather than a no-op. Nothing in this workspace passes one. */
    if ((allow_list != NULL && allow_list[0] != NULL) ||
        (block_list != NULL && block_list[0] != NULL)) {
        g_warning("GjsifyWebKit: user-script allow/block lists are not supported on the "
                  "darwin backend; the script will run in every frame it is injected into");
    }

    self = g_new0(GjsifyWebKitUserScript, 1);
    g_atomic_ref_count_init(&self->ref_count);
    self->source = g_strdup(source);
    self->injected_frames = injected_frames;
    self->injection_time = injection_time;
    return self;
}

/* ==========================================================================
 * GjsifyWebKitUserContentManager
 * ========================================================================== */

struct _GjsifyWebKitUserContentManager {
    GObject parent_instance;
    void *controller; /* WKUserContentController * */
    void *handler;    /* GjsifyWebKitScriptMessageHandler * */
    GPtrArray *scripts;
};

enum { UCM_SIGNAL_SCRIPT_MESSAGE_RECEIVED, UCM_N_SIGNALS };
static guint ucm_signals[UCM_N_SIGNALS] = { 0 };

G_DEFINE_FINAL_TYPE(
    GjsifyWebKitUserContentManager, gjsify_webkit_user_content_manager, G_TYPE_OBJECT)

/* The ObjC object that receives postMessage() and re-emits it as a GObject
 * signal. It holds an UNOWNED pointer back to the manager: the manager owns
 * the controller which owns this, so an owning pointer would be a cycle that
 * never finalizes. `manager` is cleared in dispose before the controller goes. */
@interface GjsifyWebKitScriptMessageHandler : NSObject <WKScriptMessageHandler>
@property(nonatomic, assign) GjsifyWebKitUserContentManager *manager;
@end

@implementation GjsifyWebKitScriptMessageHandler

- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message
{
    (void) controller;
    if (self.manager == NULL) {
        return;
    }
    GjsifyWebKitValue *value = gjsify_webkit_value_new_from_objc(message.body);
    /* Detail-quantified like WebKitGTK's, so a consumer connecting to
     * `script-message-received::<name>` receives only its own channel. */
    g_signal_emit(self.manager,
                  ucm_signals[UCM_SIGNAL_SCRIPT_MESSAGE_RECEIVED],
                  g_quark_from_string([message.name UTF8String]),
                  value);
    g_object_unref(value);
}

@end

static void gjsify_webkit_user_content_manager_dispose(GObject *object)
{
    GjsifyWebKitUserContentManager *self = GJSIFY_WEBKIT_USER_CONTENT_MANAGER(object);

    @autoreleasepool {
        GjsifyWebKitScriptMessageHandler *handler =
            (__bridge GjsifyWebKitScriptMessageHandler *) self->handler;
        WKUserContentController *controller = (__bridge WKUserContentController *) self->controller;
        if (handler != nil) {
            handler.manager = NULL;
        }
        if (controller != nil) {
            [controller removeAllUserScripts];
        }
        if (self->handler != NULL) {
            CFRelease(self->handler);
            self->handler = NULL;
        }
        if (self->controller != NULL) {
            CFRelease(self->controller);
            self->controller = NULL;
        }
    }

    g_clear_pointer(&self->scripts, g_ptr_array_unref);
    G_OBJECT_CLASS(gjsify_webkit_user_content_manager_parent_class)->dispose(object);
}

static void gjsify_webkit_user_content_manager_class_init(
    GjsifyWebKitUserContentManagerClass *klass)
{
    G_OBJECT_CLASS(klass)->dispose = gjsify_webkit_user_content_manager_dispose;

    /**
     * GjsifyWebKitUserContentManager::script-message-received:
     * @self: the manager.
     * @value: the message body.
     *
     * Mirrors WebKitUserContentManager::script-message-received.
     */
    ucm_signals[UCM_SIGNAL_SCRIPT_MESSAGE_RECEIVED] =
        g_signal_new("script-message-received",
                     GJSIFY_WEBKIT_TYPE_USER_CONTENT_MANAGER,
                     G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                     0,
                     NULL,
                     NULL,
                     NULL,
                     G_TYPE_NONE,
                     1,
                     GJSIFY_WEBKIT_TYPE_VALUE);
}

static void gjsify_webkit_user_content_manager_init(GjsifyWebKitUserContentManager *self)
{
    gjsify_webkit_ensure_app();

    @autoreleasepool {
        WKUserContentController *controller = [[WKUserContentController alloc] init];
        GjsifyWebKitScriptMessageHandler *handler =
            [[GjsifyWebKitScriptMessageHandler alloc] init];
        handler.manager = self;
        self->controller = (void *) CFBridgingRetain(controller);
        self->handler = (void *) CFBridgingRetain(handler);
    }

    self->scripts = g_ptr_array_new_with_free_func((GDestroyNotify) gjsify_webkit_user_script_unref);
}

GjsifyWebKitUserContentManager *gjsify_webkit_user_content_manager_new(void)
{
    return g_object_new(GJSIFY_WEBKIT_TYPE_USER_CONTENT_MANAGER, NULL);
}

void gjsify_webkit_user_content_manager_add_script(
    GjsifyWebKitUserContentManager *self, GjsifyWebKitUserScript *script)
{
    g_return_if_fail(GJSIFY_WEBKIT_IS_USER_CONTENT_MANAGER(self));
    g_return_if_fail(script != NULL);

    @autoreleasepool {
        WKUserContentController *controller = (__bridge WKUserContentController *) self->controller;
        WKUserScriptInjectionTime time =
            script->injection_time == GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START
                ? WKUserScriptInjectionTimeAtDocumentStart
                : WKUserScriptInjectionTimeAtDocumentEnd;
        BOOL main_frame_only =
            script->injected_frames == GJSIFY_WEBKIT_USER_CONTENT_INJECT_TOP_FRAME;

        WKUserScript *user_script =
            [[WKUserScript alloc] initWithSource:@(script->source)
                                   injectionTime:time
                                forMainFrameOnly:main_frame_only];
        [controller addUserScript:user_script];
    }

    g_ptr_array_add(self->scripts, gjsify_webkit_user_script_ref(script));
}

void gjsify_webkit_user_content_manager_remove_all_scripts(GjsifyWebKitUserContentManager *self)
{
    g_return_if_fail(GJSIFY_WEBKIT_IS_USER_CONTENT_MANAGER(self));

    @autoreleasepool {
        WKUserContentController *controller = (__bridge WKUserContentController *) self->controller;
        [controller removeAllUserScripts];
    }

    g_ptr_array_set_size(self->scripts, 0);
}

gboolean gjsify_webkit_user_content_manager_register_script_message_handler(
    GjsifyWebKitUserContentManager *self, const gchar *name, const gchar *world_name)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_USER_CONTENT_MANAGER(self), FALSE);
    g_return_val_if_fail(name != NULL, FALSE);

    /* WebKitGTK's world_name selects a script world. WKWebView has no public
     * equivalent, and registering into the page world while the caller asked
     * for an isolated one would hand page scripts a handler they should not
     * reach. Refusing is the honest answer. */
    if (world_name != NULL) {
        g_warning("GjsifyWebKit: named script worlds are not available on the darwin "
                  "backend; refusing to register handler '%s' in world '%s'",
                  name,
                  world_name);
        return FALSE;
    }

    @autoreleasepool {
        WKUserContentController *controller = (__bridge WKUserContentController *) self->controller;
        GjsifyWebKitScriptMessageHandler *handler =
            (__bridge GjsifyWebKitScriptMessageHandler *) self->handler;
        /* Re-registering the same name throws an ObjC exception, which would
         * cross the C frame and abort. WebKitGTK returns FALSE instead, so
         * remove first and keep the contract. */
        [controller removeScriptMessageHandlerForName:@(name)];
        [controller addScriptMessageHandler:handler name:@(name)];
    }

    return TRUE;
}

void gjsify_webkit_user_content_manager_unregister_script_message_handler(
    GjsifyWebKitUserContentManager *self, const gchar *name, const gchar *world_name)
{
    g_return_if_fail(GJSIFY_WEBKIT_IS_USER_CONTENT_MANAGER(self));
    g_return_if_fail(name != NULL);
    (void) world_name;

    @autoreleasepool {
        WKUserContentController *controller = (__bridge WKUserContentController *) self->controller;
        [controller removeScriptMessageHandlerForName:@(name)];
    }
}

/* ==========================================================================
 * GjsifyWebKitSettings
 * ========================================================================== */

struct _GjsifyWebKitSettings {
    GObject parent_instance;
    gboolean enable_developer_extras;
    gboolean enable_javascript;
    gboolean allow_file_access_from_file_urls;
    gboolean enable_write_console_messages_to_stdout;
};

enum {
    SETTINGS_PROP_0,
    SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS,
    SETTINGS_PROP_ENABLE_JAVASCRIPT,
    SETTINGS_PROP_ALLOW_FILE_ACCESS_FROM_FILE_URLS,
    SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT,
    SETTINGS_N_PROPS
};
static GParamSpec *settings_props[SETTINGS_N_PROPS] = { NULL };

G_DEFINE_FINAL_TYPE(GjsifyWebKitSettings, gjsify_webkit_settings, G_TYPE_OBJECT)

static void gjsify_webkit_settings_get_property(
    GObject *object, guint prop_id, GValue *value, GParamSpec *pspec)
{
    GjsifyWebKitSettings *self = GJSIFY_WEBKIT_SETTINGS(object);

    switch (prop_id) {
        case SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS:
            g_value_set_boolean(value, self->enable_developer_extras);
            break;
        case SETTINGS_PROP_ENABLE_JAVASCRIPT:
            g_value_set_boolean(value, self->enable_javascript);
            break;
        case SETTINGS_PROP_ALLOW_FILE_ACCESS_FROM_FILE_URLS:
            g_value_set_boolean(value, self->allow_file_access_from_file_urls);
            break;
        case SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT:
            g_value_set_boolean(value, self->enable_write_console_messages_to_stdout);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

static void gjsify_webkit_settings_set_property(
    GObject *object, guint prop_id, const GValue *value, GParamSpec *pspec)
{
    GjsifyWebKitSettings *self = GJSIFY_WEBKIT_SETTINGS(object);

    switch (prop_id) {
        case SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS:
            self->enable_developer_extras = g_value_get_boolean(value);
            break;
        case SETTINGS_PROP_ENABLE_JAVASCRIPT:
            self->enable_javascript = g_value_get_boolean(value);
            break;
        case SETTINGS_PROP_ALLOW_FILE_ACCESS_FROM_FILE_URLS:
            self->allow_file_access_from_file_urls = g_value_get_boolean(value);
            break;
        case SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT:
            self->enable_write_console_messages_to_stdout = g_value_get_boolean(value);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

static void gjsify_webkit_settings_class_init(GjsifyWebKitSettingsClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS(klass);

    object_class->get_property = gjsify_webkit_settings_get_property;
    object_class->set_property = gjsify_webkit_settings_set_property;

    settings_props[SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS] = g_param_spec_boolean(
        "enable-developer-extras", NULL, NULL, FALSE, G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);
    settings_props[SETTINGS_PROP_ENABLE_JAVASCRIPT] = g_param_spec_boolean(
        "enable-javascript", NULL, NULL, TRUE, G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);
    settings_props[SETTINGS_PROP_ALLOW_FILE_ACCESS_FROM_FILE_URLS] = g_param_spec_boolean(
        "allow-file-access-from-file-urls",
        NULL,
        NULL,
        FALSE,
        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);
    settings_props[SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT] = g_param_spec_boolean(
        "enable-write-console-messages-to-stdout",
        NULL,
        NULL,
        FALSE,
        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);

    g_object_class_install_properties(object_class, SETTINGS_N_PROPS, settings_props);
}

static void gjsify_webkit_settings_init(GjsifyWebKitSettings *self)
{
    self->enable_javascript = TRUE;
}

GjsifyWebKitSettings *gjsify_webkit_settings_new(void)
{
    return g_object_new(GJSIFY_WEBKIT_TYPE_SETTINGS, NULL);
}

/* ==========================================================================
 * GjsifyWebKitWebView
 * ========================================================================== */

typedef struct {
    void *web_view;  /* WKWebView * */
    void *delegate;  /* GjsifyWebKitNavigationDelegate * */

    GjsifyWebKitUserContentManager *user_content_manager;
    GjsifyWebKitSettings *settings;

    GdkTexture *texture;      /* what snapshot() paints */
    guint tick_id;            /* the repaint tick, live only while mapped */
    gboolean refresh_pending; /* a snapshot is in flight */
    gint64 last_refresh_us;

    /* Input. The pointer position is remembered because GTK reports it only on
     * motion, while a scroll or a key event still has to name one — AppKit has
     * no "wherever the pointer was" and WebKit hit-tests wheel events by
     * position. `buttons_down` is what makes a motion with a button held a
     * `mouseDragged:` rather than a `mouseMoved:`; WebKit distinguishes them and
     * a drag reported as a move ends text selection at the wrong character. */
    double pointer_x;
    double pointer_y;
    guint buttons_down;

    gchar *uri;
    gboolean is_loading;
} GjsifyWebKitWebViewPrivate;

/* One accessor rather than a cached pointer per function: the instance-private
 * offset is resolved by GType, and caching it is how a derived instance ends up
 * reading the base's data. */
#define PRIV(self) \
    ((GjsifyWebKitWebViewPrivate *) gjsify_webkit_web_view_get_instance_private(self))

enum { WEB_VIEW_SIGNAL_LOAD_CHANGED, WEB_VIEW_SIGNAL_LOAD_FAILED, WEB_VIEW_N_SIGNALS };
static guint web_view_signals[WEB_VIEW_N_SIGNALS] = { 0 };

enum {
    WEB_VIEW_PROP_0,
    WEB_VIEW_PROP_USER_CONTENT_MANAGER,
    WEB_VIEW_PROP_SETTINGS,
    WEB_VIEW_PROP_URI,
    WEB_VIEW_PROP_IS_LOADING,
    WEB_VIEW_N_PROPS
};
static GParamSpec *web_view_props[WEB_VIEW_N_PROPS] = { NULL };

G_DEFINE_TYPE_WITH_PRIVATE(GjsifyWebKitWebView, gjsify_webkit_web_view, GTK_TYPE_WIDGET)

static void gjsify_webkit_web_view_request_refresh(GjsifyWebKitWebView *self);

/* The navigation delegate: turns WKNavigationDelegate callbacks into the
 * load-changed/load-failed signals WebKitGTK emits. Same unowned-back-pointer
 * rule as the script-message handler. */
@interface GjsifyWebKitNavigationDelegate : NSObject <WKNavigationDelegate>
@property(nonatomic, assign) GjsifyWebKitWebView *view;
@end

@implementation GjsifyWebKitNavigationDelegate

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation
{
    (void) webView;
    (void) navigation;
    if (self.view == NULL) {
        return;
    }
    PRIV(self.view)->is_loading = TRUE;
    g_object_notify_by_pspec(G_OBJECT(self.view), web_view_props[WEB_VIEW_PROP_IS_LOADING]);
    g_signal_emit(self.view,
                  web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED],
                  0,
                  GJSIFY_WEBKIT_LOAD_STARTED);
}

- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation
{
    (void) navigation;
    if (self.view == NULL) {
        return;
    }
    g_clear_pointer(&PRIV(self.view)->uri, g_free);
    if (webView.URL != nil) {
        PRIV(self.view)->uri = g_strdup([[webView.URL absoluteString] UTF8String]);
        g_object_notify_by_pspec(G_OBJECT(self.view), web_view_props[WEB_VIEW_PROP_URI]);
    }
    g_signal_emit(self.view,
                  web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED],
                  0,
                  GJSIFY_WEBKIT_LOAD_COMMITTED);
}

- (void)webView:(WKWebView *)webView
    didReceiveServerRedirectForProvisionalNavigation:(WKNavigation *)navigation
{
    (void) webView;
    (void) navigation;
    if (self.view == NULL) {
        return;
    }
    g_signal_emit(self.view,
                  web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED],
                  0,
                  GJSIFY_WEBKIT_LOAD_REDIRECTED);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation
{
    (void) webView;
    (void) navigation;
    if (self.view == NULL) {
        return;
    }
    PRIV(self.view)->is_loading = FALSE;
    g_object_notify_by_pspec(G_OBJECT(self.view), web_view_props[WEB_VIEW_PROP_IS_LOADING]);
    g_signal_emit(self.view,
                  web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED],
                  0,
                  GJSIFY_WEBKIT_LOAD_FINISHED);
    /* The first paint a freshly loaded page can produce — without this the
     * widget stays blank until the tick callback happens to fire. */
    gjsify_webkit_web_view_request_refresh(self.view);
}

- (void)emitFailure:(NSError *)error
{
    if (self.view == NULL) {
        return;
    }
    PRIV(self.view)->is_loading = FALSE;
    g_object_notify_by_pspec(G_OBJECT(self.view), web_view_props[WEB_VIEW_PROP_IS_LOADING]);

    GError *gerror = g_error_new_literal(g_quark_from_static_string("gjsify-webkit-network"),
                                         (gint) error.code,
                                         [[error localizedDescription] UTF8String]);
    const gchar *failing_uri =
        PRIV(self.view)->uri != NULL ? PRIV(self.view)->uri : "";
    g_signal_emit(self.view,
                  web_view_signals[WEB_VIEW_SIGNAL_LOAD_FAILED],
                  0,
                  GJSIFY_WEBKIT_LOAD_STARTED,
                  failing_uri,
                  gerror);
    g_error_free(gerror);
}

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
            withError:(NSError *)error
{
    (void) webView;
    (void) navigation;
    [self emitFailure:error];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error
{
    (void) webView;
    (void) navigation;
    [self emitFailure:error];
}

@end

/* Turn a CGImage into a GdkTexture. The consumer calls
 * `texture.save_to_png_bytes()`, so this has to be a real GdkTexture and not a
 * paintable of our own. Drawing through a CGBitmapContext rather than reading
 * the CGImage's provider is deliberate: the snapshot's own colour space and
 * pixel format are not guaranteed, and the context normalises both. */
static GdkTexture *gjsify_webkit_texture_from_cgimage(CGImageRef image)
{
    if (image == NULL) {
        return NULL;
    }

    size_t width = CGImageGetWidth(image);
    size_t height = CGImageGetHeight(image);
    if (width == 0 || height == 0) {
        return NULL;
    }

    size_t stride = width * 4;
    guchar *pixels = g_malloc0(stride * height);

    CGColorSpaceRef color_space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(pixels,
                                                 width,
                                                 height,
                                                 8,
                                                 stride,
                                                 color_space,
                                                 kCGImageAlphaPremultipliedLast
                                                     | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(color_space);

    if (context == NULL) {
        g_free(pixels);
        return NULL;
    }

    CGContextDrawImage(context, CGRectMake(0, 0, (CGFloat) width, (CGFloat) height), image);
    CGContextRelease(context);

    GBytes *bytes = g_bytes_new_take(pixels, stride * height);
    GdkTexture *texture = gdk_memory_texture_new((int) width,
                                                 (int) height,
                                                 GDK_MEMORY_R8G8B8A8_PREMULTIPLIED,
                                                 bytes,
                                                 stride);
    g_bytes_unref(bytes);
    return texture;
}

/* ---- the repaint path ---------------------------------------------------
 *
 * There is no "content changed" notification from WKWebView — its content
 * lives in another process and the host holds a remote layer, not pixels. So
 * the widget PULLS: it asks for a snapshot, and asks again next frame. That is
 * the whole reason this is a throttle and not an event handler.
 *
 * Measured on this host (GPU-less VM, 1024x768): takeSnapshot averages 15.8 ms,
 * a ~63 fps ceiling. The throttle below sits well under it so a slow snapshot
 * cannot queue up behind itself, and `refresh_pending` guarantees at most one
 * is ever in flight.
 * ------------------------------------------------------------------------- */

#define GJSIFY_WEBKIT_REFRESH_INTERVAL_US (G_USEC_PER_SEC / 30)

static void gjsify_webkit_web_view_request_refresh(GjsifyWebKitWebView *self)
{
    if (PRIV(self)->refresh_pending || PRIV(self)->web_view == NULL) {
        return;
    }

    int width = gtk_widget_get_width(GTK_WIDGET(self));
    int height = gtk_widget_get_height(GTK_WIDGET(self));
    if (width <= 0 || height <= 0) {
        return;
    }

    PRIV(self)->refresh_pending = TRUE;
    PRIV(self)->last_refresh_us = g_get_monotonic_time();

    /* The widget must outlive the completion handler; the block runs on the
     * next CFRunLoop drain, by which time a GJS consumer may have dropped its
     * last reference. */
    g_object_ref(self);

    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        WKSnapshotConfiguration *config = [[WKSnapshotConfiguration alloc] init];
        [web_view takeSnapshotWithConfiguration:config
                             completionHandler:^(NSImage *image, NSError *error) {
            PRIV(self)->refresh_pending = FALSE;
            if (error == nil && image != nil) {
                CGImageRef cg = [image CGImageForProposedRect:NULL context:nil hints:nil];
                GdkTexture *texture = gjsify_webkit_texture_from_cgimage(cg);
                if (texture != NULL) {
                    g_clear_object(&PRIV(self)->texture);
                    PRIV(self)->texture = texture;
                    gtk_widget_queue_draw(GTK_WIDGET(self));
                }
            }
            g_object_unref(self);
        }];
    }
}

static gboolean gjsify_webkit_web_view_tick(
    GtkWidget *widget, GdkFrameClock *frame_clock, gpointer user_data)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(widget);
    (void) frame_clock;
    (void) user_data;

    if (g_get_monotonic_time() - PRIV(self)->last_refresh_us >= GJSIFY_WEBKIT_REFRESH_INTERVAL_US) {
        gjsify_webkit_web_view_request_refresh(self);
    }
    return G_SOURCE_CONTINUE;
}

/* ==========================================================================
 * Input forwarding — GTK event controllers in, synthesized NSEvents out.
 *
 * docs/poc/webkit-input-darwin.m is the measurement this rests on, and it
 * overturned the design that was expected. The short version:
 *
 *   - A WINDOWLESS WKWebView takes mouse, key and wheel events. No NSWindow, no
 *     first responder, no activation-policy change: all three were built and
 *     measured INDISTINGUISHABLE from the bare view, and the offscreen-window
 *     variant was strictly worse (it never became key, and it dragged the wheel
 *     event's location out of the view).
 *   - An NSEvent's `locationInWindow` is BOTTOM-LEFT window space even though
 *     `-[WKWebView isFlipped]` is YES, because WebKit converts with
 *     `-[NSView convertPoint:fromView:nil]`. So a GTK y is flipped exactly once.
 *     Getting this wrong is an off-by-viewport-height bug that looks like
 *     "clicks land on the wrong element" and nothing else.
 *   - A forwarded click focuses the element under it, so DOM focus follows the
 *     pointer exactly as on Linux and there is no separate focus channel.
 *
 * What this does NOT reach is `document.hasFocus()`, which stays FALSE: it is a
 * page-level activity-state flag WebKit derives from the responder chain, and
 * the public API offers no way to set it without a window. `window.onfocus` /
 * `onblur` therefore do not fire. Measured, not assumed — the probe reports it.
 * ========================================================================== */

/* WebCore's own `Scrollbar::pixelsPerLineStep()`. GTK reports scroll deltas in
 * wheel steps and the probe measured `kCGScrollEventUnitPixel` to be 1:1 with
 * CSS pixels, so this is the one number between them — and taking WebKit's
 * rather than inventing one keeps a wheel click scrolling the same distance as
 * it does through WebKitGTK. */
#define GJSIFY_WEBKIT_PIXELS_PER_SCROLL_STEP 40.0

static NSEventModifierFlags gjsify_webkit_modifier_flags(GdkModifierType state)
{
    NSEventModifierFlags flags = 0;

    if (state & GDK_SHIFT_MASK) {
        flags |= NSEventModifierFlagShift;
    }
    if (state & GDK_CONTROL_MASK) {
        flags |= NSEventModifierFlagControl;
    }
    if (state & GDK_ALT_MASK) {
        flags |= NSEventModifierFlagOption;
    }
    /* Command, not Super: GDK's macOS backend maps NSEventModifierFlagCommand
     * onto GDK_META_MASK, so this is the round trip of that mapping. */
    if (state & GDK_META_MASK) {
        flags |= NSEventModifierFlagCommand;
    }
    if (state & GDK_LOCK_MASK) {
        flags |= NSEventModifierFlagCapsLock;
    }
    return flags;
}

/* The single flip. GTK hands top-left widget coordinates; an NSEvent's location
 * is bottom-left window space, and the view sits at the window origin. */
static NSPoint gjsify_webkit_event_location(GjsifyWebKitWebView *self, double x, double y)
{
    return NSMakePoint(x, (double) gtk_widget_get_height(GTK_WIDGET(self)) - y);
}

static double gjsify_webkit_event_timestamp(void)
{
    return [[NSProcessInfo processInfo] systemUptime];
}

static NSEvent *gjsify_webkit_mouse_event(GjsifyWebKitWebView *self,
                                          NSEventType type,
                                          double x,
                                          double y,
                                          GdkModifierType state,
                                          int click_count)
{
    return [NSEvent mouseEventWithType:type
                              location:gjsify_webkit_event_location(self, x, y)
                         modifierFlags:gjsify_webkit_modifier_flags(state)
                             timestamp:gjsify_webkit_event_timestamp()
                          windowNumber:0
                               context:nil
                           eventNumber:0
                            clickCount:click_count
                              pressure:type == NSEventTypeLeftMouseDown ? 1.0 : 0.0];
}

/* GTK numbers buttons 1/2/3 = left/middle/right; AppKit has a dedicated event
 * type and selector per button and lumps everything else into "other". WebKit
 * reads the TYPE rather than the button number (`mouseButtonForEvent` maps
 * NSEventTypeOtherMouse* straight to Middle), so the type is what has to be
 * right here. */
static void gjsify_webkit_send_button(GjsifyWebKitWebView *self,
                                      guint button,
                                      gboolean pressed,
                                      double x,
                                      double y,
                                      GdkModifierType state,
                                      int click_count)
{
    WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
    if (web_view == nil) {
        return;
    }

    NSEventType type;
    switch (button) {
        case GDK_BUTTON_PRIMARY:
            type = pressed ? NSEventTypeLeftMouseDown : NSEventTypeLeftMouseUp;
            break;
        case GDK_BUTTON_SECONDARY:
            type = pressed ? NSEventTypeRightMouseDown : NSEventTypeRightMouseUp;
            break;
        default:
            type = pressed ? NSEventTypeOtherMouseDown : NSEventTypeOtherMouseUp;
            break;
    }

    NSEvent *event = gjsify_webkit_mouse_event(self, type, x, y, state, click_count);
    if (event == nil) {
        return;
    }

    switch (type) {
        case NSEventTypeLeftMouseDown: [web_view mouseDown:event]; break;
        case NSEventTypeLeftMouseUp: [web_view mouseUp:event]; break;
        case NSEventTypeRightMouseDown: [web_view rightMouseDown:event]; break;
        case NSEventTypeRightMouseUp: [web_view rightMouseUp:event]; break;
        case NSEventTypeOtherMouseDown: [web_view otherMouseDown:event]; break;
        default: [web_view otherMouseUp:event]; break;
    }
}

static void gjsify_webkit_on_pressed(
    GtkGestureClick *gesture, gint n_press, gdouble x, gdouble y, gpointer user_data)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(user_data);
    guint button = gtk_gesture_single_get_current_button(GTK_GESTURE_SINGLE(gesture));
    GdkModifierType state =
        gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(gesture));

    /* Keyboard focus follows the click, as it does in every other GTK text
     * surface — without it the widget never becomes the key target and the
     * keystrokes that should follow a click go to whatever had focus before. */
    gtk_widget_grab_focus(GTK_WIDGET(self));

    PRIV(self)->pointer_x = x;
    PRIV(self)->pointer_y = y;
    PRIV(self)->buttons_down |= 1u << button;

    gjsify_webkit_send_button(self, button, TRUE, x, y, state, n_press);
    gjsify_webkit_web_view_request_refresh(self);
}

static void gjsify_webkit_on_released(
    GtkGestureClick *gesture, gint n_press, gdouble x, gdouble y, gpointer user_data)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(user_data);
    guint button = gtk_gesture_single_get_current_button(GTK_GESTURE_SINGLE(gesture));
    GdkModifierType state =
        gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(gesture));

    PRIV(self)->pointer_x = x;
    PRIV(self)->pointer_y = y;
    PRIV(self)->buttons_down &= ~(1u << button);

    gjsify_webkit_send_button(self, button, FALSE, x, y, state, n_press);
    gjsify_webkit_web_view_request_refresh(self);
}

static void gjsify_webkit_on_motion(
    GtkEventControllerMotion *controller, gdouble x, gdouble y, gpointer user_data)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(user_data);
    WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
    if (web_view == nil) {
        return;
    }

    GdkModifierType state =
        gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(controller));

    PRIV(self)->pointer_x = x;
    PRIV(self)->pointer_y = y;

    /* A move with a button held is a DRAG to WebKit, and reporting it as a plain
     * move breaks text selection and HTML5 drag-and-drop. */
    if (PRIV(self)->buttons_down & (1u << GDK_BUTTON_PRIMARY)) {
        [web_view mouseDragged:gjsify_webkit_mouse_event(
                                   self, NSEventTypeLeftMouseDragged, x, y, state, 1)];
    } else if (PRIV(self)->buttons_down & (1u << GDK_BUTTON_SECONDARY)) {
        [web_view rightMouseDragged:gjsify_webkit_mouse_event(
                                        self, NSEventTypeRightMouseDragged, x, y, state, 1)];
    } else if (PRIV(self)->buttons_down != 0) {
        [web_view otherMouseDragged:gjsify_webkit_mouse_event(
                                        self, NSEventTypeOtherMouseDragged, x, y, state, 1)];
    } else {
        [web_view mouseMoved:gjsify_webkit_mouse_event(
                                 self, NSEventTypeMouseMoved, x, y, state, 0)];
    }
}

static void gjsify_webkit_on_leave(GtkEventControllerMotion *controller, gpointer user_data)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(user_data);
    WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
    (void) controller;
    if (web_view == nil) {
        return;
    }

    /* Without this the last hovered element keeps its :hover state forever,
     * because nothing else ever tells the page the pointer went away. A
     * tracking number of 0 is correct for a synthesized event: WebKit reads the
     * type and the location, not the tracking area it did not install. */
    NSEvent *event = [NSEvent enterExitEventWithType:NSEventTypeMouseExited
                                            location:gjsify_webkit_event_location(
                                                         self,
                                                         PRIV(self)->pointer_x,
                                                         PRIV(self)->pointer_y)
                                       modifierFlags:0
                                           timestamp:gjsify_webkit_event_timestamp()
                                        windowNumber:0
                                             context:nil
                                         eventNumber:0
                                        trackingNumber:0
                                            userData:NULL];
    if (event != nil) {
        [web_view mouseExited:event];
    }
    gjsify_webkit_web_view_request_refresh(self);
}

static gboolean gjsify_webkit_on_scroll(
    GtkEventControllerScroll *controller, gdouble dx, gdouble dy, gpointer user_data)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(user_data);
    WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
    (void) controller;
    if (web_view == nil) {
        return GDK_EVENT_PROPAGATE;
    }

    /* NSEvent has no public constructor for a scroll event carrying deltas, so
     * it comes from a CGEvent. The sign flips because GDK counts positive
     * downward and AppKit counts positive upward. */
    CGEventRef cg = CGEventCreateScrollWheelEvent(
        NULL,
        kCGScrollEventUnitPixel,
        2,
        (int32_t) -(dy * GJSIFY_WEBKIT_PIXELS_PER_SCROLL_STEP),
        (int32_t) -(dx * GJSIFY_WEBKIT_PIXELS_PER_SCROLL_STEP));
    if (cg == NULL) {
        return GDK_EVENT_PROPAGATE;
    }

    /* windowNumber stays 0, i.e. the location stays in the view's own space.
     * Pointing it at a window is what broke scrolling in the offscreen-window
     * design the probe threw away. */
    NSEvent *event = [NSEvent eventWithCGEvent:cg];
    if (event != nil) {
        [web_view scrollWheel:event];
    }
    CFRelease(cg);

    gjsify_webkit_web_view_request_refresh(self);
    return GDK_EVENT_STOP;
}

/* GDK keyvals that carry no Unicode character have to be spelled as the
 * private-use characters AppKit defines for them, because that is what WebKit
 * pattern-matches on to recognise an arrow or a function key. Everything with a
 * real character (including Return, Tab, Escape and Backspace, which map to
 * their ASCII control codes) falls through to gdk_keyval_to_unicode(). */
static NSString *gjsify_webkit_characters_for_keyval(guint keyval)
{
    unichar character;

    switch (keyval) {
        case GDK_KEY_Up: character = NSUpArrowFunctionKey; break;
        case GDK_KEY_Down: character = NSDownArrowFunctionKey; break;
        case GDK_KEY_Left: character = NSLeftArrowFunctionKey; break;
        case GDK_KEY_Right: character = NSRightArrowFunctionKey; break;
        case GDK_KEY_Home: character = NSHomeFunctionKey; break;
        case GDK_KEY_End: character = NSEndFunctionKey; break;
        case GDK_KEY_Page_Up: character = NSPageUpFunctionKey; break;
        case GDK_KEY_Page_Down: character = NSPageDownFunctionKey; break;
        case GDK_KEY_Insert: character = NSInsertFunctionKey; break;
        case GDK_KEY_Delete: character = NSDeleteFunctionKey; break;
        case GDK_KEY_Menu: character = NSMenuFunctionKey; break;
        default:
            if (keyval >= GDK_KEY_F1 && keyval <= GDK_KEY_F35) {
                character = (unichar) (NSF1FunctionKey + (keyval - GDK_KEY_F1));
                break;
            }
            {
                guint32 unicode = gdk_keyval_to_unicode(keyval);
                if (unicode == 0) {
                    return @"";
                }
                /* Beyond the BMP an NSString needs a surrogate pair, which a
                 * single unichar cannot hold. */
                return [[NSString alloc] initWithBytes:&unicode
                                                length:sizeof(unicode)
                                              encoding:NSUTF32LittleEndianStringEncoding];
            }
    }

    return [NSString stringWithCharacters:&character length:1];
}

static gboolean gjsify_webkit_send_key(
    GjsifyWebKitWebView *self, guint keyval, guint keycode, GdkModifierType state, gboolean pressed)
{
    WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
    if (web_view == nil) {
        return GDK_EVENT_PROPAGATE;
    }

    NSString *characters = gjsify_webkit_characters_for_keyval(keyval);
    NSEventModifierFlags flags = gjsify_webkit_modifier_flags(state);

    /* GDK's hardware keycode IS the Carbon virtual keycode on the macOS backend,
     * which is the only backend this file compiles for — so it passes through
     * rather than being translated. WebKit needs it for layout-independent
     * shortcuts, where the character is the wrong key to match on. */
    NSEvent *event = [NSEvent keyEventWithType:pressed ? NSEventTypeKeyDown : NSEventTypeKeyUp
                                      location:gjsify_webkit_event_location(
                                                   self, PRIV(self)->pointer_x, PRIV(self)->pointer_y)
                                 modifierFlags:flags
                                     timestamp:gjsify_webkit_event_timestamp()
                                  windowNumber:0
                                       context:nil
                                    characters:characters
                   charactersIgnoringModifiers:characters
                                     isARepeat:NO
                                       keyCode:(unsigned short) keycode];
    if (event == nil) {
        return GDK_EVENT_PROPAGATE;
    }

    /* A Command chord is a key EQUIVALENT on macOS, not a key down — that is the
     * path Cmd+C/V/A/Z travel, and WebKit only implements the editing commands
     * behind it. Sending one as a plain keyDown: types nothing and copies
     * nothing. It answers whether it consumed the chord, so an unhandled one
     * still falls through to the normal path. */
    if (pressed && (flags & NSEventModifierFlagCommand) != 0) {
        if ([web_view performKeyEquivalent:event]) {
            gjsify_webkit_web_view_request_refresh(self);
            return GDK_EVENT_STOP;
        }
    }

    if (pressed) {
        [web_view keyDown:event];
    } else {
        [web_view keyUp:event];
    }

    gjsify_webkit_web_view_request_refresh(self);
    return GDK_EVENT_STOP;
}

static gboolean gjsify_webkit_on_key_pressed(GtkEventControllerKey *controller,
                                             guint keyval,
                                             guint keycode,
                                             GdkModifierType state,
                                             gpointer user_data)
{
    (void) controller;
    return gjsify_webkit_send_key(
        GJSIFY_WEBKIT_WEB_VIEW(user_data), keyval, keycode, state, TRUE);
}

static void gjsify_webkit_on_key_released(GtkEventControllerKey *controller,
                                          guint keyval,
                                          guint keycode,
                                          GdkModifierType state,
                                          gpointer user_data)
{
    (void) controller;
    gjsify_webkit_send_key(GJSIFY_WEBKIT_WEB_VIEW(user_data), keyval, keycode, state, FALSE);
}

/* No GtkIMContext is attached, and that is deliberate rather than missing.
 * WebKit routes `keyDown:` through `-[NSView interpretKeyEvents:]` into its own
 * NSTextInputClient, which IS the macOS input-method path — dead keys and
 * marked text are handled by the same code a Safari text field uses. Attaching
 * a second IM context on the GTK side would compose the input twice. */
static void gjsify_webkit_web_view_install_input(GjsifyWebKitWebView *self)
{
    GtkWidget *widget = GTK_WIDGET(self);

    /* WebKitWebView is focusable; a web view that cannot take focus cannot be
     * typed into, and GtkEventControllerKey only fires on the focus target. */
    gtk_widget_set_focusable(widget, TRUE);

    GtkGesture *click = gtk_gesture_click_new();
    /* Button 0 means "every button" — the default of 1 would drop right-clicks,
     * so a page's context menu handler would never fire. */
    gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(click), 0);
    g_signal_connect(click, "pressed", G_CALLBACK(gjsify_webkit_on_pressed), self);
    g_signal_connect(click, "released", G_CALLBACK(gjsify_webkit_on_released), self);
    gtk_widget_add_controller(widget, GTK_EVENT_CONTROLLER(click));

    GtkEventController *motion = gtk_event_controller_motion_new();
    g_signal_connect(motion, "motion", G_CALLBACK(gjsify_webkit_on_motion), self);
    g_signal_connect(motion, "leave", G_CALLBACK(gjsify_webkit_on_leave), self);
    gtk_widget_add_controller(widget, motion);

    GtkEventController *scroll =
        gtk_event_controller_scroll_new(GTK_EVENT_CONTROLLER_SCROLL_BOTH_AXES);
    g_signal_connect(scroll, "scroll", G_CALLBACK(gjsify_webkit_on_scroll), self);
    gtk_widget_add_controller(widget, scroll);

    GtkEventController *key = gtk_event_controller_key_new();
    g_signal_connect(key, "key-pressed", G_CALLBACK(gjsify_webkit_on_key_pressed), self);
    g_signal_connect(key, "key-released", G_CALLBACK(gjsify_webkit_on_key_released), self);
    gtk_widget_add_controller(widget, key);
}

static void gjsify_webkit_web_view_map(GtkWidget *widget)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(widget);

    GTK_WIDGET_CLASS(gjsify_webkit_web_view_parent_class)->map(widget);

    /* Ticking only while mapped is what keeps an unmapped view from paying for
     * snapshots nobody can see. */
    if (PRIV(self)->tick_id == 0) {
        PRIV(self)->tick_id =
            gtk_widget_add_tick_callback(widget, gjsify_webkit_web_view_tick, NULL, NULL);
    }
    gjsify_webkit_web_view_request_refresh(self);
}

static void gjsify_webkit_web_view_unmap(GtkWidget *widget)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(widget);

    if (PRIV(self)->tick_id != 0) {
        gtk_widget_remove_tick_callback(widget, PRIV(self)->tick_id);
        PRIV(self)->tick_id = 0;
    }

    GTK_WIDGET_CLASS(gjsify_webkit_web_view_parent_class)->unmap(widget);
}

static void gjsify_webkit_web_view_size_allocate(
    GtkWidget *widget, int width, int height, int baseline)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(widget);

    GTK_WIDGET_CLASS(gjsify_webkit_web_view_parent_class)
        ->size_allocate(widget, width, height, baseline);

    /* The offscreen WKWebView's frame IS the viewport the page lays out to, so
     * it has to follow the widget or the page renders at the wrong width. */
    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        if (web_view != nil) {
            [web_view setFrame:NSMakeRect(0, 0, width, height)];
        }
    }

    gjsify_webkit_web_view_request_refresh(self);
}

static void gjsify_webkit_web_view_measure(GtkWidget *widget,
                                           GtkOrientation orientation,
                                           int for_size,
                                           int *minimum,
                                           int *natural,
                                           int *minimum_baseline,
                                           int *natural_baseline)
{
    (void) widget;
    (void) for_size;

    /* Same shape as WebKitWebView: no intrinsic size, expands into whatever it
     * is given. A non-zero minimum would stop it shrinking inside a paned. */
    *minimum = 0;
    *natural = orientation == GTK_ORIENTATION_HORIZONTAL ? 640 : 480;
    *minimum_baseline = -1;
    *natural_baseline = -1;
}

static void gjsify_webkit_web_view_snapshot(GtkWidget *widget, GtkSnapshot *snapshot)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(widget);

    if (PRIV(self)->texture == NULL) {
        return;
    }

    graphene_rect_t bounds;
    graphene_rect_init(&bounds,
                       0,
                       0,
                       (float) gtk_widget_get_width(widget),
                       (float) gtk_widget_get_height(widget));
    gtk_snapshot_append_texture(snapshot, PRIV(self)->texture, &bounds);
}

static void gjsify_webkit_web_view_get_property(
    GObject *object, guint prop_id, GValue *value, GParamSpec *pspec)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(object);

    switch (prop_id) {
        case WEB_VIEW_PROP_USER_CONTENT_MANAGER:
            g_value_set_object(value, PRIV(self)->user_content_manager);
            break;
        case WEB_VIEW_PROP_SETTINGS:
            g_value_set_object(value, PRIV(self)->settings);
            break;
        case WEB_VIEW_PROP_URI:
            g_value_set_string(value, PRIV(self)->uri);
            break;
        case WEB_VIEW_PROP_IS_LOADING:
            g_value_set_boolean(value, PRIV(self)->is_loading);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

static void gjsify_webkit_web_view_set_property(
    GObject *object, guint prop_id, const GValue *value, GParamSpec *pspec)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(object);

    switch (prop_id) {
        case WEB_VIEW_PROP_USER_CONTENT_MANAGER: {
            GObject *manager = g_value_get_object(value);
            if (manager != NULL) {
                g_set_object(&PRIV(self)->user_content_manager,
                             GJSIFY_WEBKIT_USER_CONTENT_MANAGER(manager));
            }
            break;
        }
        case WEB_VIEW_PROP_SETTINGS: {
            GObject *settings = g_value_get_object(value);
            if (settings != NULL) {
                g_set_object(&PRIV(self)->settings, GJSIFY_WEBKIT_SETTINGS(settings));
            }
            break;
        }
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

/* The WKWebView cannot be built in init(): it needs the user-content-manager
 * construct property, which GObject only delivers afterwards. constructed() is
 * the first point where both are known. */
static void gjsify_webkit_web_view_constructed(GObject *object)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(object);

    G_OBJECT_CLASS(gjsify_webkit_web_view_parent_class)->constructed(object);

    if (PRIV(self)->user_content_manager == NULL) {
        PRIV(self)->user_content_manager = gjsify_webkit_user_content_manager_new();
    }
    if (PRIV(self)->settings == NULL) {
        PRIV(self)->settings = gjsify_webkit_settings_new();
    }

    @autoreleasepool {
        WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
        config.userContentController =
            (__bridge WKUserContentController *) PRIV(self)->user_content_manager->controller;
        config.preferences.javaScriptCanOpenWindowsAutomatically = NO;
        if (PRIV(self)->settings->enable_developer_extras) {
            [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
        }

        WKWebView *web_view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 640, 480)
                                                 configuration:config];
        GjsifyWebKitNavigationDelegate *delegate =
            [[GjsifyWebKitNavigationDelegate alloc] init];
        delegate.view = self;
        web_view.navigationDelegate = delegate;

        PRIV(self)->web_view = (void *) CFBridgingRetain(web_view);
        PRIV(self)->delegate = (void *) CFBridgingRetain(delegate);
    }

    /* After the WKWebView exists: every controller callback forwards to it, and
     * a controller that fired before it was built would have to check for NULL
     * on a path that cannot otherwise happen. */
    gjsify_webkit_web_view_install_input(self);
}

static void gjsify_webkit_web_view_dispose(GObject *object)
{
    GjsifyWebKitWebView *self = GJSIFY_WEBKIT_WEB_VIEW(object);

    if (PRIV(self)->tick_id != 0) {
        gtk_widget_remove_tick_callback(GTK_WIDGET(self), PRIV(self)->tick_id);
        PRIV(self)->tick_id = 0;
    }

    @autoreleasepool {
        GjsifyWebKitNavigationDelegate *delegate =
            (__bridge GjsifyWebKitNavigationDelegate *) PRIV(self)->delegate;
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        if (delegate != nil) {
            delegate.view = NULL;
        }
        if (web_view != nil) {
            web_view.navigationDelegate = nil;
            [web_view stopLoading];
        }
        if (PRIV(self)->delegate != NULL) {
            CFRelease(PRIV(self)->delegate);
            PRIV(self)->delegate = NULL;
        }
        if (PRIV(self)->web_view != NULL) {
            CFRelease(PRIV(self)->web_view);
            PRIV(self)->web_view = NULL;
            gjsify_webkit_pump_unref();
        }
    }

    g_clear_object(&PRIV(self)->texture);
    g_clear_object(&PRIV(self)->user_content_manager);
    g_clear_object(&PRIV(self)->settings);
    g_clear_pointer(&PRIV(self)->uri, g_free);

    G_OBJECT_CLASS(gjsify_webkit_web_view_parent_class)->dispose(object);
}

static void gjsify_webkit_web_view_class_init(GjsifyWebKitWebViewClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS(klass);
    GtkWidgetClass *widget_class = GTK_WIDGET_CLASS(klass);

    object_class->constructed = gjsify_webkit_web_view_constructed;
    object_class->dispose = gjsify_webkit_web_view_dispose;
    object_class->get_property = gjsify_webkit_web_view_get_property;
    object_class->set_property = gjsify_webkit_web_view_set_property;

    widget_class->map = gjsify_webkit_web_view_map;
    widget_class->unmap = gjsify_webkit_web_view_unmap;
    widget_class->measure = gjsify_webkit_web_view_measure;
    widget_class->size_allocate = gjsify_webkit_web_view_size_allocate;
    widget_class->snapshot = gjsify_webkit_web_view_snapshot;

    web_view_props[WEB_VIEW_PROP_USER_CONTENT_MANAGER] = g_param_spec_object(
        "user-content-manager",
        NULL,
        NULL,
        GJSIFY_WEBKIT_TYPE_USER_CONTENT_MANAGER,
        G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS);
    web_view_props[WEB_VIEW_PROP_SETTINGS] =
        g_param_spec_object("settings",
                            NULL,
                            NULL,
                            GJSIFY_WEBKIT_TYPE_SETTINGS,
                            G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS);
    web_view_props[WEB_VIEW_PROP_URI] =
        g_param_spec_string("uri", NULL, NULL, NULL, G_PARAM_READABLE | G_PARAM_STATIC_STRINGS);
    web_view_props[WEB_VIEW_PROP_IS_LOADING] = g_param_spec_boolean(
        "is-loading", NULL, NULL, FALSE, G_PARAM_READABLE | G_PARAM_STATIC_STRINGS);

    g_object_class_install_properties(object_class, WEB_VIEW_N_PROPS, web_view_props);

    /**
     * GjsifyWebKitWebView::load-changed:
     * @self: the view.
     * @load_event: the stage the load reached.
     */
    web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED] = g_signal_new("load-changed",
                                                                  GJSIFY_WEBKIT_TYPE_WEB_VIEW,
                                                                  G_SIGNAL_RUN_LAST,
                                                                  0,
                                                                  NULL,
                                                                  NULL,
                                                                  NULL,
                                                                  G_TYPE_NONE,
                                                                  1,
                                                                  G_TYPE_INT);

    /**
     * GjsifyWebKitWebView::load-failed:
     * @self: the view.
     * @load_event: the stage the load failed at.
     * @failing_uri: the URI that failed.
     * @error: the error.
     */
    web_view_signals[WEB_VIEW_SIGNAL_LOAD_FAILED] = g_signal_new("load-failed",
                                                                 GJSIFY_WEBKIT_TYPE_WEB_VIEW,
                                                                 G_SIGNAL_RUN_LAST,
                                                                 0,
                                                                 NULL,
                                                                 NULL,
                                                                 NULL,
                                                                 G_TYPE_BOOLEAN,
                                                                 3,
                                                                 G_TYPE_INT,
                                                                 G_TYPE_STRING,
                                                                 G_TYPE_ERROR);
}

static void gjsify_webkit_web_view_init(GjsifyWebKitWebView *self)
{
    gjsify_webkit_ensure_app();
    gjsify_webkit_pump_ref();
    (void) self;
}

GtkWidget *gjsify_webkit_web_view_new(void)
{
    return GTK_WIDGET(g_object_new(GJSIFY_WEBKIT_TYPE_WEB_VIEW, NULL));
}

void gjsify_webkit_web_view_load_uri(GjsifyWebKitWebView *self, const gchar *uri)
{
    g_return_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self));
    g_return_if_fail(uri != NULL);

    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        NSURL *url = [NSURL URLWithString:@(uri)];
        if (url == nil) {
            g_warning("GjsifyWebKit: not a valid URI: %s", uri);
            return;
        }
        if ([url isFileURL]) {
            /* A file:// load needs an explicitly granted read scope; without it
             * WKWebView fails the navigation rather than reading the file. */
            [web_view loadFileURL:url allowingReadAccessToURL:[url URLByDeletingLastPathComponent]];
        } else {
            [web_view loadRequest:[NSURLRequest requestWithURL:url]];
        }
    }
}

void gjsify_webkit_web_view_load_html(
    GjsifyWebKitWebView *self, const gchar *content, const gchar *base_uri)
{
    g_return_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self));
    g_return_if_fail(content != NULL);

    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        NSURL *base = base_uri != NULL ? [NSURL URLWithString:@(base_uri)] : nil;
        [web_view loadHTMLString:@(content) baseURL:base];
    }
}

void gjsify_webkit_web_view_reload(GjsifyWebKitWebView *self)
{
    g_return_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self));

    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        [web_view reload];
    }
}

const gchar *gjsify_webkit_web_view_get_uri(GjsifyWebKitWebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self), NULL);
    return PRIV(self)->uri;
}

gboolean gjsify_webkit_web_view_is_loading(GjsifyWebKitWebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self), FALSE);
    return PRIV(self)->is_loading;
}

GjsifyWebKitUserContentManager *gjsify_webkit_web_view_get_user_content_manager(
    GjsifyWebKitWebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self), NULL);
    return PRIV(self)->user_content_manager;
}

GjsifyWebKitSettings *gjsify_webkit_web_view_get_settings(GjsifyWebKitWebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self), NULL);
    return PRIV(self)->settings;
}

void gjsify_webkit_web_view_evaluate_javascript(
    GjsifyWebKitWebView *self,
    const gchar *script,
    gssize length,
    const gchar *world_name,
    const gchar *source_uri,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data)
{
    GTask *task;
    gchar *source;

    g_return_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self));
    g_return_if_fail(script != NULL);
    (void) source_uri;

    task = g_task_new(self, cancellable, callback, user_data);
    g_task_set_source_tag(task, gjsify_webkit_web_view_evaluate_javascript);

    if (world_name != NULL) {
        g_task_return_new_error(task,
                                G_IO_ERROR,
                                G_IO_ERROR_NOT_SUPPORTED,
                                "named script worlds are not available on the darwin backend");
        g_object_unref(task);
        return;
    }

    source = length < 0 ? g_strdup(script) : g_strndup(script, (gsize) length);

    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        [web_view evaluateJavaScript:@(source)
                   completionHandler:^(id result, NSError *error) {
            if (error != nil) {
                g_task_return_new_error(task,
                                        G_IO_ERROR,
                                        G_IO_ERROR_FAILED,
                                        "%s",
                                        [[error localizedDescription] UTF8String]);
            } else {
                g_task_return_pointer(
                    task, gjsify_webkit_value_new_from_objc(result), g_object_unref);
            }
            g_object_unref(task);
        }];
    }

    g_free(source);
}

GjsifyWebKitValue *gjsify_webkit_web_view_evaluate_javascript_finish(
    GjsifyWebKitWebView *self, GAsyncResult *result, GError **error)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self), NULL);
    g_return_val_if_fail(g_task_is_valid(result, self), NULL);

    return g_task_propagate_pointer(G_TASK(result), error);
}

void gjsify_webkit_web_view_get_snapshot(
    GjsifyWebKitWebView *self,
    GjsifyWebKitSnapshotRegion region,
    GjsifyWebKitSnapshotOptions options,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data)
{
    GTask *task;

    g_return_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self));

    task = g_task_new(self, cancellable, callback, user_data);
    g_task_set_source_tag(task, gjsify_webkit_web_view_get_snapshot);

    @autoreleasepool {
        WKWebView *web_view = (__bridge WKWebView *) PRIV(self)->web_view;
        WKSnapshotConfiguration *config = [[WKSnapshotConfiguration alloc] init];

        config.afterScreenUpdates = YES;

        if (options & GJSIFY_WEBKIT_SNAPSHOT_OPTIONS_TRANSPARENT_BACKGROUND) {
            /* `NO` means "do not draw the page's own background", which is what
             * a transparent snapshot needs. */
            config.afterScreenUpdates = YES;
            [config setValue:@NO forKey:@"_usesContentsRect"];
        }

        if (region == GJSIFY_WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT) {
            /* A nil rect means "the whole scrollable content", which is exactly
             * WebKitGTK's FULL_DOCUMENT. The default (CGRectNull) already is
             * that; spelled out so the two regions are visibly different code. */
            config.rect = CGRectNull;
        } else {
            config.rect = CGRectMake(0,
                                     0,
                                     gtk_widget_get_width(GTK_WIDGET(self)),
                                     gtk_widget_get_height(GTK_WIDGET(self)));
        }

        [web_view takeSnapshotWithConfiguration:config
                             completionHandler:^(NSImage *image, NSError *error) {
            if (error != nil || image == nil) {
                g_task_return_new_error(
                    task,
                    G_IO_ERROR,
                    G_IO_ERROR_FAILED,
                    "%s",
                    error != nil ? [[error localizedDescription] UTF8String] : "no image");
            } else {
                CGImageRef cg = [image CGImageForProposedRect:NULL context:nil hints:nil];
                GdkTexture *texture = gjsify_webkit_texture_from_cgimage(cg);
                if (texture == NULL) {
                    g_task_return_new_error(task,
                                            G_IO_ERROR,
                                            G_IO_ERROR_FAILED,
                                            "could not convert the snapshot to a texture");
                } else {
                    g_task_return_pointer(task, texture, g_object_unref);
                }
            }
            g_object_unref(task);
        }];
    }
}

GdkTexture *gjsify_webkit_web_view_get_snapshot_finish(
    GjsifyWebKitWebView *self, GAsyncResult *result, GError **error)
{
    g_return_val_if_fail(GJSIFY_WEBKIT_IS_WEB_VIEW(self), NULL);
    g_return_val_if_fail(g_task_is_valid(result, self), NULL);

    return g_task_propagate_pointer(G_TASK(result), error);
}
