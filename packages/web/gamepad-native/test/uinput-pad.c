/* A virtual controller through the kernel's uinput, read back through the shim —
 * the input path end to end on a host with no controller: kernel evdev device →
 * udev (or SDL's inotify fallback) → SDL's Linux joystick driver → SDL's gamepad
 * mapping → the shim's W3C snapshot. No fake anywhere in that chain.
 *
 * The device claims to be an Xbox 360 pad (045e:028e) with xpad's exact button
 * and axis set, so SDL maps it from its built-in gamecontrollerdb row rather than
 * a guess. It has no hidraw node, so SDL's HIDAPI driver does not claim it and
 * the evdev driver (the one every non-HIDAPI Linux controller uses) does.
 *
 * Two modes:
 *   uinput-pad            the meson test: connect, press A, deflect the left
 *                         stick, pull the left trigger, release, disconnect —
 *                         each asserted through the shim. Exit 77 (meson: SKIP)
 *                         when /dev/uinput cannot be opened, unless
 *                         GJSIFY_GAMEPAD_REQUIRE_UINPUT=1 makes that a failure
 *                         (CI sets it where the device is provisioned).
 *   uinput-pad --serve    no shim: create the device and apply commands read
 *                         from stdin (`press <code>`, `release <code>`,
 *                         `abs <code> <value>`, `quit`), for driving the JS
 *                         sources (SDL and Manette side by side) against one
 *                         device. Prints `ready` once the device exists. */

#include <gjsify-gamepad.h>

#include <errno.h>
#include <fcntl.h>
#include <linux/uinput.h>
#include <sys/ioctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define SKIP 77
#define WAIT_MS 5000

static const int pad_buttons[] = {
    BTN_A, BTN_B, BTN_X, BTN_Y, BTN_TL, BTN_TR, BTN_SELECT, BTN_START, BTN_MODE, BTN_THUMBL, BTN_THUMBR,
};

struct pad_axis {
    int code, min, max;
};

static const struct pad_axis pad_axes[] = {
    { ABS_X, -32768, 32767 }, { ABS_Y, -32768, 32767 }, { ABS_Z, 0, 255 },
    { ABS_RX, -32768, 32767 }, { ABS_RY, -32768, 32767 }, { ABS_RZ, 0, 255 },
    { ABS_HAT0X, -1, 1 }, { ABS_HAT0Y, -1, 1 },
};

static void emit(int fd, int type, int code, int value)
{
    struct input_event ev;
    memset(&ev, 0, sizeof ev);
    ev.type = (unsigned short) type;
    ev.code = (unsigned short) code;
    ev.value = value;
    if (write(fd, &ev, sizeof ev) != (ssize_t) sizeof ev)
        g_error("uinput write: %s", g_strerror(errno));
}

static void sync_report(int fd)
{
    emit(fd, EV_SYN, SYN_REPORT, 0);
}

/* Returns the uinput fd, or -1 with errno set when /dev/uinput is unusable. */
static int pad_create(void)
{
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0)
        return -1;

    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_EVBIT, EV_ABS);
    for (gsize i = 0; i < G_N_ELEMENTS(pad_buttons); i++)
        ioctl(fd, UI_SET_KEYBIT, pad_buttons[i]);

    for (gsize i = 0; i < G_N_ELEMENTS(pad_axes); i++) {
        struct uinput_abs_setup abs;
        memset(&abs, 0, sizeof abs);
        abs.code = (unsigned short) pad_axes[i].code;
        abs.absinfo.minimum = pad_axes[i].min;
        abs.absinfo.maximum = pad_axes[i].max;
        ioctl(fd, UI_SET_ABSBIT, pad_axes[i].code);
        if (ioctl(fd, UI_ABS_SETUP, &abs) < 0)
            g_error("UI_ABS_SETUP: %s", g_strerror(errno));
    }

    struct uinput_setup setup;
    memset(&setup, 0, sizeof setup);
    setup.id.bustype = BUS_USB;
    setup.id.vendor = 0x045e;
    setup.id.product = 0x028e;
    setup.id.version = 0x0114;
    g_strlcpy(setup.name, "Microsoft X-Box 360 pad", sizeof setup.name);
    if (ioctl(fd, UI_DEV_SETUP, &setup) < 0 || ioctl(fd, UI_DEV_CREATE) < 0)
        g_error("uinput device setup: %s", g_strerror(errno));
    return fd;
}

