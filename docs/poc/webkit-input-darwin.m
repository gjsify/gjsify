// SPDX-License-Identifier: MIT
//
// Does a synthesized NSEvent reach the page inside a WKWebView, in which
// coordinate space, and what does the view need before a keystroke reaches a
// focused text field? Companion to docs/adr/0022-webkit-on-darwin.md — this is
// the measurement the input-forwarding half rests on.
//
//   clang -fobjc-arc -framework Cocoa -framework WebKit \
//       $(pkg-config --cflags --libs glib-2.0) \
//       docs/poc/webkit-input-darwin.m -o /tmp/webkit-input-darwin && \
//       /tmp/webkit-input-darwin
//
// Expected on macOS 15.7.8 / x86_64 (exit 0):
//
//   activation policy of a non-bundled process : Prohibited
//   WKWebView isFlipped                       : YES   (top-left, like GTK)
//
//     [1] control — no events sent:
//           mousedown at      : NOT SEEN   (sent 30,50 top-left)
//           focused element   : BODY
//           input.value       : (empty)
//           scrollY           : 0   (sent 50 px)
//           document.hasFocus : false
//     [2] windowless view, synthesized NSEvents:
//           mousedown at      : [30,50]   (sent 30,50 top-left)
//           focused element   : i
//           input.value       : x
//           scrollY           : 50   (sent 50 px)
//           document.hasFocus : false   <- finding 4: no public way to set it
//
//   verdict: a windowless WKWebView takes mouse, key and wheel events, and a
//            forwarded click focuses the element under it. The event location
//            is BOTTOM-LEFT even though the view is flipped; wheel px are 1:1.
//
// WHY THIS EXISTS. The rendering half never needed a window: takeSnapshot works
// on a windowless view, which is why stage 2 shipped without one. Input is
// where that stops being obvious — every NSEvent carries `windowNumber` and a
// `locationInWindow`, and WebKit decides "is this view focused" by asking
// whether it is the first responder of its window. A view with no window has no
// answer to the second question, and the first is a coordinate space that does
// not exist.
//
// WHAT IT MEASURED, INCLUDING THE PART THAT WAS BUILT AND THROWN AWAY:
//
//   1. WHICH COORDINATE SPACE. `-[WKWebView isFlipped]` is YES, so the view's
//      own space is top-left like GTK's — but an NSEvent's `locationInWindow`
//      is WINDOW space, which is bottom-left, and WebKit converts with
//      `-[NSView convertPoint:fromView:nil]`. Sending an unflipped y=55 into a
//      300 px view lands at clientY=245. It has to be flipped exactly once.
//      This is the whole of the pointer work, and getting it wrong is an
//      off-by-viewport-height bug that only shows up as "clicks hit the wrong
//      element".
//
//   2. NO WINDOW, NO FIRST RESPONDER, NO ACTIVATION POLICY. The expectation
//      going in was that text input would need the view to be first responder
//      of a key window, because WebKit derives `ActivityState::IsFocused` from
//      exactly that. All three modes were built and measured — bare windowless,
//      windowless + `-[NSView becomeFirstResponder]`, and a parked offscreen
//      NSWindow + `-[NSWindow makeFirstResponder:]` — and they are
//      INDISTINGUISHABLE: identical on every line, typing included. So the shim
//      creates no window, touches no responder chain, and leaves the activation
//      policy at `Prohibited` (which is what keeps a `gjs` CLI process out of
//      the Dock). The offscreen window was strictly worse while it existed: it
//      never became key even under policy `Accessory`, and it dragged the wheel
//      event's location out of the view with it.
//
//   3. A FORWARDED CLICK FOCUSES THE ELEMENT UNDER IT, and a keystroke then
//      reaches that element. So there is no separate focus channel to build:
//      DOM focus follows the pointer exactly as it does on Linux.
//
//   4. `document.hasFocus()` STAYS FALSE, in all three modes. That is the one
//      thing the offscreen window was supposed to buy and does not. It is a
//      page-level activity-state flag, distinct from which element has DOM
//      focus, and the public API offers no way to set it — so `window.onfocus`
//      / `onblur` and focus-dependent UA chrome (a blinking caret) do not fire.
//      Recorded as a measured limitation rather than guessed at.
//
//   5. WHEEL DELTAS ARE 1:1 IN PIXELS. `kCGScrollEventUnitPixel` with 50 scrolls
//      the page by exactly 50, so GTK's own pixel deltas pass through unscaled.
//
// The probe fails if the control starts seeing input nobody sent, or if any of
// the forwarded paths stops arriving where it was aimed — so it retires itself
// rather than becoming a comment.

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <glib.h>

#define VIEW_W 400
#define VIEW_H 300
// Inside the <input>, which sits at left:20 top:40 and is 200x24.
#define CLICK_X 30
#define CLICK_Y 50
#define SCROLL_PX 50

