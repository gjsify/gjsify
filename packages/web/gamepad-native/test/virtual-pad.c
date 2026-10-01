/* A VIRTUAL PAD THAT COSTS NOBODY ANYTHING: SDL's own.
 *
 * `uinput-pad` (Linux) and the ViGEm leg (win32) both ask the operating system
 * for a real device, because that is the only way to prove the shim reads one
 * that arrives and departs on its own. Both of those ask a lot:
 *
 *   · uinput needs /dev/uinput, so a privileged container, and a host with no
 *     other controller plugged in for the test to be unambiguous;
 *   · ViGEm needs a third-party kernel driver, installed per run — and on a
 *     hosted Windows runner it cannot work at all. `windows-2022` is Windows
 *     SERVER 2022, and the pinned vgamepad 0.1.0 sdist carries ViGEmBus
 *     1.17.333: the bus opens, the driver answers `vigem_target_add`, and the
 *     virtual device is then never enumerated by the OS
 *     (VIGEM_ERROR_TARGET_NOT_PLUGGED_IN, 0xE0000007 — the same driver on the
 *     same OS family is upstream issue nefarius/ViGEmBus#85, repo archived).
 *     A PR cannot be merged against a driver the runner's OS will not run, so
 *     that leg skips itself there and this one carries the measurement.
 *
 * SDL attaches a virtual joystick in-process, with no kernel driver, no
 * privilege, no device tree and no hardware. It is deterministic, it runs on
 * every OS this shim builds for, and it costs a CI runner nothing.
 *
 * WHAT THIS DOES NOT COVER, because a test that overstates itself is worse than
 * one that is small: a virtual device is added through SDL_PrivateJoystickAdded
 * and therefore never travels RegisterDeviceNotification / WM_DEVICECHANGE. It
 * cannot say that the shim sees a pad the *system* announces. That question
 * stays with uinput on Linux and with ViGEm on a Windows client OS; see
 * test/win32-message-queue.c for the Windows half of the same caveat.
 *
 * It does answer the question the shim owns: that a pad appearing and leaving
 * on its own reaches the monitor through update() ALONE, on a thread that pumps
 * no queue of its own, and that its buttons and axes are the W3C values the
 * TypeScript side reads.
 */

#include <gjsify-gamepad.h>

#include <SDL3/SDL.h>

#include <stdio.h>

#define WAIT_MS 5000

/* An xpad-shaped pad, so the shim's W3C mapping has the usual 11 buttons and 4
 * sticks to read. The identity matters only to the printed name — the mapping
 * comes from the masks below, not from the vendor id. */
static const SDL_VirtualJoystickDesc pad_desc = {
    .version = sizeof(SDL_VirtualJoystickDesc),
    /* Both of these decide whether the device is a GAMEPAD or a plain joystick,
     * and the shim enumerates gamepads only (src/c/gjsify-gamepad.c:411, via
     * SDL_GetGamepads). Without the type, VIRTUAL_JoystickGetGamepadMapping
     * returns false, SDL_OpenGamepad returns NULL, and the shim enumerates
     * nothing at all — a test that then asserts "0 devices" would pass while
     * measuring nothing. The masks are what give each W3C button and axis a
     * physical input to come from. */
    .type = SDL_JOYSTICK_TYPE_GAMEPAD,
    .vendor_id = 0x045e,
    .product_id = 0x028e,
    .nbuttons = SDL_GAMEPAD_BUTTON_COUNT,
    .naxes = SDL_GAMEPAD_AXIS_COUNT,
    .button_mask = (1u << SDL_GAMEPAD_BUTTON_COUNT) - 1,
    .axis_mask = (1u << SDL_GAMEPAD_AXIS_COUNT) - 1,
    .name = "Microsoft X-Box 360 pad (virtual)",
};

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

typedef gboolean (*Condition)(Seen *seen);

/* Pump the shim until @done holds. A fixed number of updates would be a race:
 * SDL notices the new device on its own schedule, and only update() is allowed
 * to be what notices it. */
static gboolean pump_until(GjsifyGamepadMonitor *monitor, Seen *seen, Condition done)
{
    gint64 deadline = g_get_monotonic_time() + WAIT_MS * 1000;
    while (g_get_monotonic_time() < deadline) {
        gjsify_gamepad_monitor_update(monitor);
        if (done(seen))
            return TRUE;
        g_usleep(10 * 1000);
    }
    return FALSE;
}

static gboolean is_connected(Seen *seen) { return seen->added == 1; }
static gboolean is_disconnected(Seen *seen) { return seen->removed == 1; }

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

static gboolean south_pressed(Seen *seen) { return button(seen, 0) == 1.0; }
static gboolean south_released(Seen *seen) { return button(seen, 0) == 0.0; }
static gboolean left_x_right(Seen *seen) { return axis(seen, 0) > 0.99; }
static gboolean left_x_centred(Seen *seen) { return axis(seen, 0) < 0.01; }

