// SPDX-License-Identifier: MIT
//
// Does the SHIPPING widget forward input? Companion to
// docs/adr/0022-webkit-on-darwin.md and to docs/poc/webkit-input-darwin.m.
//
// The split between the two matters. `webkit-input-darwin.m` measures the last
// two hops against a bare WKWebView — NSEvent in, page state out — and answers
// "what does WebKit accept". THIS one drives `GjsifyWebKitWebView` itself,
// through the GtkEventControllers it installs, and answers "does the widget we
// ship actually do it": the coordinate flip against the live widget height, the
// GDK-keyval-to-NSString mapping, the scroll-step constant, and the fact that
// the controllers are connected at all.
//
//   meson compile -C packages/framework/webkit-native/build && \
//   clang -fobjc-arc -framework Cocoa \
//       $(pkg-config --cflags --libs gtk4) \
//       -Ipackages/framework/webkit-native/src/objc \
//       -Lpackages/framework/webkit-native/build -lgjsifywebkit \
//       -Wl,-rpath,$PWD/packages/framework/webkit-native/build \
//       docs/poc/webkit-input-widget-darwin.m -o /tmp/webkit-input-widget-darwin && \
//   GSK_RENDERER=cairo /tmp/webkit-input-widget-darwin
//
// Expected on macOS 15.7.8 / x86_64 (exit 0):
//
//   widget 400x300, controllers: click motion scroll key
//     control (nothing emitted)
//       page saw       -> null
//       focused        -> BODY
//     click at 30,50
//       page saw       -> [30,50]
//       focused        -> i
//     key 'x' (keyval 120, keycode 7)
//       input.value    -> x
//     scroll 3 steps down
//       scrollY        -> 120        (3 x 40 px per step)
//   verdict: the widget forwards pointer, keyboard and wheel to the page
//
// WHY IT EMITS THE CONTROLLER SIGNALS RATHER THAN POSTING REAL EVENTS. Two
// routes into GTK's own event translation were built and BOTH are dead ends on
// this host: `-[NSApplication postEvent:atStart:]` is never picked up (GTK4's
// macOS backend does not drain the posted-event queue — measured with a plain
// GtkGestureClick and no WebKit anywhere, 0 hits), and `CGEventPostToPid()` is
// dropped because `AXIsProcessTrusted()` is false and Accessibility is not a
// permission CI can grant itself. Emitting the signal is the same entry point
// GDK would reach: it runs the shim's handlers, which is the code under test.
// What it does NOT cover is GDK's own NSEvent-to-GdkEvent translation, which is
// GTK's code and not this repo's.
//
// A DISPLAY IS REQUIRED (gtk_init opens one), which is why this is a by-hand
// probe like its siblings rather than a CI step — see the DISPLAY-gated-GTK
// entry in status/open-todos.md for why macOS coverage stops here.

#import <Cocoa/Cocoa.h>
#include <gtk/gtk.h>

#include "gjsify-webkit.h"

#define WIN_W 400
#define WIN_H 300
// Inside the <input>, which sits at left:20 top:40 and is 200x24.
#define CLICK_X 30
#define CLICK_Y 50
#define SCROLL_STEPS 3
// The shim's GJSIFY_WEBKIT_PIXELS_PER_SCROLL_STEP. Duplicated deliberately: if
// the two ever disagree, this probe is what says so.
#define PIXELS_PER_STEP 40

static GMainLoop *gLoop;
static gboolean gLoaded;
static gchar *gResult;
static int gFailures;

static const gchar *kPage =
    "<!doctype html><html><body style='margin:0'>"
    "<input id='i' style='position:fixed;left:20px;top:40px;width:200px;height:24px'>"
    "<div style='height:4000px'></div>"
    "<script>"
    "window.seen={mouse:null};"
    "document.addEventListener('mousedown',e=>{seen.mouse=[Math.round(e.clientX),Math.round(e.clientY)]});"
    "</script></body></html>";

