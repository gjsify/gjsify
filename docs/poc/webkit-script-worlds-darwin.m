// SPDX-License-Identifier: MIT
//
// Do named script worlds ISOLATE, and do user-script allow/block lists FILTER?
// Companion to docs/adr/0022-webkit-on-darwin.md, and the measurement behind the
// correction to two of its "what is not implemented" bullets.
//
//   meson compile -C packages/framework/webkit-native/build && \
//   clang -fobjc-arc -framework Cocoa \
//       $(pkg-config --cflags --libs gtk4) \
//       -Ipackages/framework/webkit-native/src/objc \
//       -Lpackages/framework/webkit-native/build -lgjsifywebkit \
//       -Wl,-rpath,$PWD/packages/framework/webkit-native/build \
//       docs/poc/webkit-script-worlds-darwin.m -o /tmp/webkit-script-worlds-darwin && \
//   /tmp/webkit-script-worlds-darwin
//
// Expected on macOS 15.7.8 / x86_64 (exit 0):
//
//   worlds — a script in "iso" and one in the page world, same document
//     page world sees   -> page
//     "iso" world sees  -> iso
//     handler in "iso", read from the page      -> undefined
//     handler in the page world, read from page -> object
//   url patterns — document is https://example.com/page
//     allow https://example.com/*  -> ran
//     allow https://other.test/*   -> did not run
//     allow *://*.example.com/*    -> ran
//     block *://*/*                -> did not run
//     path allow  https://example.com/other/* -> did not run
//   verdict: worlds isolate and URL patterns filter
//
// WHY IT EXISTS. ADR 0022 shipped claiming "WKWebView has no public
// isolated-world API", and refused a non-NULL world outright. That was wrong:
// `WKContentWorld` has been public since macOS 11, together with the
// `inContentWorld:` overloads of `addScriptMessageHandler`, `WKUserScript`'s
// initialiser and `evaluateJavaScript`. Since the claim was wrong once, the
// replacement is a measurement rather than a second claim — and it measures the
// property that matters, ISOLATION, not merely that the calls do not throw.
//
// The URL-pattern half is measured for a different reason. Apple's WKUserScript
// really does have no URL filter, so the shim implements the patterns by
// wrapping the source in a guard. A guard that is subtly wrong is worse than the
// warning it replaced, because a block list that fails open is a script running
// on an origin the caller excluded. `loadHTMLString:baseURL:` gives the document
// a real origin without a network, so the patterns are tested against one.

#import <Cocoa/Cocoa.h>
#include <gtk/gtk.h>

#include "gjsify-webkit.h"

static GMainLoop *gLoop;
static gboolean gLoaded;
static gchar *gResult;
static int gFailures;

static gboolean pump(gpointer user_data)
{
    (void) user_data;
    while (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true) == kCFRunLoopRunHandledSource) {
        /* keep draining */
    }
    return G_SOURCE_CONTINUE;
}

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
    guint pump_id = g_timeout_add(4, pump, NULL);
    guint bail = g_timeout_add(ms, quit_loop, NULL);
    g_main_loop_run(gLoop);
    g_source_remove(pump_id);
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

static gchar *eval_in(GtkWidget *view, const gchar *world, const gchar *js)
{
    gboolean done = FALSE;
    gjsify_webkit_web_view_evaluate_javascript(
        GJSIFY_WEBKIT_WEB_VIEW(view), js, -1, world, NULL, NULL, on_evaluated, NULL);
    spin(&done, 4000);
    return g_strdup(gResult != NULL ? gResult : "");
}

static void check(const char *label, const char *got, const char *want)
{
    gboolean ok = g_strcmp0(got, want) == 0;
    printf("    %-42s -> %s%s\n", label, got, ok ? "" : "   <- EXPECTED");
    if (!ok) {
        printf("    %-42s    expected %s\n", "", want);
        gFailures++;
    }
}

/* Marks the shared DOM rather than a per-world global, so whether a script RAN
 * is observable from any world — which is what makes the URL-pattern cases
 * readable with one evaluation each. */
static void add_marked_script(GjsifyWebKitUserContentManager *ucm,
                              const gchar *mark,
                              const gchar *const *allow,
                              const gchar *const *block)
{
    gchar *source = g_strdup_printf(
        "document.documentElement.dataset.ran = (document.documentElement.dataset.ran||'') + '%s';",
        mark);
    GjsifyWebKitUserScript *script =
        gjsify_webkit_user_script_new(source,
                                      GJSIFY_WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
                                      GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END,
                                      allow,
                                      block);
    gjsify_webkit_user_content_manager_add_script(ucm, script);
    gjsify_webkit_user_script_unref(script);
    g_free(source);
}

