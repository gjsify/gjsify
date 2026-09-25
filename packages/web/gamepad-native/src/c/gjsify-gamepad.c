/* GjsifyGamepad — implementation. The API contract, with every annotation, is
 * in gjsify-gamepad.h; this file explains only what the header cannot. */

#include "gjsify-gamepad.h"

#include <SDL3/SDL.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

/* Low enough to cost nothing idle, high enough that `gamepadconnected` reaches a
 * page that has not polled yet within a tenth of a second. A page that DOES poll
 * is served by the update its getGamepads() runs, not by this timer. */
#define GJSIFY_GAMEPAD_UPDATE_INTERVAL_MS 100

#define W3C_BUTTON_COUNT 17
#define W3C_AXIS_COUNT 4

G_DEFINE_QUARK(gjsify-gamepad-monitor-error-quark, gjsify_gamepad_monitor_error)

/* W3C standard button index → SDL button. SDL's face buttons are POSITIONAL
 * (south/east/west/north), which is exactly what the W3C layout means by
 * buttons 0–3, so a Nintendo layout needs no special case here. -1 marks the
 * two analog triggers, which SDL reports as axes. */
static const SDL_GamepadButton w3c_buttons[W3C_BUTTON_COUNT] = {
    SDL_GAMEPAD_BUTTON_SOUTH,          SDL_GAMEPAD_BUTTON_EAST,
    SDL_GAMEPAD_BUTTON_WEST,           SDL_GAMEPAD_BUTTON_NORTH,
    SDL_GAMEPAD_BUTTON_LEFT_SHOULDER,  SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER,
    (SDL_GamepadButton) -1,            (SDL_GamepadButton) -1,
    SDL_GAMEPAD_BUTTON_BACK,           SDL_GAMEPAD_BUTTON_START,
    SDL_GAMEPAD_BUTTON_LEFT_STICK,     SDL_GAMEPAD_BUTTON_RIGHT_STICK,
    SDL_GAMEPAD_BUTTON_DPAD_UP,        SDL_GAMEPAD_BUTTON_DPAD_DOWN,
    SDL_GAMEPAD_BUTTON_DPAD_LEFT,      SDL_GAMEPAD_BUTTON_DPAD_RIGHT,
    SDL_GAMEPAD_BUTTON_GUIDE,
};

static const SDL_GamepadAxis w3c_axes[W3C_AXIS_COUNT] = {
    SDL_GAMEPAD_AXIS_LEFTX,
    SDL_GAMEPAD_AXIS_LEFTY,
    SDL_GAMEPAD_AXIS_RIGHTX,
    SDL_GAMEPAD_AXIS_RIGHTY,
};

/* SDL's axis range is asymmetric (-32768..32767); dividing by the positive end
 * and clamping keeps full deflection at exactly ±1 in both directions. */
static gdouble axis_to_unit(Sint16 value)
{
    return CLAMP((gdouble) value / 32767.0, -1.0, 1.0);
}

/* ==========================================================================
 * GjsifyGamepadDevice
 * ========================================================================== */

struct _GjsifyGamepadDevice {
    GObject parent_instance;
    SDL_JoystickID id;
    SDL_Gamepad *gamepad; /* NULL once disconnected */
    gchar *name;
    gchar *guid;
    guint16 vendor;
    guint16 product;
};

G_DEFINE_FINAL_TYPE(GjsifyGamepadDevice, gjsify_gamepad_device, G_TYPE_OBJECT)

/* Closes the SDL handle and marks the device disconnected. The object may
 * outlive this in JS, so every getter handles the NULL handle. */
static void gjsify_gamepad_device_release(GjsifyGamepadDevice *self)
{
    g_clear_pointer(&self->gamepad, SDL_CloseGamepad);
}

static void gjsify_gamepad_device_finalize(GObject *object)
{
    GjsifyGamepadDevice *self = GJSIFY_GAMEPAD_DEVICE(object);
    gjsify_gamepad_device_release(self);
    g_free(self->name);
    g_free(self->guid);
    G_OBJECT_CLASS(gjsify_gamepad_device_parent_class)->finalize(object);
}