static void pad_destroy(int fd)
{
    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
}

/* ------------------------------------------------------------------------ */

typedef struct {
    GjsifyGamepadDevice *device; /* the one the monitor announced (not owned) */
    guint added;
    guint removed;
} Seen;

static void on_added(GjsifyGamepadMonitor *monitor, GjsifyGamepadDevice *device, gpointer user_data)
{
    (void) monitor;
    Seen *seen = user_data;
    seen->device = device;
    seen->added++;
}

static void on_removed(GjsifyGamepadMonitor *monitor, GjsifyGamepadDevice *device, gpointer user_data)
{
    (void) monitor;
    (void) device;
    ((Seen *) user_data)->removed++;
}

typedef gboolean (*Condition)(GjsifyGamepadMonitor *monitor, Seen *seen);

/* Pump the shim until @done holds — the device appearing takes udev (or inotify)
 * plus SDL's own settle time, so a fixed number of updates would be a race. */
static gboolean pump_until(GjsifyGamepadMonitor *monitor, Seen *seen, Condition done)
{
    gint64 deadline = g_get_monotonic_time() + WAIT_MS * 1000;
    while (g_get_monotonic_time() < deadline) {
        gjsify_gamepad_monitor_update(monitor);
        if (done(monitor, seen))
            return TRUE;
        g_usleep(10 * 1000);
    }
    return FALSE;
}

static gboolean is_connected(GjsifyGamepadMonitor *monitor, Seen *seen)
{
    (void) monitor;
    return seen->added == 1;
}

static gboolean is_disconnected(GjsifyGamepadMonitor *monitor, Seen *seen)
{
    (void) monitor;
    return seen->removed == 1;
}

static gdouble button(Seen *seen, guint index)
{
    gsize n = 0;
    gdouble *values = gjsify_gamepad_device_get_buttons(seen->device, &n);
    g_assert_cmpuint(n, ==, 17);
    gdouble value = values[index];
    g_free(values);
    return value;
}

static gdouble axis(Seen *seen, guint index)
{
    gsize n = 0;
    gdouble *values = gjsify_gamepad_device_get_axes(seen->device, &n);
    g_assert_cmpuint(n, ==, 4);
    gdouble value = values[index];
    g_free(values);
    return value;
}

static gboolean south_pressed(GjsifyGamepadMonitor *m, Seen *s) { (void) m; return button(s, 0) == 1.0; }
static gboolean south_released(GjsifyGamepadMonitor *m, Seen *s) { (void) m; return button(s, 0) == 0.0; }
static gboolean left_x_right(GjsifyGamepadMonitor *m, Seen *s) { (void) m; return axis(s, 0) > 0.99; }
static gboolean left_trigger_full(GjsifyGamepadMonitor *m, Seen *s) { (void) m; return button(s, 6) > 0.99; }

