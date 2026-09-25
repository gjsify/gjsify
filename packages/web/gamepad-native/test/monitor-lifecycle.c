/* The zero-device lifecycle, against the real library and a real SDL — no fake.
 *
 * It asserts what docs/poc/gamepad-darwin-probe.m measured for SDL before the
 * shim existed, now through the shim: a monitor starts, its update pumps
 * without error, it reports no controller on a host that has none, and it
 * closes. Twenty cycles, two monitors at once, and a dispose without close, so
 * `leaks --atExit` (the second meson test) sees every path that releases SDL.
 *
 * A runner has no controller, so "no controller" is asserted, not assumed: a
 * developer running this with one attached gets a clear failure rather than a
 * pass that proved something else. GJSIFY_GAMEPAD_EXPECT_DEVICES overrides the
 * expected count for that case. */

#include <gjsify-gamepad.h>

#define DEFAULT_CYCLES 20

/* GJSIFY_GAMEPAD_CYCLES overrides the count: test/valgrind-growth.py runs 1 and
 * 20 and compares what each leaves reachable. */
static guint cycles(void)
{
    const char *value = g_getenv("GJSIFY_GAMEPAD_CYCLES");
    return value != NULL ? (guint) g_ascii_strtoull(value, NULL, 10) : DEFAULT_CYCLES;
}

static guint expected_devices(void)
{
    const char *value = g_getenv("GJSIFY_GAMEPAD_EXPECT_DEVICES");
    return value != NULL ? (guint) g_ascii_strtoull(value, NULL, 10) : 0;
}

static void pump(GjsifyGamepadMonitor *monitor, guint iterations)
{
    for (guint i = 0; i < iterations; i++) {
        gjsify_gamepad_monitor_update(monitor);
        g_main_context_iteration(NULL, FALSE);
    }
}

static void on_device(GjsifyGamepadMonitor *monitor, GjsifyGamepadDevice *device, gpointer user_data)
{
    (void) monitor;
    (void) device;
    (*(guint *) user_data)++;
}

static void test_cycles(void)
{
    const guint expected = expected_devices();

    for (guint cycle = 0, n = cycles(); cycle < n; cycle++) {
        GError *error = NULL;
        guint added = 0;
        GjsifyGamepadMonitor *monitor = gjsify_gamepad_monitor_new(&error);
        g_assert_no_error(error);
        g_assert_nonnull(monitor);

        g_signal_connect(monitor, "device-added", G_CALLBACK(on_device), &added);
        pump(monitor, 5);

        GPtrArray *devices = gjsify_gamepad_monitor_get_devices(monitor);
        g_assert_cmpuint(devices->len, ==, expected);
        g_assert_cmpuint(added, ==, expected);
        g_ptr_array_unref(devices);

        gjsify_gamepad_monitor_close(monitor);
        /* Idempotent, and a closed monitor's update is a no-op. */
        gjsify_gamepad_monitor_close(monitor);
        gjsify_gamepad_monitor_update(monitor);
        g_object_unref(monitor);
    }
}

/* SDL's subsystem is reference-counted across monitors: closing one must not
 * take SDL away from the other. */
static void test_two_monitors(void)
{
    GError *error = NULL;
    GjsifyGamepadMonitor *first = gjsify_gamepad_monitor_new(&error);
    g_assert_no_error(error);
    GjsifyGamepadMonitor *second = gjsify_gamepad_monitor_new(&error);
    g_assert_no_error(error);

    pump(first, 2);
    gjsify_gamepad_monitor_close(first);
    pump(second, 2);
    GPtrArray *devices = gjsify_gamepad_monitor_get_devices(second);
    g_assert_cmpuint(devices->len, ==, expected_devices());
    g_ptr_array_unref(devices);

    g_object_unref(first);
    g_object_unref(second);
}

/* The GC path: a JS wrapper that is simply dropped never calls close(), so
 * dispose has to release SDL on its own. */
static void test_dispose_without_close(void)
{
    GError *error = NULL;
    GjsifyGamepadMonitor *monitor = gjsify_gamepad_monitor_new(&error);
    g_assert_no_error(error);
    pump(monitor, 2);
    g_object_unref(monitor);
}

int main(int argc, char **argv)
{
    g_test_init(&argc, &argv, NULL);
    g_test_add_func("/gamepad/monitor/cycles", test_cycles);
    g_test_add_func("/gamepad/monitor/two-monitors", test_two_monitors);
    g_test_add_func("/gamepad/monitor/dispose-without-close", test_dispose_without_close);
    return g_test_run();
}