static void gjsify_gamepad_device_class_init(GjsifyGamepadDeviceClass *klass)
{
    G_OBJECT_CLASS(klass)->finalize = gjsify_gamepad_device_finalize;
}

static void gjsify_gamepad_device_init(GjsifyGamepadDevice *self)
{
    (void) self;
}

/* Takes ownership of @gamepad. */
static GjsifyGamepadDevice *gjsify_gamepad_device_new(SDL_JoystickID id, SDL_Gamepad *gamepad)
{
    GjsifyGamepadDevice *self = g_object_new(GJSIFY_GAMEPAD_TYPE_DEVICE, NULL);
    char guid[33];

    self->id = id;
    self->gamepad = gamepad;
    const char *name = SDL_GetGamepadName(gamepad);
    self->name = g_strdup(name != NULL ? name : "Gamepad");
    SDL_GUIDToString(SDL_GetGamepadGUIDForID(id), guid, sizeof guid);
    self->guid = g_strdup(guid);
    self->vendor = SDL_GetGamepadVendor(gamepad);
    self->product = SDL_GetGamepadProduct(gamepad);
    return self;
}

const gchar *gjsify_gamepad_device_get_name(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), NULL);
    return self->name;
}

const gchar *gjsify_gamepad_device_get_guid(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), NULL);
    return self->guid;
}

guint16 gjsify_gamepad_device_get_vendor(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), 0);
    return self->vendor;
}

guint16 gjsify_gamepad_device_get_product(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), 0);
    return self->product;
}

gboolean gjsify_gamepad_device_is_connected(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    return self->gamepad != NULL;
}

gdouble *gjsify_gamepad_device_get_buttons(GjsifyGamepadDevice *self, gsize *n_buttons)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), NULL);
    gdouble *values = g_new0(gdouble, W3C_BUTTON_COUNT);
    *n_buttons = W3C_BUTTON_COUNT;
    if (self->gamepad == NULL)
        return values;

    for (guint i = 0; i < W3C_BUTTON_COUNT; i++) {
        if (w3c_buttons[i] != (SDL_GamepadButton) -1)
            values[i] = SDL_GetGamepadButton(self->gamepad, w3c_buttons[i]) ? 1.0 : 0.0;
    }
    /* Triggers rest at 0 and reach 32767; SDL documents no negative values for
     * them, and MAX() keeps a driver that reports one from producing a W3C
     * value below the spec's 0..1. */
    values[6] = MAX(0.0, axis_to_unit(SDL_GetGamepadAxis(self->gamepad, SDL_GAMEPAD_AXIS_LEFT_TRIGGER)));
    values[7] = MAX(0.0, axis_to_unit(SDL_GetGamepadAxis(self->gamepad, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER)));
    return values;
}

gdouble *gjsify_gamepad_device_get_axes(GjsifyGamepadDevice *self, gsize *n_axes)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), NULL);
    gdouble *values = g_new0(gdouble, W3C_AXIS_COUNT);
    *n_axes = W3C_AXIS_COUNT;
    if (self->gamepad == NULL)
        return values;

    for (guint i = 0; i < W3C_AXIS_COUNT; i++)
        values[i] = axis_to_unit(SDL_GetGamepadAxis(self->gamepad, w3c_axes[i]));
    return values;
}

static gboolean gjsify_gamepad_device_has_capability(GjsifyGamepadDevice *self, const char *property)
{
    if (self->gamepad == NULL)
        return FALSE;
    return SDL_GetBooleanProperty(SDL_GetGamepadProperties(self->gamepad), property, false);
}

gboolean gjsify_gamepad_device_has_rumble(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    return gjsify_gamepad_device_has_capability(self, SDL_PROP_GAMEPAD_CAP_RUMBLE_BOOLEAN);
}

gboolean gjsify_gamepad_device_has_trigger_rumble(GjsifyGamepadDevice *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    return gjsify_gamepad_device_has_capability(self, SDL_PROP_GAMEPAD_CAP_TRIGGER_RUMBLE_BOOLEAN);
}