static gboolean quit_loop(gpointer user_data)
{
    (void) user_data;
    g_main_loop_quit(gLoop);
    return G_SOURCE_CONTINUE;
}

static void spin(gboolean *done, int ms)
{
    if (done != NULL && *done) {
        return;
    }
    gLoop = g_main_loop_new(NULL, FALSE);
    guint bail = g_timeout_add(ms, quit_loop, NULL);
    g_main_loop_run(gLoop);
    g_source_remove(bail);
    g_main_loop_unref(gLoop);
    gLoop = NULL;
}

static void on_load_changed(GjsifyWebKitWebView *view, gint event, gpointer user_data)
{
    (void) view;
    (void) user_data;
    if (event == GJSIFY_WEBKIT_LOAD_FINISHED) {
        gLoaded = TRUE;
        if (gLoop != NULL) {
            g_main_loop_quit(gLoop);
        }
    }
}

static void on_evaluated(GObject *source, GAsyncResult *result, gpointer user_data)
{
    (void) user_data;
    GError *error = NULL;
    GjsifyWebKitValue *value = gjsify_webkit_web_view_evaluate_javascript_finish(
        GJSIFY_WEBKIT_WEB_VIEW(source), result, &error);

    g_clear_pointer(&gResult, g_free);
    if (error != NULL) {
        gResult = g_strdup_printf("ERR %s", error->message);
        g_error_free(error);
    } else {
        gResult = gjsify_webkit_value_to_string(value);
        g_object_unref(value);
    }
    if (gLoop != NULL) {
        g_main_loop_quit(gLoop);
    }
}

static gchar *eval(GtkWidget *view, const gchar *js)
{
    gboolean done = FALSE;
    gjsify_webkit_web_view_evaluate_javascript(
        GJSIFY_WEBKIT_WEB_VIEW(view), js, -1, NULL, NULL, NULL, on_evaluated, NULL);
    spin(&done, 4000);
    return g_strdup(gResult != NULL ? gResult : "");
}

/* The widget installs its controllers privately, which is the right shape for
 * shipping code and means this probe has to find them the way any other GTK
 * consumer would. */
static GtkEventController *find_controller(GtkWidget *widget, GType type)
{
    GListModel *controllers = gtk_widget_observe_controllers(widget);
    GtkEventController *found = NULL;

    for (guint i = 0; i < g_list_model_get_n_items(controllers); i++) {
        GObject *item = g_list_model_get_item(controllers, i);
        if (G_TYPE_CHECK_INSTANCE_TYPE(item, type)) {
            found = GTK_EVENT_CONTROLLER(item);
            g_object_unref(item);
            break;
        }
        g_object_unref(item);
    }

    g_object_unref(controllers);
    return found;
}

static void check(const char *label, const char *got, const char *want)
{
    gboolean ok = g_strcmp0(got, want) == 0;
    printf("      %-14s -> %-12s%s\n", label, got, ok ? "" : "   EXPECTED: ");
    if (!ok) {
        printf("      %-14s    expected %s\n", "", want);
        gFailures++;
    }
}

