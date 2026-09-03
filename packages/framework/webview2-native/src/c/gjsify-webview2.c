/* SPDX-License-Identifier: MIT
 *
 * GjsifyWebView2 — the portable half: the GObject types `@gjsify/iframe` talks
 * to, the GTK widget, and the allocation/visibility bookkeeping stage 1 needs.
 * Nothing here knows what WebView2 is; everything that does lives behind
 * `gjsify-webview2-backend.h`. See docs/adr/0035-web-view-on-win32.md.
 */

#include "gjsify-webview2-backend.h"

#include <string.h>

/* ==========================================================================
 * GjsifyWebView2Value
 *
 * WebView2 hands results back as JSON text, so there is no live JS value to
 * wrap and this type is a decoded string plus the three probes the consumer
 * uses. The decode is here rather than in the engine because it is the same
 * decode on any engine that speaks JSON, and because C++ is not where a
 * string-escape loop wants to live.
 * ========================================================================== */

struct _GjsifyWebView2Value {
    GObject parent_instance;
    gchar *string;
    gboolean is_string;
    gboolean is_null;
    gboolean is_undefined;
};

G_DEFINE_FINAL_TYPE(GjsifyWebView2Value, gjsify_webview2_value, G_TYPE_OBJECT)

static void gjsify_webview2_value_finalize(GObject *object)
{
    GjsifyWebView2Value *self = GJSIFY_WEBVIEW2_VALUE(object);
    g_clear_pointer(&self->string, g_free);
    G_OBJECT_CLASS(gjsify_webview2_value_parent_class)->finalize(object);
}

static void gjsify_webview2_value_class_init(GjsifyWebView2ValueClass *klass)
{
    G_OBJECT_CLASS(klass)->finalize = gjsify_webview2_value_finalize;
}

static void gjsify_webview2_value_init(GjsifyWebView2Value *self)
{
    (void) self;
}

/* Appends one UTF-8 encoding of @cp, which is the only part of \uXXXX decoding
 * that is not bookkeeping. */
static void gjsify_webview2_append_codepoint(GString *out, gunichar cp)
{
    gchar utf8[8];
    gint len = g_unichar_to_utf8(cp, utf8);
    g_string_append_len(out, utf8, len);
}

/* Decodes a JSON string LITERAL — @json points at the opening quote. Returns
 * NULL if it is not one, which is how the caller distinguishes a string result
 * from every other JSON value without parsing those too. */
static gchar *gjsify_webview2_decode_json_string(const gchar *json)
{
    if (json == NULL || json[0] != '"') {
        return NULL;
    }

    GString *out = g_string_new(NULL);
    const gchar *p = json + 1;

    while (*p != '\0' && *p != '"') {
        if (*p != '\\') {
            g_string_append_c(out, *p++);
            continue;
        }
        p++;
        switch (*p) {
            case '"': g_string_append_c(out, '"'); p++; break;
            case '\\': g_string_append_c(out, '\\'); p++; break;
            case '/': g_string_append_c(out, '/'); p++; break;
            case 'b': g_string_append_c(out, '\b'); p++; break;
            case 'f': g_string_append_c(out, '\f'); p++; break;
            case 'n': g_string_append_c(out, '\n'); p++; break;
            case 'r': g_string_append_c(out, '\r'); p++; break;
            case 't': g_string_append_c(out, '\t'); p++; break;
            case 'u': {
                if (strlen(p + 1) < 4) {
                    g_string_free(out, TRUE);
                    return NULL;
                }
                gchar hex[5] = { p[1], p[2], p[3], p[4], '\0' };
                gunichar cp = (gunichar) g_ascii_strtoull(hex, NULL, 16);
                p += 5;
                /* A surrogate PAIR is one code point in two escapes, and JSON is
                 * the only place this backend ever sees UTF-16: emitting the
                 * halves separately produces two invalid characters, which is
                 * the shape a "the emoji came back broken" bug takes. */
                if (cp >= 0xD800 && cp <= 0xDBFF && p[0] == '\\' && p[1] == 'u' &&
                    strlen(p + 2) >= 4) {
                    gchar low_hex[5] = { p[2], p[3], p[4], p[5], '\0' };
                    gunichar low = (gunichar) g_ascii_strtoull(low_hex, NULL, 16);
                    if (low >= 0xDC00 && low <= 0xDFFF) {
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                        p += 6;
                    }
                }
                gjsify_webview2_append_codepoint(out, cp);
                break;
            }
            default:
                g_string_free(out, TRUE);
                return NULL;
        }
    }

    return g_string_free(out, FALSE);
}

GjsifyWebView2Value *gjsify_webview2_value_new_from_json(const gchar *json)
{
    GjsifyWebView2Value *self = g_object_new(GJSIFY_WEBVIEW2_TYPE_VALUE, NULL);

    /* WebView2 returns the string "null" for a script whose result is `null`
     * AND for one whose result is `undefined`; the two are not distinguishable
     * in JSON. So `is_null` is true for both and `is_undefined` is never true —
     * stated here rather than guessed at a call site. */
    if (json == NULL || json[0] == '\0' || g_strcmp0(json, "null") == 0) {
        self->is_null = TRUE;
        self->string = g_strdup("null");
        return self;
    }

    gchar *decoded = gjsify_webview2_decode_json_string(json);
    if (decoded != NULL) {
        self->is_string = TRUE;
        self->string = decoded;
    } else {
        self->string = g_strdup(json);
    }
    return self;
}

gchar *gjsify_webview2_value_to_string(GjsifyWebView2Value *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_VALUE(self), NULL);
    return g_strdup(self->string != NULL ? self->string : "");
}

gboolean gjsify_webview2_value_is_string(GjsifyWebView2Value *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_VALUE(self), FALSE);
    return self->is_string;
}

gboolean gjsify_webview2_value_is_null(GjsifyWebView2Value *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_VALUE(self), FALSE);
    return self->is_null;
}

gboolean gjsify_webview2_value_is_undefined(GjsifyWebView2Value *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_VALUE(self), FALSE);
    return self->is_undefined;
}

/* ==========================================================================
 * GjsifyWebView2UserScript
 * ========================================================================== */

struct _GjsifyWebView2UserScript {
    gatomicrefcount ref_count;
    gchar *source;
    GjsifyWebView2UserContentInjectedFrames injected_frames;
    GjsifyWebView2UserScriptInjectionTime injection_time;
    /* Kept so the manager can refuse the script and say which list it was. Not
     * applied — see gjsify_webview2_user_script_new(). */
    gboolean filtered;
};

