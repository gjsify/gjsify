// SPDX-License-Identifier: MIT
// Shared DBus round-trip scenario for @gjsify/node-gi, parameterized by the Gio +
// GLib namespaces so the SAME source runs on gjs (`gi://` via ./gjs-harness.js)
// and node-gi (`requireGi` via ../test/dbus.test.mjs). It lives OUTSIDE test/ so
// `node --test` (which globs every file under test/) never tries to evaluate the
// gi://-importing harness. The result is normalized to a
// deterministic shape (no bus UUID / no unique connection name) so the two
// runtimes compare byte-for-byte — gjs is the gold standard.
//
// It exercises the CLIENT half of the DBus surface against the always-present
// org.freedesktop.DBus service (no object export needed):
//   • makeProxyWrapper → sync method (GetIdSync), async method via the raw remote
//     callback (GetIdRemote), array-returning method (ListNamesSync),
//   • name owning (Gio.DBus.own_name → onNameAcquired fires),
//   • a live signal round-trip (connectSignal('NameOwnerChanged') fires when we
//     own the name),
//   • NameHasOwner before/after owning.
//
// The async method is driven through the RAW remote callback (GetIdRemote), NOT
// the Promise variant (GetIdAsync): a Promise `.then` continuation does not drain
// under a blocking node-gi GLib loop (node-gtk #442/#121), so a cross-runtime,
// loop-driven scenario must use the callback form. GetIdAsync's Promise variant is
// covered separately in dbus.test.mjs.

export const EXPECTED = {
    surface: {
        GetIdSync: 'function',
        GetIdRemote: 'function',
        GetIdAsync: 'function',
        NameHasOwnerSync: 'function',
        ListNamesSync: 'function',
        connectSignal: 'function',
        disconnectSignal: 'function',
    },
    getIdSyncHex: true,
    hasOwnerBefore: false,
    hasOwnerAfter: true,
    getIdRemoteHex: true,
    listNamesHasDBus: true,
    signalReceived: [true, true],
    acquiredFired: true,
};

const DBUS_XML = `<node>
<interface name="org.freedesktop.DBus">
  <method name="GetId"><arg type="s" direction="out"/></method>
  <method name="NameHasOwner"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
  <method name="ListNames"><arg type="as" direction="out"/></method>
  <signal name="NameOwnerChanged"><arg type="s"/><arg type="s"/><arg type="s"/></signal>
</interface>
</node>`;

const HEX32 = /^[0-9a-f]{32}$/;

/**
 * Run the DBus client round-trip and return the normalized result object (matches
 * EXPECTED on a working runtime). Blocks on a GLib main loop until the round-trip
 * completes. A unique bus name (per process) keeps concurrent runs isolated; it is
 * normalized out of the result.
 * @param {{ Gio: any, GLib: any }} ns
 * @returns {object}
 */
export function runScenario({ Gio, GLib }) {
    const uniqueName = `org.gjsify.nodegi.DBusTest.p${(typeof process !== 'undefined' && process.pid) || 0}n${Math.floor(Math.random() * 1e6)}`;

    const ProxyClass = Gio.DBusProxy.makeProxyWrapper(DBUS_XML);
    const proxy = new ProxyClass(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');

    const result = {
        surface: {},
        getIdSyncHex: null,
        hasOwnerBefore: null,
        hasOwnerAfter: null,
        getIdRemoteHex: null,
        listNamesHasDBus: null,
        signalReceived: null,
        acquiredFired: false,
    };
    for (const k of [
        'GetIdSync',
        'GetIdRemote',
        'GetIdAsync',
        'NameHasOwnerSync',
        'ListNamesSync',
        'connectSignal',
        'disconnectSignal',
    ]) {
        result.surface[k] = typeof proxy[k];
    }

    const [id] = proxy.GetIdSync();
    result.getIdSyncHex = HEX32.test(id);
    result.hasOwnerBefore = proxy.NameHasOwnerSync(uniqueName)[0];

    const loop = GLib.MainLoop.new(null, false);

    const handlerId = proxy.connectSignal('NameOwnerChanged', (_proxy, _senderName, args) => {
        if (args[0] === uniqueName) {
            // [old owner was empty, new owner is non-empty] → we just acquired it.
            result.signalReceived = [args[1] === '', args[2] !== ''];
        }
    });

    Gio.DBus.own_name(
        Gio.BusType.SESSION,
        uniqueName,
        Gio.BusNameOwnerFlags.NONE,
        null,
        () => {
            result.acquiredFired = true;
        },
        null,
    );

    // Give the async name acquisition + signal delivery a moment, then finish the
    // round-trip with an array method + a raw-callback async method, and quit.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        result.hasOwnerAfter = proxy.NameHasOwnerSync(uniqueName)[0];
        const names = proxy.ListNamesSync()[0];
        result.listNamesHasDBus = Array.isArray(names) && names.includes('org.freedesktop.DBus');
        proxy.GetIdRemote((res, err) => {
            result.getIdRemoteHex = !err && HEX32.test(res[0]);
            proxy.disconnectSignal(handlerId);
            loop.quit();
        });
        return false; // G_SOURCE_REMOVE
    });

    loop.run();
    return result;
}