int main(void)
{
    gtk_init();

    GtkWidget *view = gjsify_webkit_web_view_new();
    GtkWidget *window = gtk_window_new();
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    gtk_window_set_default_size(GTK_WINDOW(window), WIN_W, WIN_H);
    gtk_window_set_child(GTK_WINDOW(window), view);

    g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), NULL);
    gjsify_webkit_web_view_load_html(GJSIFY_WEBKIT_WEB_VIEW(view), kPage, "about:blank");

    gtk_window_present(GTK_WINDOW(window));

    spin(&gLoaded, 10000);
    if (!gLoaded) {
        printf("page never loaded\n");
        return 1;
    }
    /* One more turn so the first allocation has run: the shim flips y against
     * gtk_widget_get_height(), which is 0 until then. */
    spin(NULL, 500);

    GtkEventController *click = find_controller(view, GTK_TYPE_GESTURE_CLICK);
    GtkEventController *motion = find_controller(view, GTK_TYPE_EVENT_CONTROLLER_MOTION);
    GtkEventController *scroll = find_controller(view, GTK_TYPE_EVENT_CONTROLLER_SCROLL);
    GtkEventController *key = find_controller(view, GTK_TYPE_EVENT_CONTROLLER_KEY);

    printf("widget %dx%d, controllers:%s%s%s%s\n",
           gtk_widget_get_width(view),
           gtk_widget_get_height(view),
           click != NULL ? " click" : " NO-CLICK",
           motion != NULL ? " motion" : " NO-MOTION",
           scroll != NULL ? " scroll" : " NO-SCROLL",
           key != NULL ? " key" : " NO-KEY");
    if (click == NULL || motion == NULL || scroll == NULL || key == NULL) {
        printf("verdict: FAILED — the widget installs no input controllers\n");
        return 1;
    }
    if (!gtk_widget_get_focusable(view)) {
        printf("verdict: FAILED — the widget is not focusable, so it can never be typed into\n");
        return 1;
    }

    /* The control comes first and shares the page: if the assertions below could
     * pass without anything being emitted, they are measuring the page's own
     * initial state rather than the forwarding. */
    printf("  control (nothing emitted)\n");
    gchar *before_mouse = eval(view, "JSON.stringify(seen.mouse)");
    gchar *before_focus = eval(view, "document.activeElement.id || document.activeElement.tagName");
    check("page saw", before_mouse, "null");
    check("focused", before_focus, "BODY");

    printf("  click at %d,%d\n", CLICK_X, CLICK_Y);
    g_signal_emit_by_name(click, "pressed", 1, (double) CLICK_X, (double) CLICK_Y);
    g_signal_emit_by_name(click, "released", 1, (double) CLICK_X, (double) CLICK_Y);
    spin(NULL, 600);

    gchar *mouse = eval(view, "JSON.stringify(seen.mouse)");
    gchar *active = eval(view, "document.activeElement.id || document.activeElement.tagName");
    gchar *expected_point = g_strdup_printf("[%d,%d]", CLICK_X, CLICK_Y);
    check("page saw", mouse, expected_point);
    check("focused", active, "i");

    /* keyval 120 is 'x', keycode 7 is its Carbon virtual keycode — the pair GDK
     * would hand over on this backend. */
    printf("  key 'x' (keyval 120, keycode 7)\n");
    gboolean handled = FALSE;
    g_signal_emit_by_name(key, "key-pressed", (guint) 'x', (guint) 7, (GdkModifierType) 0, &handled);
    g_signal_emit_by_name(key, "key-released", (guint) 'x', (guint) 7, (GdkModifierType) 0);
    spin(NULL, 600);

    gchar *typed = eval(view, "document.getElementById('i').value");
    check("input.value", typed, "x");

    printf("  scroll %d steps down\n", SCROLL_STEPS);
    g_signal_emit_by_name(scroll, "scroll", 0.0, (double) SCROLL_STEPS, &handled);
    spin(NULL, 800);

    gchar *scrolled = eval(view, "String(Math.round(window.scrollY))");
    gchar *expected_scroll = g_strdup_printf("%d", SCROLL_STEPS * PIXELS_PER_STEP);
    printf("      %-14s -> %-12s   (%d x %d px per step)\n",
           "scrollY", scrolled, SCROLL_STEPS, PIXELS_PER_STEP);
    if (g_strcmp0(scrolled, expected_scroll) != 0) {
        printf("      %-14s    expected %s — PIXELS_PER_SCROLL_STEP disagrees with the shim\n",
               "", expected_scroll);
        gFailures++;
    }

    printf(gFailures == 0
               ? "verdict: the widget forwards pointer, keyboard and wheel to the page\n"
               : "verdict: FAILED — the widget lost or mangled input\n");

    gtk_window_destroy(GTK_WINDOW(window));
    return gFailures == 0 ? 0 : 1;
}
