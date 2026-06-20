// @gjsify/devtools-protocol — instance label → DBus bus name + object path routing.
// Original implementation.

/**
 * Coerce a free-form instance label into a valid app-id segment
 * (letter-led, lowercase alphanumeric). Shared by the in-app adapter and
 * the MCP bridge so both derive the SAME per-instance bus name — replacing
 * the byte-identical hand-maintained duplication the map-editor needed when
 * its bridge was dependency-free.
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
 * Resolve an instance label to its DBus bus name + devtools object path,
 * given the app's base id (e.g. `"org.example.App"`). The default instance
 * keeps the bare base; a named instance gets a `.<segment>` bus-name suffix
 * and a `/<segment>` path segment, so the bridge dials the right process
 * when several run side by side.
 *
 * Mirrors `Gio.Application`'s own object-path derivation (id dots → slashes,
 * leading slash) plus a trailing `/devtools` leaf. The in-app adapter should
 * prefer the authoritative `app.get_dbus_object_path() + '/devtools'`; this
 * helper lets the bridge predict the same address for the dotted-id case.
 *
 * - `("org.example.App")` → `org.example.App` @ `/org/example/App/devtools`
 * - `("org.example.App", "host")` → `org.example.App.host` @ `/org/example/App/host/devtools`
 */
export function resolveBusAddress(base: string, label?: string): BusAddress {
    const basePath = `/${base.replace(/\./g, '/')}`;
    const seg = label && label !== 'default' ? sanitizeInstanceId(label) : 'default';
    if (seg === 'default') {
        return { busName: base, objectPath: `${basePath}/devtools`, instance: 'default' };
    }
    return { busName: `${base}.${seg}`, objectPath: `${basePath}/${seg}/devtools`, instance: seg };
}