static GMainLoop *gLoop;
static gboolean gLoaded;
static NSString *gResult;

// The drain from docs/poc/webkit-runloop-darwin.m — without it nothing in this
// file completes, which that probe is the measurement of.
static gboolean pump(gpointer user_data) {
    (void) user_data;
    while (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true) == kCFRunLoopRunHandledSource) {
        /* keep draining */
    }
    return G_SOURCE_CONTINUE;
}

// G_SOURCE_CONTINUE, not REMOVE: spin() removes it unconditionally on the way
// out, and a source that retired itself first is a GLib-CRITICAL.
static gboolean quit_loop(gpointer user_data) {
    (void) user_data;
    g_main_loop_quit(gLoop);
    return G_SOURCE_CONTINUE;
}

// Run the main loop until `done` is set, or for `ms` if `done` is NULL. Every
// step below is asynchronous and there is no AppKit loop to borrow, so this is
// the only way to wait.
static void spin(gboolean *done, int ms) {
    if (done != NULL && *done) {
        return;
    }
    gLoop = g_main_loop_new(NULL, FALSE);
    guint pump_id = g_timeout_add(4, pump, NULL);
    guint bail_id = g_timeout_add(ms, quit_loop, NULL);
    g_main_loop_run(gLoop);
    g_source_remove(pump_id);
    g_source_remove(bail_id);
    g_main_loop_unref(gLoop);
    gLoop = NULL;
}

@interface Probe : NSObject <WKNavigationDelegate>
@end

@implementation Probe
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    (void) webView;
    (void) navigation;
    gLoaded = YES;
    g_main_loop_quit(gLoop);
}
@end

// Nothing here focuses or scrolls on its own: an auto-`focus()` scrolls the
// field into view, which reads exactly like a wheel event that worked.
static NSString *const kPage =
    @"<!doctype html><html><body style='margin:0'>"
    @"<input id='i' style='position:fixed;left:20px;top:40px;width:200px;height:24px'>"
    @"<div style='height:2000px'></div>"
    @"<script>"
    @"window.seen={mouse:null,key:null};"
    @"document.addEventListener('mousedown',e=>{seen.mouse=[Math.round(e.clientX),Math.round(e.clientY)]});"
    @"document.addEventListener('keydown',e=>{seen.key=e.key});"
    @"</script></body></html>";

static NSString *eval(WKWebView *view, NSString *js) {
    __block gboolean done = FALSE;
    gResult = nil;
    [view evaluateJavaScript:js
           completionHandler:^(id result, NSError *error) {
        gResult = error != nil ? [NSString stringWithFormat:@"ERR %@", [error localizedDescription]]
                               : [NSString stringWithFormat:@"%@", result];
        done = TRUE;
        g_main_loop_quit(gLoop);
    }];
    spin(&done, 5000);
    return gResult != nil ? gResult : @"";
}

static double now_seconds(void) { return [[NSProcessInfo processInfo] systemUptime]; }

static void send_click(WKWebView *view) {
    // GTK hands top-left widget coordinates; an NSEvent's location is
    // bottom-left window space. This is the single flip finding 1 is about.
    NSPoint where = NSMakePoint(CLICK_X, VIEW_H - CLICK_Y);

    for (int down = 1; down >= 0; down--) {
        NSEvent *event = [NSEvent mouseEventWithType:down ? NSEventTypeLeftMouseDown
                                                          : NSEventTypeLeftMouseUp
                                            location:where
                                       modifierFlags:0
                                           timestamp:now_seconds()
                                        windowNumber:0
                                             context:nil
                                         eventNumber:0
                                          clickCount:1
                                            pressure:down ? 1.0 : 0.0];
        if (down) {
            [view mouseDown:event];
        } else {
            [view mouseUp:event];
        }
    }
}

static void send_key(WKWebView *view) {
    // keyCode 7 is 'x' on an ANSI layout. `keyDown:` is what a real window
    // sends, and WebKit routes it through interpretKeyEvents: — the same path
    // an input method feeds, which is why IME needs no separate channel.
    NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                    location:NSZeroPoint
                               modifierFlags:0
                                   timestamp:now_seconds()
                                windowNumber:0
                                     context:nil
                                  characters:@"x"
                 charactersIgnoringModifiers:@"x"
                                   isARepeat:NO
                                     keyCode:7];
    [view keyDown:key];
}

// Deliberately left out of send_key's signature: windowNumber stays 0. The
// version of this probe that parked the view in an offscreen NSWindow passed
// that window's number here, and it moved the wheel event's location out of the
// view — see finding 2.

static void send_wheel(WKWebView *view) {
    // NSEvent has no public constructor for a scroll event carrying deltas, so
    // it has to come from a CGEvent — which is also how the shim builds it.
    CGEventRef cg = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 1, -SCROLL_PX);
    if (cg == NULL) {
        return;
    }
    NSEvent *wheel = [NSEvent eventWithCGEvent:cg];
    if (wheel != nil) {
        [view scrollWheel:wheel];
    }
    CFRelease(cg);
}

