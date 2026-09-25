/* THE WIN32 MESSAGE-PUMP QUESTION, measured rather than assumed.
 *
 * A GLib main loop on Windows does not run a Windows message loop: it waits on
 * its own handles and dispatches a thread's window messages only when someone
 * has added a G_WIN32_MSG_HANDLE poll (GTK's GDK does; GJS-less Node with
 * node-gi does not). So if SDL needed the CALLING thread's queue pumped — a
 * window it created there that has to see WM_DEVICECHANGE, WM_INPUT or a COM
 * callback — nothing in a GLib-driven process would ever pump it, and hotplug
 * or input would silently stop.
 *
 * What SDL 3.4 does, read from its source: SDL_Init(JOYSTICK|HAPTIC) creates
 * `SDL_HelperWindow` on the calling thread — a message-only window with
 * DefWindowProc, used as DirectInput's cooperative-level HWND — and the joystick
 * driver starts its own thread (SDL_HINT_JOYSTICK_THREAD, default on) with its
 * own message window, RegisterDeviceNotification and GetMessage loop, which is
 * where WM_DEVICECHANGE and raw-input notifications go. XInput and HIDAPI are
 * polled from SDL_UpdateGamepads().
 *
 * This test turns that reading into numbers, on the thread that calls the shim
 * and never pumps (exactly the GLib shape):
 *
 *   1. the windows the shim leaves on this thread, by class name;
 *   2. the threads it adds to the process;
 *   3. how many messages pile up in this thread's queue across 2 s of
 *      gjsify_gamepad_monitor_update() with no pump — then drained and counted.
 *
 * With GJSIFY_GAMEPAD_EXPECT_VIRTUAL_PAD=1 (the CI step that installs a virtual
 * XInput pad holding A and the left stick right) it also asserts that pad
 * connects and reads correctly through the same never-pumped thread, and that
 * its removal arrives. */

#include <gjsify-gamepad.h>

#include <windows.h>
#include <tlhelp32.h>

#define SETTLE_MS 2000
#define DEVICE_WAIT_MS 30000

static BOOL CALLBACK list_window(HWND hwnd, LPARAM lparam)
{
    char klass[128] = { 0 };
    GetClassNameA(hwnd, klass, sizeof klass);
    g_print("    window %p class \"%s\" (top-level)\n", (void *) hwnd, klass);
    (*(guint *) lparam)++;
    return TRUE;
}

/* Message-only windows are not reached by EnumThreadWindows, which walks
 * top-level windows only; FindWindowEx(HWND_MESSAGE, …) walks them. */
static guint count_windows_on_this_thread(void)
{
    guint n = 0;
    EnumThreadWindows(GetCurrentThreadId(), list_window, (LPARAM) &n);
    DWORD me = GetCurrentThreadId();
    for (HWND hwnd = FindWindowExA(HWND_MESSAGE, NULL, NULL, NULL); hwnd != NULL;
         hwnd = FindWindowExA(HWND_MESSAGE, hwnd, NULL, NULL)) {
        if (GetWindowThreadProcessId(hwnd, NULL) != me)
            continue;
        char klass[128] = { 0 };
        GetClassNameA(hwnd, klass, sizeof klass);
        g_print("    window %p class \"%s\" (message-only)\n", (void *) hwnd, klass);
        n++;
    }
    return n;
}

static guint count_threads_in_process(void)
{
    guint n = 0;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    THREADENTRY32 entry = { .dwSize = sizeof entry };
    if (snap == INVALID_HANDLE_VALUE)
        return 0;
    for (BOOL ok = Thread32First(snap, &entry); ok; ok = Thread32Next(snap, &entry)) {
        if (entry.th32OwnerProcessID == GetCurrentProcessId())
            n++;
    }
    CloseHandle(snap);
    return n;
}

/* Removes and counts what is queued for this thread. Called only AFTER the
 * measurement window, so the count is what accumulated while nobody pumped. */
static guint drain_queue(void)
{
    MSG msg;
    guint n = 0;
    while (PeekMessageA(&msg, NULL, 0, 0, PM_REMOVE)) {
        g_print("    queued: msg 0x%04x to %p\n", msg.message, (void *) msg.hwnd);
        n++;
    }
    return n;
}

typedef struct {
    GjsifyGamepadDevice *device;
    guint added, removed;
} Seen;

static void on_added(GjsifyGamepadMonitor *m, GjsifyGamepadDevice *d, gpointer p)
{
    (void) m;
    ((Seen *) p)->device = d;
    ((Seen *) p)->added++;
}

static void on_removed(GjsifyGamepadMonitor *m, GjsifyGamepadDevice *d, gpointer p)
{
    (void) m;
    (void) d;
    ((Seen *) p)->removed++;
}

