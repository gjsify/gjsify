// SPDX-License-Identifier: MIT
//
// Does a GLib main loop drive a WKWebView? Companion to
// docs/adr/0022-webkit-on-darwin.md — this is the measurement the ADR's
// stage-1 decision rests on, and the one the first draft was missing.
//
//   clang -fobjc-arc -framework Cocoa -framework WebKit \
//       $(pkg-config --cflags --libs glib-2.0) \
//       docs/poc/webkit-runloop-darwin.m -o /tmp/webkit-runloop-darwin && \
//       /tmp/webkit-runloop-darwin
//
// Expected on macOS 15.7.8 / x86_64 (exit 0):
//
//   [1] bare GMainLoop, no CFRunLoop drain:
//         TIMED OUT after 8 s — didFinishNavigation never fired
//   [2] GMainLoop + a CFRunLoop drain source:
//         navigation finished
//         evaluateJavaScript -> 2
//   verdict: WKWebView needs the CFRunLoop drained; a GMainContext does not do it
//
// WHY THIS EXISTS. docs/poc/webkit-darwin-probe.m measures the API surface, and
// it does so under `[NSApp run]` — a full AppKit run loop. That is NOT the
// process shape @gjsify/iframe runs in: GJS drives a GMainContext, and
// @gjsify/webkit-native has no AppKit loop to borrow. Case [1] is that shape,
// and it does not merely run slowly — nothing arrives at all, because
// WKWebView's callbacks are CFRunLoop sources and a GMainContext never looks at
// them. Case [2] is the fix the shim ships (gjsify_webkit_pump_run_loop).
//
// The interval is a compromise with no better option: the CFRunLoop's wakeup
// port is not public API, so there is no descriptor for a GSource to poll and a
// timer is the only integration point available.

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <glib.h>

static GMainLoop *gLoop;
static gboolean gFired;
// Owned here rather than in run_case(): `bail` returns G_SOURCE_REMOVE, so the
// id is already dead by the time run_case() resumes and removing it again is a
// GLib-CRITICAL. The callback that retires the source is the one that clears it.
static guint gBailId;

@interface Probe : NSObject <WKNavigationDelegate>
@end

@implementation Probe

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    printf("      navigation finished\n");
    [webView evaluateJavaScript:@"1+1" completionHandler:^(id result, NSError *error) {
        printf("      evaluateJavaScript -> %s\n",
               [[NSString stringWithFormat:@"%@", result] UTF8String]);
        gFired = YES;
        g_main_loop_quit(gLoop);
    }];
}

@end

// The drain the shim installs. Zero timeout + returnAfterSourceHandled:YES
// handles ONE source per call, so the inner loop is what makes a burst of
// callbacks land in the same iteration instead of one per timer tick.
static gboolean pump(gpointer user_data) {
    (void) user_data;
    while (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true) == kCFRunLoopRunHandledSource) {
        /* keep draining */
    }
    return G_SOURCE_CONTINUE;
}

static gboolean bail(gpointer user_data) {
    (void) user_data;
    printf("      TIMED OUT after 8 s — didFinishNavigation never fired\n");
    gBailId = 0;
    g_main_loop_quit(gLoop);
    return G_SOURCE_REMOVE;
}

// `with_pump` is the ONLY difference between the two cases: same view, same
// page, same loop.
static gboolean run_case(const char *title, gboolean with_pump) {
    printf("  [%s] %s:\n", with_pump ? "2" : "1", title);

    @autoreleasepool {
        Probe *probe = [[Probe alloc] init];
        WKWebView *webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 320, 240)
                                                configuration:[[WKWebViewConfiguration alloc] init]];
        webView.navigationDelegate = probe;
        [webView loadHTMLString:@"<h1>gjsify</h1>" baseURL:nil];

        gFired = NO;
        gLoop = g_main_loop_new(NULL, FALSE);
        guint pump_id = with_pump ? g_timeout_add(4, pump, NULL) : 0;
        gBailId = g_timeout_add_seconds(8, bail, NULL);

        g_main_loop_run(gLoop);

        if (pump_id != 0) {
            g_source_remove(pump_id);
        }
        g_clear_handle_id(&gBailId, g_source_remove);
        g_main_loop_unref(gLoop);
        gLoop = NULL;
    }

    return gFired;
}

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        // No Dock icon and no [NSApp run]: this is what a `gjs` process is.
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

        gboolean bare = run_case("bare GMainLoop, no CFRunLoop drain", FALSE);
        gboolean pumped = run_case("GMainLoop + a CFRunLoop drain source", TRUE);

        // The measurement is only meaningful if the two cases DISAGREE: a bare
        // loop that worked would mean the shim's pump is dead weight, and a
        // pumped loop that failed would mean the pump is not the answer.
        // Either way the ADR would be wrong, so both are failures here.
        if (bare) {
            printf("verdict: UNEXPECTED — the bare loop worked; the pump may be unnecessary\n");
            return 1;
        }
        if (!pumped) {
            printf("verdict: UNEXPECTED — the pump did not help; stage 1 needs another answer\n");
            return 1;
        }
        printf("verdict: WKWebView needs the CFRunLoop drained; a GMainContext does not do it\n");
    }
    return 0;
}