G_DEFINE_BOXED_TYPE(GjsifyWebView2UserScript,
                    gjsify_webview2_user_script,
                    gjsify_webview2_user_script_ref,
                    gjsify_webview2_user_script_unref)

GjsifyWebView2UserScript *gjsify_webview2_user_script_ref(GjsifyWebView2UserScript *self)
{
    g_return_val_if_fail(self != NULL, NULL);
    g_atomic_ref_count_inc(&self->ref_count);
    return self;
}

void gjsify_webview2_user_script_unref(GjsifyWebView2UserScript *self)
{
    g_return_if_fail(self != NULL);
    if (g_atomic_ref_count_dec(&self->ref_count)) {
        g_free(self->source);
        g_free(self);
    }
}

static gboolean gjsify_webview2_list_is_empty(const gchar *const *list)
{
    return list == NULL || list[0] == NULL;
}

GjsifyWebView2UserScript *gjsify_webview2_user_script_new(
    const gchar *source,
    GjsifyWebView2UserContentInjectedFrames injected_frames,
    GjsifyWebView2UserScriptInjectionTime injection_time,
    const gchar *const *allow_list,
    const gchar *const *block_list)
{
    GjsifyWebView2UserScript *self = g_new0(GjsifyWebView2UserScript, 1);
    g_atomic_ref_count_init(&self->ref_count);
    self->source = g_strdup(source != NULL ? source : "");
    self->injected_frames = injected_frames;
    self->injection_time = injection_time;
    self->filtered = !gjsify_webview2_list_is_empty(allow_list) ||
                     !gjsify_webview2_list_is_empty(block_list);
    return self;
}

/* A divergence warning that fires at most once per TEXT, process-wide. The
 * once-per-text rule is what lets these sit on a hot path — get_snapshot() is
 * called per frame by a consumer that polls — without turning the log into the
 * thing nobody reads. */
static void gjsify_webview2_warn_once(gboolean condition, const gchar *message)
{
    static GHashTable *warned = NULL; /* message -> itself */

    if (!condition) {
        return;
    }
    if (warned == NULL) {
        warned = g_hash_table_new(g_str_hash, g_str_equal);
    }
    if (g_hash_table_contains(warned, message)) {
        return;
    }
    /* The literals passed here are static storage, so the key needs no copy. */
    g_hash_table_add(warned, (gpointer) message);

    g_warning("WebKit(WebView2): %s", message);
}

/* ONE text and ONE place for the isolation-world argument WebView2 has no
 * equivalent for. It is reached from FOUR entry points — UserScript,
 * evaluate_javascript, and register/unregister_script_message_handler — and
 * three of them used to drop it with a bare `(void) world_name;` on the reasoning
 * that the fourth had already warned. That reasoning was wrong: a caller can
 * reach any of the other three without ever constructing a UserScript, so
 * nothing warned at all. The divergence is worth a name because darwin HONOURS
 * this argument (WKContentWorld, ADR 0022), so the same call is isolated there
 * and not here.
 *
 * Once per WORLD NAME rather than once per process: a bridge re-injects its
 * bootstrap on every navigation and a per-call warning would bury the log it
 * belongs in, while a per-process flag would let whichever entry point ran first
 * silence the other three. */
static void gjsify_webview2_warn_ignored_world(const gchar *world_name, const gchar *where)
{
    static GHashTable *warned = NULL; /* world name -> itself */

    if (world_name == NULL || world_name[0] == '\0') {
        return;
    }
    if (warned == NULL) {
        warned = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
    }
    if (g_hash_table_contains(warned, world_name)) {
        return;
    }
    g_hash_table_add(warned, g_strdup(world_name));

    g_warning("WebKit(WebView2): script world '%s' is IGNORED by %s — WebView2 has no public "
              "isolated-world API, so this runs in the page's own world and a page script can "
              "see and replace anything it defines. The darwin backend honours the same "
              "argument (WKContentWorld), so this is a backend divergence and not a no-op.",
              world_name,
              where);
}

GjsifyWebView2UserScript *gjsify_webview2_user_script_new_for_world(
    const gchar *source,
    GjsifyWebView2UserContentInjectedFrames injected_frames,
    GjsifyWebView2UserScriptInjectionTime injection_time,
    const gchar *world_name,
    const gchar *const *allow_list,
    const gchar *const *block_list)
{
    gjsify_webview2_warn_ignored_world(world_name, "UserScript");
    return gjsify_webview2_user_script_new(
        source, injected_frames, injection_time, allow_list, block_list);
}

/* ==========================================================================
 * GjsifyWebView2UserContentManager
 *
 * WebKitGTK's manager owns the scripts and the message handlers, and a view is
 * constructed WITH one. WebView2 has no such object: scripts and handlers are
 * per-`ICoreWebView2`. So the manager is the record, and every view attached to
 * it replays that record into its own engine and receives later changes.
 * ========================================================================== */

struct _GjsifyWebView2UserContentManager {
    GObject parent_instance;
    GPtrArray *scripts;  /* owned GjsifyWebView2UserScript* */
    GPtrArray *handlers; /* owned gchar* */
    GPtrArray *views;    /* UNOWNED GjsifyWebView2WebView* — a view outlives nothing here */
};

enum { UCM_SIGNAL_SCRIPT_MESSAGE_RECEIVED, UCM_N_SIGNALS };
static guint ucm_signals[UCM_N_SIGNALS] = { 0 };

G_DEFINE_FINAL_TYPE(
    GjsifyWebView2UserContentManager, gjsify_webview2_user_content_manager, G_TYPE_OBJECT)

/* Declared here because the manager pushes into views and the view pulls from
 * the manager; both types live in this file precisely so that edge is a static
 * function rather than another entry in the public header. */
static GjsifyWebView2Backend *gjsify_webview2_web_view_backend(GjsifyWebView2WebView *self);

static void gjsify_webview2_user_content_manager_dispose(GObject *object)
{
    GjsifyWebView2UserContentManager *self = GJSIFY_WEBVIEW2_USER_CONTENT_MANAGER(object);
    g_clear_pointer(&self->scripts, g_ptr_array_unref);
    g_clear_pointer(&self->handlers, g_ptr_array_unref);
    g_clear_pointer(&self->views, g_ptr_array_unref);
    G_OBJECT_CLASS(gjsify_webview2_user_content_manager_parent_class)->dispose(object);
}