gboolean gjsify_gamepad_device_rumble(GjsifyGamepadDevice *self,
                                      guint16 low_frequency,
                                      guint16 high_frequency,
                                      guint32 duration_ms)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    if (self->gamepad == NULL)
        return FALSE;
    return SDL_RumbleGamepad(self->gamepad, low_frequency, high_frequency, duration_ms);
}

gboolean gjsify_gamepad_device_rumble_triggers(GjsifyGamepadDevice *self,
                                               guint16 left,
                                               guint16 right,
                                               guint32 duration_ms)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    if (self->gamepad == NULL)
        return FALSE;
    return SDL_RumbleGamepadTriggers(self->gamepad, left, right, duration_ms);
}

gboolean gjsify_gamepad_device_has_sensor(GjsifyGamepadDevice *self, GjsifyGamepadSensor sensor)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    if (self->gamepad == NULL)
        return FALSE;
    return SDL_GamepadHasSensor(self->gamepad, (SDL_SensorType) sensor);
}

gboolean gjsify_gamepad_device_set_sensor_enabled(GjsifyGamepadDevice *self,
                                                  GjsifyGamepadSensor sensor,
                                                  gboolean enabled)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    if (self->gamepad == NULL)
        return FALSE;
    return SDL_SetGamepadSensorEnabled(self->gamepad, (SDL_SensorType) sensor, enabled);
}

gboolean gjsify_gamepad_device_get_sensor_data(GjsifyGamepadDevice *self,
                                               GjsifyGamepadSensor sensor,
                                               gfloat *x,
                                               gfloat *y,
                                               gfloat *z)
{
    float data[3] = { 0.0f, 0.0f, 0.0f };
    gboolean ok = FALSE;

    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_DEVICE(self), FALSE);
    if (self->gamepad != NULL && SDL_GamepadSensorEnabled(self->gamepad, (SDL_SensorType) sensor))
        ok = SDL_GetGamepadSensorData(self->gamepad, (SDL_SensorType) sensor, data, 3);
    if (!ok)
        data[0] = data[1] = data[2] = 0.0f;
    *x = data[0];
    *y = data[1];
    *z = data[2];
    return ok;
}

/* ==========================================================================
 * GjsifyGamepadMonitor
 * ========================================================================== */

enum {
    SIGNAL_DEVICE_ADDED,
    SIGNAL_DEVICE_REMOVED,
    N_SIGNALS,
};

static guint monitor_signals[N_SIGNALS];

/* How many monitors hold SDL's gamepad subsystem. SDL is linked statically, so
 * this copy of SDL belongs to this library alone and nobody else in the process
 * can be using it: when the count reaches 0, SDL_Quit() is safe and releases the
 * whole library state, which is what makes repeated start/stop leak-free. */
static guint live_monitors = 0;

struct _GjsifyGamepadMonitor {
    GObject parent_instance;
    GPtrArray *devices; /* (element-type GjsifyGamepadDevice) (owned) */
    GSource *timeout;   /* NULL once closed */
    gboolean open;
};

G_DEFINE_FINAL_TYPE(GjsifyGamepadMonitor, gjsify_gamepad_monitor, G_TYPE_OBJECT)

static void gjsify_gamepad_monitor_dispose(GObject *object)
{
    gjsify_gamepad_monitor_close(GJSIFY_GAMEPAD_MONITOR(object));
    G_OBJECT_CLASS(gjsify_gamepad_monitor_parent_class)->dispose(object);
}

static void gjsify_gamepad_monitor_finalize(GObject *object)
{
    GjsifyGamepadMonitor *self = GJSIFY_GAMEPAD_MONITOR(object);
    g_ptr_array_unref(self->devices);
    G_OBJECT_CLASS(gjsify_gamepad_monitor_parent_class)->finalize(object);
}

static void gjsify_gamepad_monitor_class_init(GjsifyGamepadMonitorClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS(klass);
    object_class->dispose = gjsify_gamepad_monitor_dispose;
    object_class->finalize = gjsify_gamepad_monitor_finalize;

    monitor_signals[SIGNAL_DEVICE_ADDED] =
        g_signal_new("device-added", G_TYPE_FROM_CLASS(klass), G_SIGNAL_RUN_LAST, 0, NULL, NULL, NULL,
                     G_TYPE_NONE, 1, GJSIFY_GAMEPAD_TYPE_DEVICE);
    monitor_signals[SIGNAL_DEVICE_REMOVED] =
        g_signal_new("device-removed", G_TYPE_FROM_CLASS(klass), G_SIGNAL_RUN_LAST, 0, NULL, NULL, NULL,
                     G_TYPE_NONE, 1, GJSIFY_GAMEPAD_TYPE_DEVICE);
}

