/* GjsifyGamepad — SDL3's gamepad subsystem behind a GObject API (ADR 0075).
 *
 * g-ir-scanner reads THIS FILE ONLY (see meson.build), so every annotation that
 * decides how GJS and node-gi see the API lives here, next to the declaration.
 *
 * The API already speaks the W3C Gamepad standard layout
 * (https://w3c.github.io/gamepad/#remapping): a snapshot is 17 button values and
 * 4 axis values in W3C order. SDL's own vocabulary stays inside the shim, so the
 * table from SDL to W3C exists once, for every OS and every JS host.
 */
#pragma once

#include <glib-object.h>

/* The library's API is its ONLY export. On ELF and Mach-O that is enforced at
 * link time (a version script, `-exported_symbol`; see meson.build), which hides
 * the statically linked SDL. A PE DLL exports nothing unless told to, so on
 * win32 every declaration below carries dllexport while the library itself is
 * compiled and dllimport for whoever links against it (the tests). Placed
 * before G_DECLARE_FINAL_TYPE it applies to the `_get_type()` that macro
 * declares first, which is the symbol GI resolves to register each class. */
#if defined(_WIN32)
#  if defined(GJSIFY_GAMEPAD_COMPILATION)
#    define GJSIFY_GAMEPAD_API __declspec(dllexport)
#  else
#    define GJSIFY_GAMEPAD_API __declspec(dllimport)
#  endif
#else
#  define GJSIFY_GAMEPAD_API
#endif

G_BEGIN_DECLS

/**
 * GJSIFY_GAMEPAD_MONITOR_ERROR:
 *
 * Error domain for #GjsifyGamepadMonitor. Errors in this domain are from
 * the #GjsifyGamepadMonitorError enumeration.
 */
#define GJSIFY_GAMEPAD_MONITOR_ERROR (gjsify_gamepad_monitor_error_quark())
GJSIFY_GAMEPAD_API GQuark gjsify_gamepad_monitor_error_quark(void);

/**
 * GjsifyGamepadMonitorError:
 * @GJSIFY_GAMEPAD_MONITOR_ERROR_INIT_FAILED: SDL's gamepad subsystem did not
 *   start. The message carries SDL's own reason.
 *
 * Error codes for %GJSIFY_GAMEPAD_MONITOR_ERROR.
 */
typedef enum {
    GJSIFY_GAMEPAD_MONITOR_ERROR_INIT_FAILED,
} GjsifyGamepadMonitorError;

/**
 * GjsifyGamepadSensor:
 * @GJSIFY_GAMEPAD_SENSOR_ACCEL: the accelerometer, in m/s².
 * @GJSIFY_GAMEPAD_SENSOR_GYRO: the gyroscope, in rad/s.
 *
 * A motion sensor a controller may carry. The values match SDL_SensorType.
 */
typedef enum {
    GJSIFY_GAMEPAD_SENSOR_ACCEL = 1,
    GJSIFY_GAMEPAD_SENSOR_GYRO = 2,
} GjsifyGamepadSensor;

#define GJSIFY_GAMEPAD_TYPE_DEVICE (gjsify_gamepad_device_get_type())
GJSIFY_GAMEPAD_API G_DECLARE_FINAL_TYPE(GjsifyGamepadDevice, gjsify_gamepad_device, GJSIFY_GAMEPAD, DEVICE, GObject)

#define GJSIFY_GAMEPAD_TYPE_MONITOR (gjsify_gamepad_monitor_get_type())
GJSIFY_GAMEPAD_API G_DECLARE_FINAL_TYPE(GjsifyGamepadMonitor, gjsify_gamepad_monitor, GJSIFY_GAMEPAD, MONITOR, GObject)

/**
 * gjsify_gamepad_device_get_name:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: (transfer none): the controller's name, as SDL's mapping database
 *   knows it, or a generic name when it has none.
 */