static void gjsify_webview2_user_content_manager_class_init(
    GjsifyWebView2UserContentManagerClass *klass)
{
    G_OBJECT_CLASS(klass)->dispose = gjsify_webview2_user_content_manager_dispose;

    /**
     * GjsifyWebView2UserContentManager::script-message-received:
     * @self: the manager.
     * @value: the message body.
     *
     * Mirrors WebKitUserContentManager::script-message-received, detail-quantified
     * the same way so a consumer connecting to `script-message-received::<name>`
     * receives only its own channel.
     */
    ucm_signals[UCM_SIGNAL_SCRIPT_MESSAGE_RECEIVED] =
        g_signal_new("script-message-received",
                     GJSIFY_WEBVIEW2_TYPE_USER_CONTENT_MANAGER,
                     G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                     0,
                     NULL,
                     NULL,
                     NULL,
                     G_TYPE_NONE,
                     1,
                     GJSIFY_WEBVIEW2_TYPE_VALUE);
}

static void gjsify_webview2_user_content_manager_init(GjsifyWebView2UserContentManager *self)
{
    self->scripts =
        g_ptr_array_new_with_free_func((GDestroyNotify) gjsify_webview2_user_script_unref);
    self->handlers = g_ptr_array_new_with_free_func(g_free);
    self->views = g_ptr_array_new();
}

GjsifyWebView2UserContentManager *gjsify_webview2_user_content_manager_new(void)
{
    return g_object_new(GJSIFY_WEBVIEW2_TYPE_USER_CONTENT_MANAGER, NULL);
}

static void gjsify_webview2_user_content_manager_push_script(
    GjsifyWebView2UserContentManager *self, GjsifyWebView2UserScript *script)
{
    for (guint i = 0; i < self->views->len; i++) {
        GjsifyWebView2Backend *backend =
            gjsify_webview2_web_view_backend(g_ptr_array_index(self->views, i));
        if (backend != NULL) {
            gjsify_webview2_backend_add_script(
                backend,
                script->source,
                script->injected_frames == GJSIFY_WEBVIEW2_USER_CONTENT_INJECT_TOP_FRAME,
                script->injection_time ==
                    GJSIFY_WEBVIEW2_USER_SCRIPT_INJECT_AT_DOCUMENT_START);
        }
    }
}

void gjsify_webview2_user_content_manager_add_script(
    GjsifyWebView2UserContentManager *self, GjsifyWebView2UserScript *script)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_USER_CONTENT_MANAGER(self));
    g_return_if_fail(script != NULL);

    /* REFUSED, not warned-and-run. WebView2's AddScriptToExecuteOnDocumentCreated
     * carries no URL filter, and ADR 0022 records what warning-and-running costs:
     * a script executing on an origin the caller excluded is the exact failure a
     * block list exists to prevent. Refusing narrows in the safe direction for
     * both list kinds. ADR 0035 stage 1's counted subset does not include the
     * filter, and porting darwin's in-script guard is what closes this — see
     * the README's "What stage 1 does not do". */
    if (script->filtered) {
        g_warning("WebKit(WebView2): user script NOT injected — it carries an allow or block "
                  "list, and this backend has no URL filter to honour it with. Injecting it "
                  "anyway would run it on origins the caller excluded.");
        return;
    }

    g_ptr_array_add(self->scripts, gjsify_webview2_user_script_ref(script));
    gjsify_webview2_user_content_manager_push_script(self, script);
}

void gjsify_webview2_user_content_manager_remove_all_scripts(
    GjsifyWebView2UserContentManager *self)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_USER_CONTENT_MANAGER(self));

    g_ptr_array_set_size(self->scripts, 0);
    for (guint i = 0; i < self->views->len; i++) {
        GjsifyWebView2Backend *backend =
            gjsify_webview2_web_view_backend(g_ptr_array_index(self->views, i));
        if (backend != NULL) {
            gjsify_webview2_backend_remove_all_scripts(backend);
        }
    }
}

gboolean gjsify_webview2_user_content_manager_register_script_message_handler(
    GjsifyWebView2UserContentManager *self, const gchar *name, const gchar *world_name)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_USER_CONTENT_MANAGER(self), FALSE);
    g_return_val_if_fail(name != NULL, FALSE);
    gjsify_webview2_warn_ignored_world(world_name, "register_script_message_handler");

    for (guint i = 0; i < self->handlers->len; i++) {
        if (g_strcmp0(g_ptr_array_index(self->handlers, i), name) == 0) {
            return TRUE;
        }
    }

    g_ptr_array_add(self->handlers, g_strdup(name));
    for (guint i = 0; i < self->views->len; i++) {
        GjsifyWebView2Backend *backend =
            gjsify_webview2_web_view_backend(g_ptr_array_index(self->views, i));
        if (backend != NULL) {
            gjsify_webview2_backend_register_message_handler(backend, name);
        }
    }
    return TRUE;
}

void gjsify_webview2_user_content_manager_unregister_script_message_handler(
    GjsifyWebView2UserContentManager *self, const gchar *name, const gchar *world_name)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_USER_CONTENT_MANAGER(self));
    g_return_if_fail(name != NULL);
    gjsify_webview2_warn_ignored_world(world_name, "unregister_script_message_handler");

    for (guint i = 0; i < self->handlers->len; i++) {
        if (g_strcmp0(g_ptr_array_index(self->handlers, i), name) == 0) {
            g_ptr_array_remove_index(self->handlers, i);
            break;
        }
    }
    for (guint i = 0; i < self->views->len; i++) {
        GjsifyWebView2Backend *backend =
            gjsify_webview2_web_view_backend(g_ptr_array_index(self->views, i));
        if (backend != NULL) {
            gjsify_webview2_backend_unregister_message_handler(backend, name);
        }
    }
}