static void gjsify_gamepad_monitor_init(GjsifyGamepadMonitor *self)
{
    self->devices = g_ptr_array_new_with_free_func(g_object_unref);
}

static gboolean gjsify_gamepad_monitor_tick(gpointer user_data)
{
    gjsify_gamepad_monitor_update(GJSIFY_GAMEPAD_MONITOR(user_data));
    return G_SOURCE_CONTINUE;
}

GjsifyGamepadMonitor *gjsify_gamepad_monitor_new(GError **error)
{
    g_return_val_if_fail(error == NULL || *error == NULL, NULL);

    /* A `gjs`/`node` process is never the foreground app SDL would otherwise
     * wait for, so without this a controller reports nothing (on macOS it is
     * also what makes SDL ask GameController.framework for background events). */
    SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
    /* SDL's events subsystem otherwise installs SIGINT/SIGTERM handlers that turn
     * Ctrl-C into an SDL_EVENT_QUIT nobody reads: the host process would stop
     * reacting to it the moment a page touched navigator.getGamepads(). */
    SDL_SetHint(SDL_HINT_NO_SIGNAL_HANDLERS, "1");

    if (!SDL_InitSubSystem(SDL_INIT_GAMEPAD)) {
        g_set_error(error, GJSIFY_GAMEPAD_MONITOR_ERROR, GJSIFY_GAMEPAD_MONITOR_ERROR_INIT_FAILED,
                    "SDL gamepad subsystem did not start: %s", SDL_GetError());
        if (live_monitors == 0)
            SDL_Quit();
        return NULL;
    }
    live_monitors++;

    GjsifyGamepadMonitor *self = g_object_new(GJSIFY_GAMEPAD_TYPE_MONITOR, NULL);
    self->open = TRUE;
    self->timeout = g_timeout_source_new(GJSIFY_GAMEPAD_UPDATE_INTERVAL_MS);
    /* No reference to @self: the monitor owns the source and destroys it in
     * close(), which dispose() runs, so the callback never sees a dead monitor. */
    g_source_set_callback(self->timeout, gjsify_gamepad_monitor_tick, self, NULL);
    g_source_set_static_name(self->timeout, "[gjsify-gamepad] update");
    g_source_attach(self->timeout, g_main_context_get_thread_default());
    return self;
}

static gint gjsify_gamepad_monitor_find(GjsifyGamepadMonitor *self, SDL_JoystickID id)
{
    for (guint i = 0; i < self->devices->len; i++) {
        GjsifyGamepadDevice *device = g_ptr_array_index(self->devices, i);
        if (device->id == id)
            return (gint) i;
    }
    return -1;
}

static gboolean id_in(SDL_JoystickID id, const SDL_JoystickID *ids, int n)
{
    for (int i = 0; i < n; i++) {
        if (ids[i] == id)
            return TRUE;
    }
    return FALSE;
}

#ifdef __APPLE__
/* GameController.framework calls its handlers on GCController.handlerQueue,
 * whose default is the MAIN dispatch queue, and a GMainLoop never services that
 * queue (docs/poc/gamepad-darwin-probe.m, row 1). Draining the main CFRunLoop's
 * default mode runs the queued blocks, so SDL's GameController driver hears
 * about a controller only it can see. Only the main thread can drain the main
 * run loop; a monitor on another thread still gets IOKit and HIDAPI devices. */
static void drain_main_run_loop(void)
{
    if (CFRunLoopGetCurrent() != CFRunLoopGetMain())
        return;
    while (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true) == kCFRunLoopRunHandledSource) {
        /* one source per call; loop until nothing is ready */
    }
}
#endif

