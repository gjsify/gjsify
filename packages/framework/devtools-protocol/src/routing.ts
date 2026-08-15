// @gjsify/devtools-protocol — instance label → DBus bus name + object path routing.

/**
 * Coerce a free-form instance label into a valid app-id segment (letter-led, lowercase
 * alphanumeric). Shared by the in-app adapter and the MCP bridge, so both derive the
 * SAME per-instance bus name.
 */
export function sanitizeInstanceId(label: string): string {
    const cleaned = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    return /^[a-z]/.test(cleaned) ? cleaned : `i${cleaned || '0'}`;
}

export interface BusAddress {
    busName: string;
    objectPath: string;
    instance: string;
}

/**
 * An application id as `Gio.Application` itself spells it as an object path: dots become
 * slashes, HYPHENS BECOME UNDERSCORES (gio `gapplicationimpl-dbus.c`,
 * `application_path_from_appid`).
 *
 * The hyphen half is not cosmetic. `-` is not a legal D-Bus object-path character —
 * measured on gjs 1.88.1, `GLib.Variant.is_object_path('/gjsify/examples/canvas2d-fireworks')`
 * is `false`, and exporting there does NOT throw: it logs one
 * `g_dbus_interface_skeleton_export: assertion 'g_variant_is_object_path (object_path)'
 * failed` and exports nothing. Every `gjsify.examples.*-*` showcase carries such an id, so
 * a dots-only derivation aimed the bus-less export and the bridge's prediction at a path
 * that can never exist, silently, while the app itself sat at the underscore one.
 */
export function appIdToObjectPath(appId: string): string {
    return `/${appId.replace(/\./g, '/').replace(/-/g, '_')}`;
}

/**
 * Resolve an instance label to its DBus bus name + devtools object path, given the app's
 * base id. The default instance keeps the bare base; a named instance gets a
 * `.<segment>` bus-name suffix and a `/<segment>` path segment, so the bridge dials the
 * right process when several run side by side.
 *
 * Path derivation is {@link appIdToObjectPath} plus a `/devtools` leaf. The in-app adapter
 * should prefer the authoritative `app.get_dbus_object_path() + '/devtools'`; this only
 * lets the bridge PREDICT it.
 *
 * - `("org.example.App")` → `org.example.App` @ `/org/example/App/devtools`
 * - `("org.example.App", "host")` → `org.example.App.host` @ `/org/example/App/host/devtools`
 */
export function resolveBusAddress(base: string, label?: string): BusAddress {
    const basePath = appIdToObjectPath(base);
    const seg = label && label !== 'default' ? sanitizeInstanceId(label) : 'default';
    if (seg === 'default') {
        return { busName: base, objectPath: `${basePath}/devtools`, instance: 'default' };
    }
    return { busName: `${base}.${seg}`, objectPath: `${basePath}/${seg}/devtools`, instance: seg };
}

// The env-var names live HERE, in the contract both sides import, so the in-app adapter
// and the MCP bridge cannot disagree about one: `GJSIFY_DEVTOOLS_ADDRESS` is read by both.

/** Env var enabling the control plane at all (any value except ``, `0`, `false`). */
export const DEVTOOLS_ENABLE_ENV = 'GJSIFY_DEVTOOLS';
/** Env var carrying the per-instance label for side-by-side apps. */
export const DEVTOOLS_INSTANCE_ENV = 'GJSIFY_DEVTOOLS_INSTANCE';
/**
 * D-Bus address for the BUS-LESS peer transport, which exists because macOS and Windows
 * have no session bus. The app LISTENS on it (`unix:tmpdir=/tmp`, `unix:path=…`,
 * `nonce-tcp:host=127.0.0.1`), the bridge DIALS it.
 */
export const DEVTOOLS_ADDRESS_ENV = 'GJSIFY_DEVTOOLS_ADDRESS';

/** Whether a value read from {@link DEVTOOLS_ENABLE_ENV} turns devtools on. */
export function isDevtoolsEnabledValue(value: string | null | undefined): boolean {
    if (value == null) return false;
    const t = value.toLowerCase();
    return t !== '' && t !== '0' && t !== 'false';
}

/** Directory (under the user's runtime dir) holding the per-app peer-address files. */
export const DEVTOOLS_ADDRESS_DIR = 'gjsify-devtools';

/**
 * Path of the file an app on the peer transport writes its concrete CLIENT address into,
 * so a bridge can find it with no environment at all — the bus-less analogue of
 * `DBUS_SESSION_BUS_ADDRESS`, since a peer socket has no well-known name to look up.
 *
 * `runtimeDir` is passed IN rather than probed, which keeps this package free of platform
 * imports (both sides pass `GLib.get_user_runtime_dir()`). The name derives from the SAME
 * bus name {@link resolveBusAddress} does, so one instance label routes both transports
 * identically:
 * - `(dir, "org.example.App")` → `<dir>/gjsify-devtools/org.example.App.address`
 * - `(dir, "org.example.App", "host")` → `<dir>/gjsify-devtools/org.example.App.host.address`
 *
 * Forward slashes unconditionally: GLib/GIO accept them on win32 too, and a per-platform
 * separator would need a platform probe in a pure module.
 */
export function devtoolsAddressFilePath(runtimeDir: string, base: string, label?: string): string {
    const { busName } = resolveBusAddress(base, label);
    return `${runtimeDir}/${DEVTOOLS_ADDRESS_DIR}/${busName}.address`;
}