static void gjsify_webview2_user_content_manager_attach(
    GjsifyWebView2UserContentManager *self, GjsifyWebView2WebView *view)
{
    g_ptr_array_add(self->views, view);

    GjsifyWebView2Backend *backend = gjsify_webview2_web_view_backend(view);
    if (backend == NULL) {
        return;
    }
    for (guint i = 0; i < self->scripts->len; i++) {
        GjsifyWebView2UserScript *script = g_ptr_array_index(self->scripts, i);
        gjsify_webview2_backend_add_script(
            backend,
            script->source,
            script->injected_frames == GJSIFY_WEBVIEW2_USER_CONTENT_INJECT_TOP_FRAME,
            script->injection_time == GJSIFY_WEBVIEW2_USER_SCRIPT_INJECT_AT_DOCUMENT_START);
    }
    for (guint i = 0; i < self->handlers->len; i++) {
        gjsify_webview2_backend_register_message_handler(
            backend, g_ptr_array_index(self->handlers, i));
    }
}

static void gjsify_webview2_user_content_manager_detach(
    GjsifyWebView2UserContentManager *self, GjsifyWebView2WebView *view)
{
    if (self->views != NULL) {
        g_ptr_array_remove_fast(self->views, view);
    }
}

/* ==========================================================================
 * GjsifyWebView2Settings
 * ========================================================================== */

struct _GjsifyWebView2Settings {
    GObject parent_instance;
    gboolean enable_developer_extras;
    gboolean enable_javascript;
    gboolean enable_write_console_messages_to_stdout;
};

enum {
    SETTINGS_PROP_0,
    SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS,
    SETTINGS_PROP_ENABLE_JAVASCRIPT,
    SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT,
    SETTINGS_N_PROPS
};
static GParamSpec *settings_props[SETTINGS_N_PROPS] = { NULL };

G_DEFINE_FINAL_TYPE(GjsifyWebView2Settings, gjsify_webview2_settings, G_TYPE_OBJECT)

static void gjsify_webview2_settings_get_property(
    GObject *object, guint prop_id, GValue *value, GParamSpec *pspec)
{
    GjsifyWebView2Settings *self = GJSIFY_WEBVIEW2_SETTINGS(object);

    switch (prop_id) {
        case SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS:
            g_value_set_boolean(value, self->enable_developer_extras);
            break;
        case SETTINGS_PROP_ENABLE_JAVASCRIPT:
            g_value_set_boolean(value, self->enable_javascript);
            break;
        case SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT:
            g_value_set_boolean(value, self->enable_write_console_messages_to_stdout);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

static void gjsify_webview2_settings_set_property(
    GObject *object, guint prop_id, const GValue *value, GParamSpec *pspec)
{
    GjsifyWebView2Settings *self = GJSIFY_WEBVIEW2_SETTINGS(object);

    switch (prop_id) {
        case SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS:
            self->enable_developer_extras = g_value_get_boolean(value);
            break;
        case SETTINGS_PROP_ENABLE_JAVASCRIPT:
            self->enable_javascript = g_value_get_boolean(value);
            break;
        case SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT:
            self->enable_write_console_messages_to_stdout = g_value_get_boolean(value);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

static void gjsify_webview2_settings_class_init(GjsifyWebView2SettingsClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS(klass);

    object_class->get_property = gjsify_webview2_settings_get_property;
    object_class->set_property = gjsify_webview2_settings_set_property;

    /* Names, defaults and nullability are WebKitSettings' so a consumer's
     * property bag transfers verbatim. */
    settings_props[SETTINGS_PROP_ENABLE_DEVELOPER_EXTRAS] = g_param_spec_boolean(
        "enable-developer-extras", NULL, NULL, FALSE,
        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);
    settings_props[SETTINGS_PROP_ENABLE_JAVASCRIPT] = g_param_spec_boolean(
        "enable-javascript", NULL, NULL, TRUE, G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);
    settings_props[SETTINGS_PROP_ENABLE_WRITE_CONSOLE_MESSAGES_TO_STDOUT] = g_param_spec_boolean(
        "enable-write-console-messages-to-stdout", NULL, NULL, FALSE,
        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);

    g_object_class_install_properties(object_class, SETTINGS_N_PROPS, settings_props);
}

static void gjsify_webview2_settings_init(GjsifyWebView2Settings *self)
{
    self->enable_javascript = TRUE;
}

GjsifyWebView2Settings *gjsify_webview2_settings_new(void)
{
    return g_object_new(GJSIFY_WEBVIEW2_TYPE_SETTINGS, NULL);
}

/* ==========================================================================
 * GjsifyWebView2WebView
 * ========================================================================== */

typedef struct {
    GjsifyWebView2Backend *backend;
    GError *backend_error; /* why there is no backend, returned from every op */
    /* The pump reference is taken in init(), BEFORE the engine exists, so it is
     * released on its own flag rather than on `backend != NULL` — an engine that
     * could not be created must not leak the source it never used. */
    gboolean pump_held;

    GjsifyWebView2UserContentManager *user_content_manager;
    GjsifyWebView2Settings *settings;
    gulong settings_notify_id;

    gchar *uri;
    gboolean is_loading;

    /* The overlay-semantics report. Computed on allocation and on map, warned
     * once per distinct message, and readable from
     * gjsify_webview2_web_view_get_overlay_constraints(). */
    GPtrArray *overlay_constraints; /* owned gchar* */
    GHashTable *overlay_warned;     /* message -> itself, for the once-per-view rule */
} GjsifyWebView2WebViewPrivate;

/* One accessor rather than a cached pointer per function: the instance-private
 * offset is resolved by GType, and caching it is how a derived instance ends up
 * reading the base's data. */
#define PRIV(self) \
    ((GjsifyWebView2WebViewPrivate *) gjsify_webview2_web_view_get_instance_private(self))

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

G_DEFINE_TYPE_WITH_PRIVATE(GjsifyWebView2WebView, gjsify_webview2_web_view, GTK_TYPE_WIDGET)

static GjsifyWebView2Backend *gjsify_webview2_web_view_backend(GjsifyWebView2WebView *self)
{
    return PRIV(self)->backend;
}

/* -------------------------------------------------------------------------
 * The way back from the engine.
 * ------------------------------------------------------------------------- */

void gjsify_webview2_web_view_emit_load_changed(
    GjsifyWebView2WebView *self, GjsifyWebView2LoadEvent event)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));

    gboolean loading = event != GJSIFY_WEBVIEW2_LOAD_FINISHED;
    if (PRIV(self)->is_loading != loading) {
        PRIV(self)->is_loading = loading;
        g_object_notify_by_pspec(G_OBJECT(self), web_view_props[WEB_VIEW_PROP_IS_LOADING]);
    }
    g_signal_emit(self, web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED], 0, event);
}