// `send` is the ONLY difference between the two cases: same view, same page,
// same waits. Returns TRUE if the page saw everything, landing where it was
// aimed.
static gboolean run_case(int index, const char *title, gboolean send) {
    printf("  [%d] %s:\n", index, title);

    @autoreleasepool {
        Probe *probe = [[Probe alloc] init];
        WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, VIEW_W, VIEW_H)
                                             configuration:[[WKWebViewConfiguration alloc] init]];
        view.navigationDelegate = probe;

        gLoaded = FALSE;
        [view loadHTMLString:kPage baseURL:[NSURL URLWithString:@"about:blank"]];
        spin(&gLoaded, 8000);
        if (!gLoaded) {
            printf("        page never loaded\n");
            return FALSE;
        }

        // Each step waits before the next: the events cross to the web process
        // and the answers come back through the same CFRunLoop the drain is
        // servicing, so both directions need time.
        if (send) {
            send_click(view);
        }
        spin(NULL, 400);

        NSString *mouse = eval(view, @"JSON.stringify(seen.mouse)");
        NSString *active = eval(view, @"document.activeElement.id || document.activeElement.tagName");
        NSString *page_focus = eval(view, @"String(document.hasFocus())");

        if (send) {
            send_key(view);
        }
        spin(NULL, 400);

        NSString *value = eval(view, @"document.getElementById('i').value");

        if (send) {
            send_wheel(view);
        }
        spin(NULL, 400);

        NSString *scroll = eval(view, @"String(Math.round(window.scrollY))");

        gboolean saw_mouse = ![mouse isEqualToString:@"null"];
        gboolean typed = [value isEqualToString:@"x"];
        gboolean scrolled = [scroll intValue] != 0;

        printf("        mousedown at      : %s   (sent %d,%d top-left)\n",
               saw_mouse ? [mouse UTF8String] : "NOT SEEN", CLICK_X, CLICK_Y);
        printf("        focused element   : %s\n", [active UTF8String]);
        printf("        input.value       : %s\n", typed ? [value UTF8String] : "(empty)");
        printf("        scrollY           : %s   (sent %d px)\n", [scroll UTF8String], SCROLL_PX);
        printf("        document.hasFocus : %s%s\n",
               [page_focus UTF8String],
               send && [page_focus isEqualToString:@"false"]
                   ? "   <- finding 4: no public way to set it" : "");

        view.navigationDelegate = nil;

        if (!send) {
            return saw_mouse || typed || scrolled;
        }

        // Arriving is not enough — it has to arrive where it was aimed. A click
        // at the wrong y is the off-by-viewport-height bug finding 1 is about,
        // and it would still "work" by every other line above.
        NSString *expected = [NSString stringWithFormat:@"[%d,%d]", CLICK_X, CLICK_Y];
        if (saw_mouse && ![mouse isEqualToString:expected]) {
            printf("        COORDINATES WRONG : expected %s\n", [expected UTF8String]);
            return FALSE;
        }
        if (scrolled && [scroll intValue] != SCROLL_PX) {
            printf("        WHEEL NOT 1:1     : expected %d\n", SCROLL_PX);
            return FALSE;
        }
        return saw_mouse && typed && scrolled && [active isEqualToString:@"i"];
    }
}

static const char *policy_name(NSApplicationActivationPolicy policy) {
    switch (policy) {
        case NSApplicationActivationPolicyRegular: return "Regular";
        case NSApplicationActivationPolicyAccessory: return "Accessory";
        case NSApplicationActivationPolicyProhibited: return "Prohibited";
    }
    return "unknown";
}

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        printf("activation policy of a non-bundled process : %s\n",
               policy_name([NSApp activationPolicy]));

        WKWebView *sample = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1, 1)
                                              configuration:[[WKWebViewConfiguration alloc] init]];
        printf("WKWebView isFlipped                       : %s   (%s)\n\n",
               sample.isFlipped ? "YES" : "NO",
               sample.isFlipped ? "top-left, like GTK" : "bottom-left, unlike GTK");

        gboolean control = run_case(1, "control — no events sent", FALSE);
        gboolean forwarded = run_case(2, "windowless view, synthesized NSEvents", TRUE);

        printf("\n");
        // The measurement is only meaningful if the two cases DISAGREE.
        if (control) {
            printf("verdict: UNEXPECTED — the control saw input nobody sent\n");
            return 1;
        }
        if (!forwarded) {
            printf("verdict: UNEXPECTED — forwarding failed; the shim's input path is dead\n");
            return 1;
        }
        printf("verdict: a windowless WKWebView takes mouse, key and wheel events, and a\n");
        printf("         forwarded click focuses the element under it. The event location\n");
        printf("         is BOTTOM-LEFT even though the view is flipped; wheel px are 1:1.\n");
    }
    return 0;
}
