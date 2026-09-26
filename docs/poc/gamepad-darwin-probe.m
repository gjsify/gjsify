// SPDX-License-Identifier: MIT
//
// Which macOS gamepad mechanism can a GJS process actually drive? Companion to
// docs/adr/0075-darwin-gamepad-backend-is-sdl3-behind-a-gobject-shim.md — the
// measurements that ADR's decision rests on.
//
//   clang -fobjc-arc -framework Foundation -framework IOKit -framework GameController \
//       $(pkg-config --cflags --libs glib-2.0 sdl3) \
//       docs/poc/gamepad-darwin-probe.m -o /tmp/gamepad-darwin-probe && \
//       /tmp/gamepad-darwin-probe all
//
// Each mode can be run alone, which is how it is leak-checked:
//
//   leaks --atExit -- /tmp/gamepad-darwin-probe iokit
//
// WHY A NON-BUNDLED CLI PROCESS DRIVING A GMainLoop. That is the process shape
// `gjs` is (no `.app`, no bundle identifier, no NSApplication, a GMainContext
// instead of a CFRunLoop), and it is the shape docs/poc/webkit-runloop-darwin.m
// showed Apple frameworks can silently NOT work in. Every case below runs there.
//
// WHAT IT CANNOT MEASURE. No controller was attached when this was written, so
// every "devices" figure is the zero-device path: that the mechanism
// initialises, enumerates nothing cleanly, tears down, and leaks nothing across
// repeated init/teardown cycles. Input delivery from a real device is NOT
// measured here and the ADR says so.

#import <Foundation/Foundation.h>
#import <GameController/GameController.h>
#include <IOKit/hid/IOHIDManager.h>
#include <SDL3/SDL.h>
#include <glib.h>
#include <string.h>

static const int CYCLES = 20;

// Run a bare GMainLoop for `ms` — the loop GJS runs, with nothing Apple-specific
// attached to it.
static void spin_gmainloop(guint ms) {
    GMainLoop *loop = g_main_loop_new(NULL, FALSE);
    g_timeout_add_once(ms, (GSourceOnceFunc)g_main_loop_quit, loop);
    g_main_loop_run(loop);
    g_main_loop_unref(loop);
}

// [1] Does a GMainLoop service the MAIN dispatch queue? GameController.framework
// delivers its connect notifications and every valueChangedHandler on
// `GCController.handlerQueue`, whose documented default is the main queue — so
// this decides whether GCF can report anything at all in a GJS process.
static void probe_main_queue(void) {
    printf("[1] main dispatch queue under a GMainLoop:\n");
    __block gboolean ran = FALSE;
    dispatch_async(dispatch_get_main_queue(), ^{ ran = TRUE; });
    spin_gmainloop(300);
    printf("      bare GMainLoop, 300 ms:        block %s\n", ran ? "RAN" : "did NOT run");
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true);
    printf("      after one CFRunLoop drain:     block %s\n", ran ? "RAN" : "did NOT run");
}

// [2] GameController.framework: does it initialise in a non-bundled process, and
// what does it enumerate?
static void probe_gcf(void) {
    printf("[2] GameController.framework:\n");
    for (int i = 0; i < CYCLES; i++) {
        @autoreleasepool {
            if (@available(macOS 11.3, *)) {
                // Without it GCF delivers input only to the FOREGROUND app, and a
                // `gjs` script is never one.
                GCController.shouldMonitorBackgroundEvents = YES;
            }
            __block int notified = 0;
            id token = [[NSNotificationCenter defaultCenter]
                addObserverForName:GCControllerDidConnectNotification
                            object:nil
                             queue:nil
                        usingBlock:^(NSNotification *note) { notified++; }];
            NSUInteger n = [GCController controllers].count;
            spin_gmainloop(10);
            [[NSNotificationCenter defaultCenter] removeObserver:token];
            if (i == 0)
                printf("      controllers: %lu, connect notifications: %d\n", (unsigned long)n, notified);
        }
    }
    printf("      %d observe/enumerate/unobserve cycles: no crash\n", CYCLES);
}

typedef struct {
    int matched;
    int removed;
} HidCounts;

static void hid_matched(void *ctx, IOReturn result, void *sender, IOHIDDeviceRef device) {
    ((HidCounts *)ctx)->matched++;
}

static void hid_removed(void *ctx, IOReturn result, void *sender, IOHIDDeviceRef device) {
    ((HidCounts *)ctx)->removed++;
}

static CFDictionaryRef hid_usage(uint32_t page, uint32_t usage) {
    CFNumberRef p = CFNumberCreate(NULL, kCFNumberSInt32Type, &page);
    CFNumberRef u = CFNumberCreate(NULL, kCFNumberSInt32Type, &usage);
    const void *keys[] = {CFSTR(kIOHIDDeviceUsagePageKey), CFSTR(kIOHIDDeviceUsageKey)};
    const void *vals[] = {p, u};
    CFDictionaryRef d = CFDictionaryCreate(NULL, keys, vals, 2, &kCFTypeDictionaryKeyCallBacks,
                                           &kCFTypeDictionaryValueCallBacks);
    CFRelease(p);
    CFRelease(u);
    return d;
}