void gjsify_webview2_web_view_emit_load_failed(
    GjsifyWebView2WebView *self,
    GjsifyWebView2LoadEvent event,
    const gchar *failing_uri,
    const gchar *message)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));

    GError *error = g_error_new_literal(
        G_IO_ERROR, G_IO_ERROR_FAILED, message != NULL ? message : "navigation failed");
    gboolean handled = FALSE;

    if (PRIV(self)->is_loading) {
        PRIV(self)->is_loading = FALSE;
        g_object_notify_by_pspec(G_OBJECT(self), web_view_props[WEB_VIEW_PROP_IS_LOADING]);
    }
    g_signal_emit(self,
                  web_view_signals[WEB_VIEW_SIGNAL_LOAD_FAILED],
                  0,
                  event,
                  failing_uri != NULL ? failing_uri : "",
                  error,
                  &handled);
    g_error_free(error);
}

void gjsify_webview2_web_view_set_current_uri(GjsifyWebView2WebView *self, const gchar *uri)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));

    if (g_strcmp0(PRIV(self)->uri, uri) == 0) {
        return;
    }
    g_free(PRIV(self)->uri);
    PRIV(self)->uri = g_strdup(uri);
    g_object_notify_by_pspec(G_OBJECT(self), web_view_props[WEB_VIEW_PROP_URI]);
}

void gjsify_webview2_web_view_emit_script_message(
    GjsifyWebView2WebView *self, const gchar *handler_name, const gchar *json_body)
{
    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));
    g_return_if_fail(handler_name != NULL);

    GjsifyWebView2UserContentManager *manager = PRIV(self)->user_content_manager;
    if (manager == NULL) {
        return;
    }

    GjsifyWebView2Value *value = gjsify_webview2_value_new_from_json(json_body);
    g_signal_emit(manager,
                  ucm_signals[UCM_SIGNAL_SCRIPT_MESSAGE_RECEIVED],
                  g_quark_from_string(handler_name),
                  value);
    g_object_unref(value);
}

/* -------------------------------------------------------------------------
 * Stage-1 honesty: what an OS-composited overlay cannot do here.
 * ------------------------------------------------------------------------- */

static void gjsify_webview2_web_view_note_constraint(
    GjsifyWebView2WebView *self, gchar *message /* transfer full */)
{
    GjsifyWebView2WebViewPrivate *priv = PRIV(self);

    if (g_hash_table_contains(priv->overlay_warned, message)) {
        g_free(message);
        return;
    }
    g_warning("WebKit(WebView2): %s This view is an OS-composited overlay "
              "(WebKit.HostingMode.OVERLAY), not a node in GTK's scene graph. "
              "WebKit.WebView.get_overlay_constraints() lists every such finding.",
              message);
    g_hash_table_add(priv->overlay_warned, g_strdup(message));
    g_ptr_array_add(priv->overlay_constraints, message);
}

/* Runs on allocation and on map. Detection is deliberately by WIDGET TYPE and by
 * two GTK properties rather than by reading the CSS cascade: a `border-radius`
 * that reaches this widget is not readable from the public API at all, and a
 * detector that silently found nothing would be worse than one whose limits are
 * written down. What it DOES catch is every arrangement that has actually been
 * reported against an overlay-hosted web view. */
static void gjsify_webview2_web_view_check_overlay_constraints(GjsifyWebView2WebView *self)
{
    GtkWidget *widget = GTK_WIDGET(self);

    if (gtk_widget_get_opacity(widget) < 1.0) {
        gjsify_webview2_web_view_note_constraint(
            self, g_strdup("the view's own opacity is below 1 and is not applied to the web "
                           "content."));
    }

    for (GtkWidget *parent = gtk_widget_get_parent(widget); parent != NULL;
         parent = gtk_widget_get_parent(parent)) {
        const gchar *type = G_OBJECT_TYPE_NAME(parent);

        if (GTK_IS_SCROLLED_WINDOW(parent) || GTK_IS_VIEWPORT(parent)) {
            gjsify_webview2_web_view_note_constraint(
                self,
                g_strdup_printf("an ancestor %s clips and scrolls its child, and the web "
                                "content is neither clipped nor scrolled with it.",
                                type));
        } else if (GTK_IS_OVERLAY(parent) &&
                   (gtk_overlay_get_child(GTK_OVERLAY(parent)) == widget ||
                    (gtk_overlay_get_child(GTK_OVERLAY(parent)) != NULL &&
                     gtk_widget_is_ancestor(
                         widget, gtk_overlay_get_child(GTK_OVERLAY(parent)))))) {
            gjsify_webview2_web_view_note_constraint(
                self,
                g_strdup("this view is the main child of a GtkOverlay, so anything overlaid on "
                         "it will be drawn UNDER the web content instead of over it."));
        } else if (GTK_IS_POPOVER(parent)) {
            gjsify_webview2_web_view_note_constraint(
                self,
                g_strdup("an ancestor GtkPopover has its own surface with a rounded, clipped "
                         "shape the web content does not follow."));
        }

        if (gtk_widget_get_opacity(parent) < 1.0) {
            gjsify_webview2_web_view_note_constraint(
                self,
                g_strdup_printf("an ancestor %s has an opacity below 1, which is not applied to "
                                "the web content.",
                                type));
        }
    }
}

GjsifyWebView2HostingMode gjsify_webview2_web_view_get_hosting_mode(GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), GJSIFY_WEBVIEW2_HOSTING_MODE_OVERLAY);
    return GJSIFY_WEBVIEW2_HOSTING_MODE_OVERLAY;
}

gchar **gjsify_webview2_web_view_get_overlay_constraints(GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), NULL);

    GPtrArray *out = g_ptr_array_new();
    for (guint i = 0; i < PRIV(self)->overlay_constraints->len; i++) {
        g_ptr_array_add(out, g_strdup(g_ptr_array_index(PRIV(self)->overlay_constraints, i)));
    }
    g_ptr_array_add(out, NULL);
    return (gchar **) g_ptr_array_free(out, FALSE);
}

GjsifyWebView2MessagePumpState gjsify_webview2_web_view_get_message_pump_state(
    GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(
        GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), GJSIFY_WEBVIEW2_MESSAGE_PUMP_DETACHED);
    return gjsify_webview2_pump_state();
}