static int run_test(void)
{
    int fd = pad_create();
    if (fd < 0) {
        const gboolean required = g_strcmp0(g_getenv("GJSIFY_GAMEPAD_REQUIRE_UINPUT"), "1") == 0;
        g_printerr("uinput-pad: /dev/uinput: %s%s\n", g_strerror(errno),
                   required ? " — GJSIFY_GAMEPAD_REQUIRE_UINPUT=1, so this is a failure" : " — skipped");
        return required ? 1 : SKIP;
    }

    GError *error = NULL;
    GjsifyGamepadMonitor *monitor = gjsify_gamepad_monitor_new(&error);
    g_assert_no_error(error);
    Seen seen = { 0 };
    g_signal_connect(monitor, "device-added", G_CALLBACK(on_added), &seen);
    g_signal_connect(monitor, "device-removed", G_CALLBACK(on_removed), &seen);

    if (!pump_until(monitor, &seen, is_connected))
        g_error("the virtual pad never reached the shim within %d ms (device-added: %u)", WAIT_MS, seen.added);
    g_print("connected: \"%s\" %04x:%04x guid %s\n", gjsify_gamepad_device_get_name(seen.device),
            gjsify_gamepad_device_get_vendor(seen.device), gjsify_gamepad_device_get_product(seen.device),
            gjsify_gamepad_device_get_guid(seen.device));
    g_assert_cmphex(gjsify_gamepad_device_get_vendor(seen.device), ==, 0x045e);
    g_assert_true(gjsify_gamepad_device_is_connected(seen.device));
    /* The device keeps a reference of its own from here on: the disconnect
     * below must leave it readable (zeroed), not dangling. */
    GjsifyGamepadDevice *device = g_object_ref(seen.device);

    /* BTN_A is the W3C south button, index 0. */
    emit(fd, EV_KEY, BTN_A, 1);
    sync_report(fd);
    if (!pump_until(monitor, &seen, south_pressed))
        g_error("BTN_A never showed up as W3C button 0");
    g_print("button 0 (south) pressed: 1\n");

    /* Full right on ABS_X is W3C axis 0 at +1. */
    emit(fd, EV_ABS, ABS_X, 32767);
    sync_report(fd);
    if (!pump_until(monitor, &seen, left_x_right))
        g_error("ABS_X=max never showed up as W3C axis 0 = +1 (got %f)", axis(&seen, 0));
    g_print("axis 0 (left x): %.3f\n", axis(&seen, 0));

    /* ABS_Z is the left trigger on xpad: an analog W3C button, index 6. */
    emit(fd, EV_ABS, ABS_Z, 255);
    sync_report(fd);
    if (!pump_until(monitor, &seen, left_trigger_full))
        g_error("ABS_Z=max never showed up as W3C button 6 = 1 (got %f)", button(&seen, 6));
    g_print("button 6 (left trigger): %.3f\n", button(&seen, 6));

    emit(fd, EV_KEY, BTN_A, 0);
    sync_report(fd);
    if (!pump_until(monitor, &seen, south_released))
        g_error("releasing BTN_A never cleared W3C button 0");

    pad_destroy(fd);
    if (!pump_until(monitor, &seen, is_disconnected))
        g_error("the virtual pad's removal never reached the shim within %d ms", WAIT_MS);
    g_assert_false(gjsify_gamepad_device_is_connected(device));
    g_assert_cmpfloat(axis(&seen, 0), ==, 0.0);
    g_print("disconnected\n");

    g_object_unref(device);
    gjsify_gamepad_monitor_close(monitor);
    g_object_unref(monitor);
    return 0;
}

/* ------------------------------------------------------------------------ */

static int run_serve(void)
{
    int fd = pad_create();
    if (fd < 0) {
        g_printerr("uinput-pad: /dev/uinput: %s\n", g_strerror(errno));
        return 1;
    }
    printf("ready\n");
    fflush(stdout);

    char line[128];
    while (fgets(line, sizeof line, stdin) != NULL) {
        int code = 0, value = 0;
        if (sscanf(line, "press %i", &code) == 1) {
            emit(fd, EV_KEY, code, 1);
        } else if (sscanf(line, "release %i", &code) == 1) {
            emit(fd, EV_KEY, code, 0);
        } else if (sscanf(line, "abs %i %i", &code, &value) == 2) {
            emit(fd, EV_ABS, code, value);
        } else if (strncmp(line, "quit", 4) == 0) {
            break;
        } else {
            g_printerr("uinput-pad: unknown command: %s", line);
            continue;
        }
        sync_report(fd);
        printf("ok\n");
        fflush(stdout);
    }
    pad_destroy(fd);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc > 1 && strcmp(argv[1], "--serve") == 0)
        return run_serve();
    return run_test();
}