int main(void)
{
    gtk_init();

    GjsifyWebKitUserContentManager *ucm = gjsify_webkit_user_content_manager_new();

    /* ---- worlds ---------------------------------------------------------
     * The same property name in two worlds. If the worlds were not isolated,
     * one would overwrite the other and both reads would return the same value
     * — which is precisely the failure this measures. */
    GjsifyWebKitUserScript *page_script =
        gjsify_webkit_user_script_new("window.__which = 'page';",
                                      GJSIFY_WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
                                      GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
                                      NULL,
                                      NULL);
    gjsify_webkit_user_content_manager_add_script(ucm, page_script);
    gjsify_webkit_user_script_unref(page_script);

    GjsifyWebKitUserScript *iso_script =
        gjsify_webkit_user_script_new_for_world("window.__which = 'iso';",
                                                GJSIFY_WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
                                                GJSIFY_WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
                                                "iso",
                                                NULL,
                                                NULL);
    gjsify_webkit_user_content_manager_add_script(ucm, iso_script);
    gjsify_webkit_user_script_unref(iso_script);

    gboolean page_handler =
        gjsify_webkit_user_content_manager_register_script_message_handler(ucm, "bridge", NULL);
    gboolean iso_handler =
        gjsify_webkit_user_content_manager_register_script_message_handler(ucm, "secret", "iso");

    /* ---- url patterns ---------------------------------------------------- */
    const gchar *allow_same[] = { "https://example.com/*", NULL };
    const gchar *allow_other[] = { "https://other.test/*", NULL };
    const gchar *allow_subdomain[] = { "*://*.example.com/*", NULL };
    const gchar *allow_other_path[] = { "https://example.com/other/*", NULL };
    const gchar *block_all[] = { "*://*/*", NULL };

    add_marked_script(ucm, "A", allow_same, NULL);
    add_marked_script(ucm, "B", allow_other, NULL);
    add_marked_script(ucm, "S", allow_subdomain, NULL);
    add_marked_script(ucm, "C", NULL, block_all);
    add_marked_script(ucm, "P", allow_other_path, NULL);

    GtkWidget *view = GTK_WIDGET(
        g_object_new(GJSIFY_WEBKIT_TYPE_WEB_VIEW, "user-content-manager", ucm, NULL));
    g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), NULL);

    /* A real origin without a network: baseURL is what location.* reports. */
    gjsify_webkit_web_view_load_html(GJSIFY_WEBKIT_WEB_VIEW(view),
                                     "<!doctype html><html><body>x</body></html>",
                                     "https://example.com/page");
    spin(&gLoaded, 10000);
    if (!gLoaded) {
        printf("page never loaded\n");
        return 1;
    }
    spin(NULL, 300);

    printf("worlds — a script in \"iso\" and one in the page world, same document\n");
    check("register in the page world returned", page_handler ? "TRUE" : "FALSE", "TRUE");
    check("register in \"iso\" returned", iso_handler ? "TRUE" : "FALSE", "TRUE");
    check("page world sees", eval_in(view, NULL, "String(window.__which)"), "page");
    check("\"iso\" world sees", eval_in(view, "iso", "String(window.__which)"), "iso");
    check("handler \"secret\" read from the page world",
          eval_in(view, NULL, "typeof window.webkit.messageHandlers.secret"),
          "undefined");
    check("handler \"bridge\" read from the page world",
          eval_in(view, NULL, "typeof window.webkit.messageHandlers.bridge"),
          "object");
    check("handler \"secret\" read from \"iso\"",
          eval_in(view, "iso", "typeof window.webkit.messageHandlers.secret"),
          "object");

    printf("url patterns — document is %s\n",
           eval_in(view, NULL, "location.href"));
    gchar *ran = eval_in(view, NULL, "String(document.documentElement.dataset.ran||'')");
    // Marks are appended in injection order, so the whole outcome is one string:
    // A (same origin) and S (subdomain wildcard) ran, B, C and P did not.
    check("scripts that ran (A allow-same, S allow-subdomain)", ran, "AS");

    printf(gFailures == 0 ? "verdict: worlds isolate and URL patterns filter\n"
                          : "verdict: FAILED\n");
    return gFailures == 0 ? 0 : 1;
}