static gdouble value_at(gdouble *(*get)(GjsifyGamepadDevice *, gsize *), GjsifyGamepadDevice *d, guint i)
{
    gsize n = 0;
    gdouble *values = get(d, &n);
    gdouble v = i < n ? values[i] : -1;
    g_free(values);
    return v;
}

/* Updates the shim — and ONLY the shim, never this thread's queue — until the
 * condition holds or the deadline passes. */
static gboolean update_until(GjsifyGamepadMonitor *monitor, Seen *seen, gboolean (*done)(Seen *), guint ms)
{
    ULONGLONG deadline = GetTickCount64() + ms;
    while (GetTickCount64() < deadline) {
        gjsify_gamepad_monitor_update(monitor);
        if (done != NULL && done(seen))
            return TRUE;
        Sleep(10);
    }
    return done == NULL;
}

static gboolean pad_ready(Seen *s)
{
    return s->added >= 1 && value_at(gjsify_gamepad_device_get_buttons, s->device, 0) == 1.0 &&
           value_at(gjsify_gamepad_device_get_axes, s->device, 0) > 0.99;
}

static gboolean pad_gone(Seen *s)
{
    return s->removed >= 1;
}

int main(void)
{
    const gboolean expect_pad = g_strcmp0(g_getenv("GJSIFY_GAMEPAD_EXPECT_VIRTUAL_PAD"), "1") == 0;

    g_print("before the monitor:\n");
    guint windows_before = count_windows_on_this_thread();
    guint threads_before = count_threads_in_process();
    g_print("  windows on this thread: %u, threads in process: %u\n", windows_before, threads_before);

    GError *error = NULL;
    GjsifyGamepadMonitor *monitor = gjsify_gamepad_monitor_new(&error);
    g_assert_no_error(error);
    Seen seen = { 0 };
    g_signal_connect(monitor, "device-added", G_CALLBACK(on_added), &seen);
    g_signal_connect(monitor, "device-removed", G_CALLBACK(on_removed), &seen);

    update_until(monitor, &seen, NULL, SETTLE_MS);

    g_print("after %d ms of update() with no message pump on this thread:\n", SETTLE_MS);
    guint windows_after = count_windows_on_this_thread();
    guint threads_after = count_threads_in_process();
    DWORD status = GetQueueStatus(QS_ALLINPUT);
    guint queued = drain_queue();
    g_print("  windows on this thread: %u (+%d), threads in process: %u (+%d)\n", windows_after,
            (int) windows_after - (int) windows_before, threads_after, (int) threads_after - (int) threads_before);
    g_print("  GetQueueStatus(QS_ALLINPUT): 0x%08lx; messages that accumulated: %u\n", status, queued);
    g_print("  devices: %u\n", seen.added);

    int rc = 0;
    if (queued != 0) {
        g_printerr("FAIL: %u message(s) piled up on a thread that never pumps — in a GLib-driven process "
                   "nobody would ever dispatch them\n", queued);
        rc = 1;
    }

    if (expect_pad) {
        if (!update_until(monitor, &seen, pad_ready, DEVICE_WAIT_MS)) {
            g_printerr("FAIL: the virtual pad did not connect with A held and the left stick right "
                       "within %d ms (added %u)\n", DEVICE_WAIT_MS, seen.added);
            rc = 1;
        } else {
            g_print("virtual pad: \"%s\" %04x:%04x — button 0 = %.0f, axis 0 = %.3f, read with no pump\n",
                    gjsify_gamepad_device_get_name(seen.device), gjsify_gamepad_device_get_vendor(seen.device),
                    gjsify_gamepad_device_get_product(seen.device),
                    value_at(gjsify_gamepad_device_get_buttons, seen.device, 0),
                    value_at(gjsify_gamepad_device_get_axes, seen.device, 0));
            /* The pad's owner exits on its own; its removal must arrive the
             * same way — through update() alone. */
            if (!update_until(monitor, &seen, pad_gone, DEVICE_WAIT_MS)) {
                g_printerr("FAIL: the virtual pad's removal never arrived within %d ms\n", DEVICE_WAIT_MS);
                rc = 1;
            } else {
                g_print("virtual pad removed, seen through update() alone\n");
            }
            guint late = drain_queue();
            g_print("  messages that accumulated during the device's life: %u\n", late);
            if (late != 0)
                rc = 1;
        }
    } else if (seen.added != 0) {
        g_printerr("FAIL: %u device(s) on a runner that should have none\n", seen.added);
        rc = 1;
    }

    gjsify_gamepad_monitor_close(monitor);
    g_object_unref(monitor);
    return rc;
}