/* A device count is the one thing this file must never assume: the other tests
 * in this directory assert ZERO devices, so this runs serialized (meson:
 * is_parallel: false) and asserts the zero it expects to find on the way in. */
static guint device_count(void)
{
    GjsifyGamepadMonitor *scratch = gjsify_gamepad_monitor_new(NULL);
    g_assert_nonnull(scratch);
    gjsify_gamepad_monitor_update(scratch);
    GPtrArray *devices = gjsify_gamepad_monitor_get_devices(scratch);
    guint n = devices->len;
    g_ptr_array_unref(devices);
    g_object_unref(scratch);
    return n;
}

int main(void)
{
    g_assert_cmpuint(device_count(), ==, 0);

    GError *error = NULL;
    GjsifyGamepadMonitor *monitor = gjsify_gamepad_monitor_new(&error);
    g_assert_no_error(error);
    Seen seen = { 0 };
    g_signal_connect(monitor, "device-added", G_CALLBACK(on_added), &seen);
    g_signal_connect(monitor, "device-removed", G_CALLBACK(on_removed), &seen);

    SDL_JoystickID id = SDL_AttachVirtualJoystick(&pad_desc);
    if (id == 0)
        g_error("SDL_AttachVirtualJoystick failed: %s", SDL_GetError());
    SDL_Joystick *pad = SDL_OpenJoystick(id);
    if (pad == NULL)
        g_error("SDL_OpenJoystick on the virtual pad failed: %s", SDL_GetError());

    if (!pump_until(monitor, &seen, is_connected))
        g_error("the virtual pad never reached the shim within %d ms (device-added: %u)", WAIT_MS, seen.added);
    g_print("connected: \"%s\" %04x:%04x\n", gjsify_gamepad_device_get_name(seen.device),
            gjsify_gamepad_device_get_vendor(seen.device), gjsify_gamepad_device_get_product(seen.device));
    g_assert_true(gjsify_gamepad_device_is_connected(seen.device));
    /* The device keeps a reference of its own from here on: the detach below
     * must leave it readable, not dangling. */
    GjsifyGamepadDevice *device = g_object_ref(seen.device);

    if (!SDL_SetJoystickVirtualButton(pad, SDL_GAMEPAD_BUTTON_SOUTH, true))
        g_error("SDL_SetJoystickVirtualButton: %s", SDL_GetError());
    if (!pump_until(monitor, &seen, south_pressed))
        g_error("SOUTH never showed up as W3C button 0 (got %f)", button(&seen, 0));
    g_print("button 0 (south) pressed: 1\n");

    if (!SDL_SetJoystickVirtualAxis(pad, SDL_GAMEPAD_AXIS_LEFTX, 32767))
        g_error("SDL_SetJoystickVirtualAxis: %s", SDL_GetError());
    if (!pump_until(monitor, &seen, left_x_right))
        g_error("LEFTX=max never showed up as W3C axis 0 = +1 (got %f)", axis(&seen, 0));
    g_print("axis 0 (left x): %.3f\n", axis(&seen, 0));

    if (!SDL_SetJoystickVirtualButton(pad, SDL_GAMEPAD_BUTTON_SOUTH, false))
        g_error("SDL_SetJoystickVirtualButton (release): %s", SDL_GetError());
    if (!pump_until(monitor, &seen, south_released))
        g_error("releasing SOUTH never cleared W3C button 0 (got %f)", button(&seen, 0));
    g_print("button 0 (south) released: 0\n");

    if (!SDL_SetJoystickVirtualAxis(pad, SDL_GAMEPAD_AXIS_LEFTX, 0))
        g_error("SDL_SetJoystickVirtualAxis (centre): %s", SDL_GetError());
    if (!pump_until(monitor, &seen, left_x_centred))
        g_error("centring LEFTX never showed up as W3C axis 0 = 0 (got %f)", axis(&seen, 0));
    g_print("axis 0 (left x) centred: %.3f\n", axis(&seen, 0));

    SDL_CloseJoystick(pad);
    if (!SDL_DetachVirtualJoystick(id))
        g_error("SDL_DetachVirtualJoystick: %s", SDL_GetError());
    if (!pump_until(monitor, &seen, is_disconnected))
        g_error("the virtual pad never left the shim within %d ms (device-removed: %u)", WAIT_MS, seen.removed);
    g_print("disconnected: %u added, %u removed\n", seen.added, seen.removed);

    /* The shim's own contract after a disconnect: the device is still readable
     * and reads as gone rather than as a freed pointer. */
    g_assert_false(gjsify_gamepad_device_is_connected(device));
    g_assert_cmpfloat(button(&seen, 0), ==, 0.0);
    g_assert_cmpfloat(axis(&seen, 0), ==, 0.0);

    g_object_unref(device);
    g_object_unref(monitor);
    g_print("virtual-pad: OK\n");
    return 0;
}