/* -------------------------------------------------------------------------
 * The one gate every content-level operation goes through.
 *
 * ADR 0035 § What the spike answered: the environment and the controller
 * complete their callbacks with NO pump at all, and only content-level work
 * needs the queue. So a view can be constructed, hosted and sized in a process
 * that never pumps, and the gap shows up as "the widget exists, the view exists,
 * and nothing loads" — a symptom eight seconds and one abstraction layer from
 * its cause. Every operation that would produce that symptom asks first.
 * ------------------------------------------------------------------------- */

static gboolean gjsify_webview2_web_view_ready(GjsifyWebView2WebView *self, GError **error)
{
    if (PRIV(self)->backend == NULL) {
        g_set_error_literal(error,
                            G_IO_ERROR,
                            G_IO_ERROR_NOT_SUPPORTED,
                            PRIV(self)->backend_error != NULL
                                ? PRIV(self)->backend_error->message
                                : "this WebKit.WebView has no engine behind it");
        return FALSE;
    }
    return gjsify_webview2_pump_require(error);
}

/* -------------------------------------------------------------------------
 * GtkWidget
 * ------------------------------------------------------------------------- */

/* Translates the widget's allocation into the coordinates the child `HWND`
 * lives in: pixels, relative to the toplevel's client area. GTK works in
 * logical units and Win32 in physical ones, so the scale factor is a multiply
 * and not a rounding detail — on a 200 % display an unscaled bound puts the web
 * content in the top-left quarter of its widget. */
static void gjsify_webview2_web_view_sync_bounds(GjsifyWebView2WebView *self)
{
    GtkWidget *widget = GTK_WIDGET(self);
    GjsifyWebView2Backend *backend = PRIV(self)->backend;

    if (backend == NULL) {
        return;
    }

    GtkNative *native = gtk_widget_get_native(widget);
    if (native == NULL) {
        gjsify_webview2_backend_set_parent(backend, NULL);
        return;
    }

    GdkSurface *surface = gtk_native_get_surface(native);
    graphene_rect_t bounds;
    if (surface == NULL ||
        !gtk_widget_compute_bounds(widget, GTK_WIDGET(native), &bounds)) {
        gjsify_webview2_backend_set_parent(backend, NULL);
        return;
    }

    double transform_x = 0;
    double transform_y = 0;
    gtk_native_get_surface_transform(native, &transform_x, &transform_y);

    int scale = gdk_surface_get_scale_factor(surface);
    if (scale < 1) {
        scale = 1;
    }

    gjsify_webview2_backend_set_parent(backend, surface);
    gjsify_webview2_backend_set_bounds(
        backend,
        (int) ((bounds.origin.x + transform_x) * scale),
        (int) ((bounds.origin.y + transform_y) * scale),
        (int) (bounds.size.width * scale),
        (int) (bounds.size.height * scale));
}

static void gjsify_webview2_web_view_map(GtkWidget *widget)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(widget);

    GTK_WIDGET_CLASS(gjsify_webview2_web_view_parent_class)->map(widget);

    gjsify_webview2_web_view_check_overlay_constraints(self);
    gjsify_webview2_web_view_sync_bounds(self);
    if (PRIV(self)->backend != NULL) {
        gjsify_webview2_backend_set_visible(PRIV(self)->backend, TRUE);
    }
}

static void gjsify_webview2_web_view_unmap(GtkWidget *widget)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(widget);

    /* Hidden BY HAND, because nothing else will do it: a child HWND the OS
     * composites is not affected by its notional widget being unmapped,
     * scrolled out of view or covered. This is the whole of what "not in the
     * scene graph" costs at the lifecycle level. */
    if (PRIV(self)->backend != NULL) {
        gjsify_webview2_backend_set_visible(PRIV(self)->backend, FALSE);
        gjsify_webview2_backend_set_parent(PRIV(self)->backend, NULL);
    }

    GTK_WIDGET_CLASS(gjsify_webview2_web_view_parent_class)->unmap(widget);
}

static void gjsify_webview2_web_view_size_allocate(
    GtkWidget *widget, int width, int height, int baseline)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(widget);

    GTK_WIDGET_CLASS(gjsify_webview2_web_view_parent_class)
        ->size_allocate(widget, width, height, baseline);

    gjsify_webview2_web_view_check_overlay_constraints(self);
    if (gtk_widget_get_mapped(widget)) {
        gjsify_webview2_web_view_sync_bounds(self);
    }
}

static void gjsify_webview2_web_view_measure(GtkWidget *widget,
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

static void gjsify_webview2_web_view_get_property(
    GObject *object, guint prop_id, GValue *value, GParamSpec *pspec)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(object);

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

static void gjsify_webview2_web_view_set_property(
    GObject *object, guint prop_id, const GValue *value, GParamSpec *pspec)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(object);

    switch (prop_id) {
        case WEB_VIEW_PROP_USER_CONTENT_MANAGER:
            g_set_object(&PRIV(self)->user_content_manager, g_value_get_object(value));
            break;
        case WEB_VIEW_PROP_SETTINGS:
            g_set_object(&PRIV(self)->settings, g_value_get_object(value));
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
    }
}

static void gjsify_webview2_web_view_apply_settings(GjsifyWebView2WebView *self)
{
    if (PRIV(self)->backend == NULL || PRIV(self)->settings == NULL) {
        return;
    }
    gjsify_webview2_backend_apply_settings(
        PRIV(self)->backend,
        PRIV(self)->settings->enable_javascript,
        PRIV(self)->settings->enable_developer_extras,
        PRIV(self)->settings->enable_write_console_messages_to_stdout);
}

static void gjsify_webview2_web_view_on_settings_notify(
    GObject *settings, GParamSpec *pspec, gpointer user_data)
{
    (void) settings;
    (void) pspec;
    gjsify_webview2_web_view_apply_settings(GJSIFY_WEBVIEW2_WEB_VIEW(user_data));
}

/* The engine cannot be built in init(): it needs the user-content-manager and
 * settings construct properties, which GObject only delivers afterwards.
 * constructed() is the first point where all three are known. */