// [3] IOKit HID, scheduled on a PRIVATE dispatch queue instead of a run loop —
// the one Apple input path that needs neither a CFRunLoop drain nor a
// foreground app. Same usages WebKit's HIDGamepadProvider and SDL match.
static void probe_iokit(void) {
    printf("[3] IOKit HID (IOHIDManager on a private dispatch queue):\n");
    for (int i = 0; i < CYCLES; i++) {
        HidCounts counts = {0, 0};
        IOHIDManagerRef mgr = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
        CFDictionaryRef m[] = {
            hid_usage(kHIDPage_GenericDesktop, kHIDUsage_GD_Joystick),
            hid_usage(kHIDPage_GenericDesktop, kHIDUsage_GD_GamePad),
            hid_usage(kHIDPage_GenericDesktop, kHIDUsage_GD_MultiAxisController),
        };
        CFArrayRef matching = CFArrayCreate(NULL, (const void **)m, 3, &kCFTypeArrayCallBacks);
        for (int k = 0; k < 3; k++) CFRelease(m[k]);
        IOHIDManagerSetDeviceMatchingMultiple(mgr, matching);
        CFRelease(matching);
        IOHIDManagerRegisterDeviceMatchingCallback(mgr, hid_matched, &counts);
        IOHIDManagerRegisterDeviceRemovalCallback(mgr, hid_removed, &counts);

        dispatch_queue_t q = dispatch_queue_create("gjsify.gamepad.probe", DISPATCH_QUEUE_SERIAL);
        IOHIDManagerSetDispatchQueue(mgr, q);
        dispatch_semaphore_t cancelled = dispatch_semaphore_create(0);
        IOHIDManagerSetCancelHandler(mgr, ^{ dispatch_semaphore_signal(cancelled); });
        IOReturn open = IOHIDManagerOpen(mgr, kIOHIDOptionsTypeNone);
        IOHIDManagerActivate(mgr);

        // Initial enumeration arrives as matching callbacks ON THE QUEUE, so give
        // it time under the loop GJS runs; nothing here drains a CFRunLoop.
        spin_gmainloop(i == 0 ? 300 : 5);
        CFSetRef devices = IOHIDManagerCopyDevices(mgr);
        CFIndex n = devices ? CFSetGetCount(devices) : 0;
        if (devices) CFRelease(devices);

        IOHIDManagerCancel(mgr);
        long waited = dispatch_semaphore_wait(cancelled, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC));
        IOHIDManagerClose(mgr, kIOHIDOptionsTypeNone);
        CFRelease(mgr);
        if (i == 0)
            printf("      open: 0x%08x (%s), devices: %ld, matched: %d, cancel handler %s\n", open,
                   open == kIOReturnSuccess ? "success" : "FAILED", (long)n, counts.matched,
                   waited == 0 ? "ran" : "TIMED OUT");
    }
    printf("      %d create/open/activate/cancel/close cycles: no crash\n", CYCLES);
}

// [4] SDL3 — the library that already combines GCF, IOKit HID and per-vendor
// HIDAPI drivers behind one gamepad API with the standard layout.
static void probe_sdl3(void) {
    printf("[4] SDL3 %d.%d.%d gamepad subsystem:\n", SDL_VERSIONNUM_MAJOR(SDL_GetVersion()),
           SDL_VERSIONNUM_MINOR(SDL_GetVersion()), SDL_VERSIONNUM_MICRO(SDL_GetVersion()));
    SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
    for (int i = 0; i < CYCLES; i++) {
        gint64 t0 = g_get_monotonic_time();
        bool ok = SDL_Init(SDL_INIT_GAMEPAD);
        gint64 t1 = g_get_monotonic_time();
        int n = -1;
        SDL_JoystickID *ids = ok ? SDL_GetGamepads(&n) : NULL;
        SDL_free(ids);
        // Driven the way the shim would drive it: SDL_UpdateGamepads() from a
        // GLib timeout, never an SDL event loop.
        for (int k = 0; k < 3; k++) {
            SDL_UpdateGamepads();
            spin_gmainloop(5);
        }
        SDL_QuitSubSystem(SDL_INIT_GAMEPAD);
        SDL_Quit();
        if (i == 0)
            printf("      SDL_Init(GAMEPAD): %s (%.1f ms), gamepads: %d%s%s\n", ok ? "ok" : "FAILED",
                   (t1 - t0) / 1000.0, n, ok ? "" : " — ", ok ? "" : SDL_GetError());
    }
    printf("      %d init/enumerate/update/quit cycles: no crash\n", CYCLES);
}

int main(int argc, char **argv) {
    const char *mode = argc > 1 ? argv[1] : "all";
    gboolean all = strcmp(mode, "all") == 0;
    printf("process: non-bundled CLI (no .app, no NSApplication), GMainLoop-driven\n");
    if (all || strcmp(mode, "queue") == 0) probe_main_queue();
    if (all || strcmp(mode, "gcf") == 0) probe_gcf();
    if (all || strcmp(mode, "iokit") == 0) probe_iokit();
    if (all || strcmp(mode, "sdl3") == 0) probe_sdl3();
    return 0;
}