GJSIFY_GAMEPAD_API const gchar *gjsify_gamepad_device_get_name(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_get_guid:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: (transfer none): SDL's 32-hex-digit GUID for the controller model.
 */
GJSIFY_GAMEPAD_API const gchar *gjsify_gamepad_device_get_guid(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_get_vendor:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: the USB vendor ID, or 0 when SDL does not know it.
 */
GJSIFY_GAMEPAD_API guint16 gjsify_gamepad_device_get_vendor(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_get_product:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: the USB product ID, or 0 when SDL does not know it.
 */
GJSIFY_GAMEPAD_API guint16 gjsify_gamepad_device_get_product(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_is_connected:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: %FALSE once #GjsifyGamepadMonitor::device-removed has been emitted
 *   for this device, or its monitor was closed.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_is_connected(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_get_buttons:
 * @self: a #GjsifyGamepadDevice
 * @n_buttons: (out): the number of values, always 17
 *
 * The button state as of the last gjsify_gamepad_monitor_update(), in W3C
 * standard-layout order. Digital buttons are 0 or 1. The triggers (6 and 7) are
 * analog, 0..1. All zeros once the device is disconnected.
 *
 * Returns: (array length=n_buttons) (transfer full): the values.
 */
GJSIFY_GAMEPAD_API gdouble *gjsify_gamepad_device_get_buttons(GjsifyGamepadDevice *self, gsize *n_buttons);

/**
 * gjsify_gamepad_device_get_axes:
 * @self: a #GjsifyGamepadDevice
 * @n_axes: (out): the number of values, always 4
 *
 * The stick axes as of the last gjsify_gamepad_monitor_update(), in W3C
 * standard-layout order (left x, left y, right x, right y), -1..1, with -1 = up
 * on the y axes. All zeros once the device is disconnected.
 *
 * Returns: (array length=n_axes) (transfer full): the values.
 */
GJSIFY_GAMEPAD_API gdouble *gjsify_gamepad_device_get_axes(GjsifyGamepadDevice *self, gsize *n_axes);

/**
 * gjsify_gamepad_device_has_rumble:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: whether gjsify_gamepad_device_rumble() can drive this controller.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_has_rumble(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_has_trigger_rumble:
 * @self: a #GjsifyGamepadDevice
 *
 * Returns: whether gjsify_gamepad_device_rumble_triggers() can drive this
 *   controller.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_has_trigger_rumble(GjsifyGamepadDevice *self);

/**
 * gjsify_gamepad_device_rumble:
 * @self: a #GjsifyGamepadDevice
 * @low_frequency: the strong (low-frequency) motor, 0..65535
 * @high_frequency: the weak (high-frequency) motor, 0..65535
 * @duration_ms: how long, in milliseconds; a new call replaces a running one,
 *   and 0 intensities stop it
 *
 * Returns: %FALSE when the controller has no rumble or is disconnected.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_rumble(GjsifyGamepadDevice *self,
                                      guint16 low_frequency,
                                      guint16 high_frequency,
                                      guint32 duration_ms);

/**
 * gjsify_gamepad_device_rumble_triggers:
 * @self: a #GjsifyGamepadDevice
 * @left: the left trigger motor, 0..65535
 * @right: the right trigger motor, 0..65535
 * @duration_ms: how long, in milliseconds; a new call replaces a running one
 *
 * Returns: %FALSE when the controller has no trigger rumble or is disconnected.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_rumble_triggers(GjsifyGamepadDevice *self,
                                               guint16 left,
                                               guint16 right,
                                               guint32 duration_ms);

/**
 * gjsify_gamepad_device_has_sensor:
 * @self: a #GjsifyGamepadDevice
 * @sensor: the sensor to ask about
 *
 * Returns: whether the controller carries @sensor.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_has_sensor(GjsifyGamepadDevice *self, GjsifyGamepadSensor sensor);

/**
 * gjsify_gamepad_device_set_sensor_enabled:
 * @self: a #GjsifyGamepadDevice
 * @sensor: the sensor to switch
 * @enabled: whether it should report
 *
 * Sensors are off until enabled, because a reporting sensor costs the
 * controller battery and bandwidth.
 *
 * Returns: %FALSE when the controller does not carry @sensor or is disconnected.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_set_sensor_enabled(GjsifyGamepadDevice *self,
                                                  GjsifyGamepadSensor sensor,
                                                  gboolean enabled);

/**
 * gjsify_gamepad_device_get_sensor_data:
 * @self: a #GjsifyGamepadDevice
 * @sensor: the sensor to read
 * @x: (out): the x value
 * @y: (out): the y value
 * @z: (out): the z value
 *
 * Reads an enabled sensor as of the last gjsify_gamepad_monitor_update().
 *
 * Returns: %FALSE when the sensor is absent, not enabled, or the controller is
 *   disconnected; the out values are then 0.
 */
GJSIFY_GAMEPAD_API gboolean gjsify_gamepad_device_get_sensor_data(GjsifyGamepadDevice *self,
                                               GjsifyGamepadSensor sensor,
                                               gfloat *x,
                                               gfloat *y,
                                               gfloat *z);

/**
 * GjsifyGamepadMonitor::device-added:
 * @self: the monitor
 * @device: the controller that connected
 *
 * A controller with a standard-layout mapping connected, or was already
 * connected when the monitor's first update ran.
 */

/**
 * GjsifyGamepadMonitor::device-removed:
 * @self: the monitor
 * @device: the controller that went away; it reports disconnected from now on
 *
 * A controller disconnected. Not emitted by gjsify_gamepad_monitor_close().
 */

/**
 * gjsify_gamepad_monitor_new:
 * @error: return location for a #GError
 *
 * Starts SDL's gamepad subsystem (reference-counted across monitors) and a
 * low-rate GLib timeout on the thread-default main context that calls
 * gjsify_gamepad_monitor_update(), so #GjsifyGamepadMonitor::device-added fires
 * for a program that never polls. Controllers already connected are reported by
 * the first update, not by this call.
 *
 * Call it, and everything else on the monitor, from the thread that runs the
 * JS context: SDL and, on macOS, GameController.framework are single-threaded
 * here by design.
 *
 * Returns: (transfer full): a new monitor, or %NULL with @error set.
 */
GJSIFY_GAMEPAD_API GjsifyGamepadMonitor *gjsify_gamepad_monitor_new(GError **error);

/**
 * gjsify_gamepad_monitor_update:
 * @self: a #GjsifyGamepadMonitor
 *
 * The pump: refreshes every controller's state and reports hotplug through
 * #GjsifyGamepadMonitor::device-removed and #GjsifyGamepadMonitor::device-added,
 * in that order. On macOS it first drains the main run loop, because that is
 * where GameController.framework delivers and a GLib main loop never services
 * it. Call it at the moment the state is read (W3C's getGamepads()); the
 * monitor's own timeout calls it in between. A no-op once closed.
 */
GJSIFY_GAMEPAD_API void gjsify_gamepad_monitor_update(GjsifyGamepadMonitor *self);

/**
 * gjsify_gamepad_monitor_get_devices:
 * @self: a #GjsifyGamepadMonitor
 *
 * Returns: (transfer container) (element-type GjsifyGamepadDevice): the
 *   connected controllers, in the order they connected.
 */
GJSIFY_GAMEPAD_API GPtrArray *gjsify_gamepad_monitor_get_devices(GjsifyGamepadMonitor *self);

/**
 * gjsify_gamepad_monitor_close:
 * @self: a #GjsifyGamepadMonitor
 *
 * Stops the timeout, releases every controller and SDL's subsystem, without
 * emitting #GjsifyGamepadMonitor::device-removed. Idempotent, and also run on
 * finalize; call it explicitly so SDL is released when the JS side stops, not
 * when the garbage collector gets to the wrapper.
 */
GJSIFY_GAMEPAD_API void gjsify_gamepad_monitor_close(GjsifyGamepadMonitor *self);

G_END_DECLS