static void gjsify_webview2_web_view_constructed(GObject *object)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(object);

    G_OBJECT_CLASS(gjsify_webview2_web_view_parent_class)->constructed(object);

    if (PRIV(self)->user_content_manager == NULL) {
        PRIV(self)->user_content_manager = gjsify_webview2_user_content_manager_new();
    }
    if (PRIV(self)->settings == NULL) {
        PRIV(self)->settings = gjsify_webview2_settings_new();
    }

    /* A GObject constructor cannot fail, so an unreachable engine is RECORDED
     * and returned from every operation instead. ADR 0035 decision 5 names the
     * failure this avoids: a namespace that resolves, advertises its classes and
     * dies in the constructor. */
    PRIV(self)->backend = gjsify_webview2_backend_new(self, &PRIV(self)->backend_error);
    if (PRIV(self)->backend == NULL && PRIV(self)->backend_error != NULL) {
        g_warning("WebKit(WebView2): %s", PRIV(self)->backend_error->message);
    }

    gjsify_webview2_web_view_apply_settings(self);
    PRIV(self)->settings_notify_id =
        g_signal_connect(PRIV(self)->settings,
                         "notify",
                         G_CALLBACK(gjsify_webview2_web_view_on_settings_notify),
                         self);

    gjsify_webview2_user_content_manager_attach(PRIV(self)->user_content_manager, self);
}

static void gjsify_webview2_web_view_dispose(GObject *object)
{
    GjsifyWebView2WebView *self = GJSIFY_WEBVIEW2_WEB_VIEW(object);
    GjsifyWebView2WebViewPrivate *priv = PRIV(self);

    if (priv->user_content_manager != NULL) {
        gjsify_webview2_user_content_manager_detach(priv->user_content_manager, self);
    }
    if (priv->settings != NULL && priv->settings_notify_id != 0) {
        g_signal_handler_disconnect(priv->settings, priv->settings_notify_id);
        priv->settings_notify_id = 0;
    }

    /* Before the GObjects it may call back into, and before the pump reference
     * it was covered by. */
    if (priv->backend != NULL) {
        gjsify_webview2_backend_free(priv->backend);
        priv->backend = NULL;
    }
    if (priv->pump_held) {
        priv->pump_held = FALSE;
        gjsify_webview2_pump_unref();
    }

    g_clear_error(&priv->backend_error);
    g_clear_object(&priv->user_content_manager);
    g_clear_object(&priv->settings);
    g_clear_pointer(&priv->uri, g_free);
    g_clear_pointer(&priv->overlay_constraints, g_ptr_array_unref);
    g_clear_pointer(&priv->overlay_warned, g_hash_table_unref);

    G_OBJECT_CLASS(gjsify_webview2_web_view_parent_class)->dispose(object);
}

static void gjsify_webview2_web_view_class_init(GjsifyWebView2WebViewClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS(klass);
    GtkWidgetClass *widget_class = GTK_WIDGET_CLASS(klass);

    object_class->constructed = gjsify_webview2_web_view_constructed;
    object_class->dispose = gjsify_webview2_web_view_dispose;
    object_class->get_property = gjsify_webview2_web_view_get_property;
    object_class->set_property = gjsify_webview2_web_view_set_property;

    widget_class->map = gjsify_webview2_web_view_map;
    widget_class->unmap = gjsify_webview2_web_view_unmap;
    widget_class->measure = gjsify_webview2_web_view_measure;
    widget_class->size_allocate = gjsify_webview2_web_view_size_allocate;
    /* No `snapshot` override on purpose: there is nothing for GSK to draw. The
     * pixels arrive on the OS's compositor, above this surface. Stage 2 is
     * exactly the change that gives this class a snapshot vfunc. */

    web_view_props[WEB_VIEW_PROP_USER_CONTENT_MANAGER] = g_param_spec_object(
        "user-content-manager",
        NULL,
        NULL,
        GJSIFY_WEBVIEW2_TYPE_USER_CONTENT_MANAGER,
        G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS);
    web_view_props[WEB_VIEW_PROP_SETTINGS] =
        g_param_spec_object("settings",
                            NULL,
                            NULL,
                            GJSIFY_WEBVIEW2_TYPE_SETTINGS,
                            G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS);
    web_view_props[WEB_VIEW_PROP_URI] =
        g_param_spec_string("uri", NULL, NULL, NULL, G_PARAM_READABLE | G_PARAM_STATIC_STRINGS);
    web_view_props[WEB_VIEW_PROP_IS_LOADING] = g_param_spec_boolean(
        "is-loading", NULL, NULL, FALSE, G_PARAM_READABLE | G_PARAM_STATIC_STRINGS);

    g_object_class_install_properties(object_class, WEB_VIEW_N_PROPS, web_view_props);

    /**
     * GjsifyWebView2WebView::load-changed:
     * @self: the view.
     * @load_event: the stage the load reached.
     */
    web_view_signals[WEB_VIEW_SIGNAL_LOAD_CHANGED] = g_signal_new("load-changed",
                                                                  GJSIFY_WEBVIEW2_TYPE_WEB_VIEW,
                                                                  G_SIGNAL_RUN_LAST,
                                                                  0,
                                                                  NULL,
                                                                  NULL,
                                                                  NULL,
                                                                  G_TYPE_NONE,
                                                                  1,
                                                                  G_TYPE_INT);

    /**
     * GjsifyWebView2WebView::load-failed:
     * @self: the view.
     * @load_event: the stage the load failed at.
     * @failing_uri: the URI that failed.
     * @error: the error.
     */
    web_view_signals[WEB_VIEW_SIGNAL_LOAD_FAILED] = g_signal_new("load-failed",
                                                                 GJSIFY_WEBVIEW2_TYPE_WEB_VIEW,
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

static void gjsify_webview2_web_view_init(GjsifyWebView2WebView *self)
{
    /* The pump is referenced HERE — the moment a view exists — and not at the
     * first navigation, because the operations that would install it lazily are
     * precisely the ones the spike measured as not needing it. */
    gjsify_webview2_pump_ref();
    PRIV(self)->pump_held = TRUE;

    PRIV(self)->overlay_constraints = g_ptr_array_new_with_free_func(g_free);
    PRIV(self)->overlay_warned =
        g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
}

GtkWidget *gjsify_webview2_web_view_new(void)
{
    return GTK_WIDGET(g_object_new(GJSIFY_WEBVIEW2_TYPE_WEB_VIEW, NULL));
}

void gjsify_webview2_web_view_load_uri(GjsifyWebView2WebView *self, const gchar *uri)
{
    GError *error = NULL;

    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));
    g_return_if_fail(uri != NULL);

    /* `load_uri` has no return value and no callback in WebKitGTK, so the only
     * report available is the one WebKitGTK itself would make: ::load-failed. */
    if (!gjsify_webview2_web_view_ready(self, &error)) {
        gjsify_webview2_web_view_emit_load_failed(
            self, GJSIFY_WEBVIEW2_LOAD_STARTED, uri, error->message);
        g_error_free(error);
        return;
    }

    gjsify_webview2_web_view_set_current_uri(self, uri);
    gjsify_webview2_backend_load_uri(PRIV(self)->backend, uri);
}

