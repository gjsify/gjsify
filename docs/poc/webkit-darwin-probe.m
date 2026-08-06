// SPDX-License-Identifier: MIT
//
// Does Apple's WebKit cover what `@gjsify/iframe` asks WebKitGTK for?
// Companion to docs/adr/0022-webkit-on-darwin.md — read that for the decision
// this measurement supports.
//
//   clang -fobjc-arc -framework Cocoa -framework WebKit \
//       docs/poc/webkit-darwin-probe.m -o /tmp/webkit-darwin-probe && \
//       /tmp/webkit-darwin-probe
//
// Expected on macOS 15.7.8 / x86_64 (exit 0):
//
//   probing WKWebView in a NON-BUNDLED process (no .app):
//     [ok] script message from the page: hello from the user script
//     [ok] navigation finished  (== WebKit.LoadEvent.FINISHED)
//     [ok] evaluateJavaScript -> gjsify/document-start
//     [ok] takeSnapshot -> 800x600 px, 32 bpp  (== Gdk.Texture source)
//
// `@gjsify/iframe` uses a small WebKitGTK surface: WebKit.WebView as a
// Gtk.Widget, WebKit.Settings, a UserContentManager + UserScript injected at
// document start, evaluate_javascript(), the load-changed/LoadEvent lifecycle,
// and get_snapshot() -> Gdk.Texture. This probe runs the ENGINE half of that
// against WKWebView, in a plain non-bundled CLI process (no .app — which is
// what a `gjs` process is), so the answer is measured rather than assumed.
//
// It deliberately does NOT probe the widget half: WKWebView is an NSView and
// GTK4 has no foreign-window embedding. That is the ADR's whole point.

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static int gExit = 2;

@interface Probe : NSObject <WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, assign) BOOL sawDocumentStartScript;
@end

@implementation Probe

- (void)userContentController:(WKUserContentController *)ucc
      didReceiveScriptMessage:(WKScriptMessage *)message {
    // The postMessage bridge `@gjsify/iframe` builds on top of the user script.
    printf("  [ok] script message from the page: %s\n", [[NSString stringWithFormat:@"%@", message.body] UTF8String]);
    self.sawDocumentStartScript = YES;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    printf("  [ok] navigation finished  (== WebKit.LoadEvent.FINISHED)\n");

    // == webView.evaluate_javascript()
    [webView evaluateJavaScript:@"document.querySelector('h1').textContent + '/' + (window.__injected ?? 'NO-USER-SCRIPT')"
              completionHandler:^(id result, NSError *error) {
        if (error) {
            printf("  [FAIL] evaluateJavaScript: %s\n", error.localizedDescription.UTF8String);
            gExit = 1;
            [NSApp terminate:nil];
            return;
        }
        printf("  [ok] evaluateJavaScript -> %s\n", [[NSString stringWithFormat:@"%@", result] UTF8String]);

        // == webView.get_snapshot(SnapshotRegion, SnapshotOptions) -> Gdk.Texture
        WKSnapshotConfiguration *cfg = [[WKSnapshotConfiguration alloc] init];
        [webView takeSnapshotWithConfiguration:cfg completionHandler:^(NSImage *image, NSError *snapErr) {
            if (snapErr || !image) {
                printf("  [FAIL] takeSnapshot: %s\n",
                       snapErr ? snapErr.localizedDescription.UTF8String : "no image");
                gExit = 1;
            } else {
                CGImageRef cg = [image CGImageForProposedRect:NULL context:nil hints:nil];
                printf("  [ok] takeSnapshot -> %zux%zu px, %zu bpp  (== Gdk.Texture source)\n",
                       CGImageGetWidth(cg), CGImageGetHeight(cg), CGImageGetBitsPerPixel(cg));
                gExit = self.sawDocumentStartScript ? 0 : 1;
            }
            [NSApp terminate:nil];
        }];
    }];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    printf("  [FAIL] navigation failed: %s\n", error.localizedDescription.UTF8String);
    gExit = 1;
    [NSApp terminate:nil];
}

@end

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        // No Dock icon, no menu bar: this is what a `gjs` CLI process is.
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

        Probe *probe = [[Probe alloc] init];

        WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
        WKUserContentController *ucc = [[WKUserContentController alloc] init];

        // == WebKit.UserContentManager + WebKit.UserScript at
        //    UserScriptInjectionTime.START, ALL_FRAMES
        WKUserScript *script =
            [[WKUserScript alloc] initWithSource:@"window.__injected = 'document-start';"
                                                  "window.webkit.messageHandlers.bridge.postMessage('hello from the user script');"
                                   injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                forMainFrameOnly:NO];
        [ucc addUserScript:script];
        [ucc addScriptMessageHandler:probe name:@"bridge"];
        config.userContentController = ucc;

        // Offscreen: no NSWindow at all, which is the shape a GdkPaintable
        // backend would need.
        probe.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)
                                           configuration:config];
        probe.webView.navigationDelegate = probe;

        printf("probing WKWebView in a NON-BUNDLED process (no .app):\n");
        [probe.webView loadHTMLString:@"<html><body style='background:#fff'><h1>gjsify</h1></body></html>"
                              baseURL:nil];

        // Hard timeout so a hang is a result, not a wedged run.
        [NSTimer scheduledTimerWithTimeInterval:20.0 repeats:NO block:^(NSTimer *t) {
            printf("  [FAIL] timed out after 20 s\n");
            gExit = 1;
            [NSApp terminate:nil];
        }];

        [NSApp run];
    }
    printf("verdict: %s\n", gExit == 0 ? "the engine half maps 1:1" : "incomplete");
    return gExit;
}