void gjsify_gamepad_monitor_update(GjsifyGamepadMonitor *self)
{
    g_return_if_fail(GJSIFY_GAMEPAD_IS_MONITOR(self));
    if (!self->open)
        return;
    /* A signal handler below may drop the caller's last reference (a JS wrapper
     * going away inside `device-removed`); this one keeps @self alive until the
     * emissions are done. */
    g_autoptr(GjsifyGamepadMonitor) guard = g_object_ref(self);

#ifdef __APPLE__
    drain_main_run_loop();
#endif
    /* Refreshes state AND runs each driver's hotplug detection. */
    SDL_UpdateGamepads();
    /* Nothing here reads SDL's event queue — hotplug is a diff of SDL's device
     * list against ours (below), which also keeps two monitors from stealing each
     * other's events. So drop what SDL queued, or the queue would grow until SDL
     * starts discarding. The range is the joystick + gamepad block of
     * SDL_EventType; this SDL has no other subsystem that posts. */
    SDL_FlushEvents(SDL_EVENT_JOYSTICK_AXIS_MOTION, SDL_EVENT_FINGER_DOWN - 1);

    int n = 0;
    SDL_JoystickID *ids = SDL_GetGamepads(&n);
    g_autoptr(GPtrArray) removed = g_ptr_array_new_with_free_func(g_object_unref);
    g_autoptr(GPtrArray) added = g_ptr_array_new_with_free_func(g_object_unref);

    for (guint i = self->devices->len; i > 0; i--) {
        GjsifyGamepadDevice *device = g_ptr_array_index(self->devices, i - 1);
        if (!id_in(device->id, ids, n)) {
            gjsify_gamepad_device_release(device);
            g_ptr_array_add(removed, g_ptr_array_steal_index(self->devices, i - 1));
        }
    }
    for (int i = 0; i < n; i++) {
        if (gjsify_gamepad_monitor_find(self, ids[i]) >= 0)
            continue;
        SDL_Gamepad *gamepad = SDL_OpenGamepad(ids[i]);
        /* A device can vanish between the list and the open; it is simply not
         * there yet, and the next update tries again if it comes back. */
        if (gamepad == NULL)
            continue;
        GjsifyGamepadDevice *device = gjsify_gamepad_device_new(ids[i], gamepad);
        g_ptr_array_add(self->devices, device);
        g_ptr_array_add(added, g_object_ref(device));
    }
    SDL_free(ids);

    /* Emitted after the list is consistent, so a handler that calls back into
     * the monitor — get_devices(), even close() — sees the final state. */
    for (guint i = 0; i < removed->len; i++)
        g_signal_emit(self, monitor_signals[SIGNAL_DEVICE_REMOVED], 0, g_ptr_array_index(removed, i));
    for (guint i = 0; i < added->len; i++)
        g_signal_emit(self, monitor_signals[SIGNAL_DEVICE_ADDED], 0, g_ptr_array_index(added, i));
}

GPtrArray *gjsify_gamepad_monitor_get_devices(GjsifyGamepadMonitor *self)
{
    g_return_val_if_fail(GJSIFY_GAMEPAD_IS_MONITOR(self), NULL);
    GPtrArray *devices = g_ptr_array_new_full(self->devices->len, g_object_unref);
    for (guint i = 0; i < self->devices->len; i++)
        g_ptr_array_add(devices, g_object_ref(g_ptr_array_index(self->devices, i)));
    return devices;
}

void gjsify_gamepad_monitor_close(GjsifyGamepadMonitor *self)
{
    g_return_if_fail(GJSIFY_GAMEPAD_IS_MONITOR(self));
    if (!self->open)
        return;
    self->open = FALSE;

    if (self->timeout != NULL) {
        g_source_destroy(self->timeout);
        g_clear_pointer(&self->timeout, g_source_unref);
    }
    /* The device objects may live on in JS; release() leaves them reporting
     * disconnected with zeroed state instead of pointing at a closed handle. */
    for (guint i = 0; i < self->devices->len; i++)
        gjsify_gamepad_device_release(g_ptr_array_index(self->devices, i));
    g_ptr_array_set_size(self->devices, 0);

    SDL_QuitSubSystem(SDL_INIT_GAMEPAD);
    if (--live_monitors == 0)
        SDL_Quit();
}