void gjsify_webview2_web_view_load_html(
    GjsifyWebView2WebView *self, const gchar *content, const gchar *base_uri)
{
    GError *error = NULL;

    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));
    g_return_if_fail(content != NULL);

    if (!gjsify_webview2_web_view_ready(self, &error)) {
        gjsify_webview2_web_view_emit_load_failed(
            self, GJSIFY_WEBVIEW2_LOAD_STARTED, base_uri, error->message);
        g_error_free(error);
        return;
    }

    gjsify_webview2_backend_load_html(PRIV(self)->backend, content, base_uri);
}

void gjsify_webview2_web_view_reload(GjsifyWebView2WebView *self)
{
    GError *error = NULL;

    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));

    if (!gjsify_webview2_web_view_ready(self, &error)) {
        gjsify_webview2_web_view_emit_load_failed(
            self, GJSIFY_WEBVIEW2_LOAD_STARTED, PRIV(self)->uri, error->message);
        g_error_free(error);
        return;
    }

    gjsify_webview2_backend_reload(PRIV(self)->backend);
}

const gchar *gjsify_webview2_web_view_get_uri(GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), NULL);
    return PRIV(self)->uri;
}

gboolean gjsify_webview2_web_view_is_loading(GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), FALSE);
    return PRIV(self)->is_loading;
}

GjsifyWebView2UserContentManager *gjsify_webview2_web_view_get_user_content_manager(
    GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), NULL);
    return PRIV(self)->user_content_manager;
}

GjsifyWebView2Settings *gjsify_webview2_web_view_get_settings(GjsifyWebView2WebView *self)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), NULL);
    return PRIV(self)->settings;
}

void gjsify_webview2_web_view_evaluate_javascript(
    GjsifyWebView2WebView *self,
    const gchar *script,
    gssize length,
    const gchar *world_name,
    const gchar *source_uri,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data)
{
    GTask *task;
    GError *error = NULL;
    gchar *source;

    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));
    g_return_if_fail(script != NULL);
    gjsify_webview2_warn_ignored_world(world_name, "evaluate_javascript");
    /* @source_uri is dropped WITHOUT a warning, and that asymmetry is deliberate:
     * WebView2's ExecuteScript has no source-URI parameter, and the argument
     * changes nothing a caller can observe except the text attributed to a script
     * in an error. A warning for a cosmetic loss would train readers to ignore
     * the ones above, which are behavioural. Documented in the header instead. */
    (void) source_uri;

    task = g_task_new(self, cancellable, callback, user_data);
    g_task_set_source_tag(task, gjsify_webview2_web_view_evaluate_javascript);

    if (!gjsify_webview2_web_view_ready(self, &error)) {
        g_task_return_error(task, error);
        g_object_unref(task);
        return;
    }

    source = length < 0 ? g_strdup(script) : g_strndup(script, (gsize) length);
    gjsify_webview2_backend_evaluate(PRIV(self)->backend, source, task);
    g_free(source);
}

GjsifyWebView2Value *gjsify_webview2_web_view_evaluate_javascript_finish(
    GjsifyWebView2WebView *self, GAsyncResult *result, GError **error)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), NULL);
    g_return_val_if_fail(g_task_is_valid(result, self), NULL);

    return g_task_propagate_pointer(G_TASK(result), error);
}

void gjsify_webview2_web_view_get_snapshot(
    GjsifyWebView2WebView *self,
    GjsifyWebView2SnapshotRegion region,
    GjsifyWebView2SnapshotOptions options,
    GCancellable *cancellable,
    GAsyncReadyCallback callback,
    gpointer user_data)
{
    GTask *task;
    GError *error = NULL;

    g_return_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self));

    /* BOTH argument divergences are reported HERE, in the portable layer, and not
     * in the engine: they are properties of the API contract rather than of
     * WebView2, so they must be reported even when the call goes on to fail for
     * want of an engine or a pump — a caller whose snapshot never arrives should
     * still learn that the arguments would not have been honoured either. */
    gjsify_webview2_warn_once(
        region == GJSIFY_WEBVIEW2_SNAPSHOT_REGION_FULL_DOCUMENT,
        "SnapshotRegion.FULL_DOCUMENT is not available — WebView2's CapturePreview captures "
        "the laid-out viewport only, so this returns the visible region.");
    /* `options` was dropped by a bare `(void) options;` in the engine, with no
     * warning and no entry in the ADR's list of what stage 1 does not do — the
     * one silent drop among the documented divergences. TRANSPARENT_BACKGROUND
     * and INCLUDE_SELECTION_HIGHLIGHTING have no CapturePreview equivalent.
     * @gjsify/iframe only ever passes NONE, which is exactly why this stayed
     * invisible. */
    gjsify_webview2_warn_once(
        options != GJSIFY_WEBVIEW2_SNAPSHOT_OPTIONS_NONE,
        "SnapshotOptions other than NONE are IGNORED — WebView2's CapturePreview has no "
        "transparent-background and no selection-highlighting option, so the capture is of "
        "the page as it is composited.");

    task = g_task_new(self, cancellable, callback, user_data);
    g_task_set_source_tag(task, gjsify_webview2_web_view_get_snapshot);

    if (!gjsify_webview2_web_view_ready(self, &error)) {
        g_task_return_error(task, error);
        g_object_unref(task);
        return;
    }

    gjsify_webview2_backend_snapshot(PRIV(self)->backend, region, options, task);
}

GdkTexture *gjsify_webview2_web_view_get_snapshot_finish(
    GjsifyWebView2WebView *self, GAsyncResult *result, GError **error)
{
    g_return_val_if_fail(GJSIFY_WEBVIEW2_IS_WEB_VIEW(self), NULL);
    g_return_val_if_fail(g_task_is_valid(result, self), NULL);

    return g_task_propagate_pointer(G_TASK(result), error);
}
