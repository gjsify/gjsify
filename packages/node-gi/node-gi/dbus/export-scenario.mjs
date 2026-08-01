// SPDX-License-Identifier: MIT
// Shared DBus OBJECT-EXPORT scenario for @gjsify/node-gi, parameterized by the
// Gio + GLib namespaces so the SAME source runs on gjs (`gi://` via
// ./gjs-harness.js) and node-gi (`requireGi` via ../test/dbus.test.mjs) — gjs is
// the gold standard, the two results must compare byte-for-byte.
//
// It exercises the EXPORT half of the DBus surface
// (Gio.DBusExportedObject.wrapJSObject — a JS object exported AS a DBus
// service; gjs builds it on GjsPrivate.DBusImplementation, node-gi on the
// introspectable g_dbus_connection_register_object_with_closures2):
//   • the common impl surface (export/unexport/unexport_from_connection/
//     emit_signal/emit_property_changed/flush/get_object_path),
//   • a proxy (async init — a SYNC self-call would deadlock the one main loop
//     that must also service the incoming request) calls an exported method,
//   • property GET + SET via org.freedesktop.DBus.Properties (the get-property /
//     set-property closures; Set writes through to the JS object),
//   • a throwing method surfaces as a DBus error (org.gnome.gjs.JSError.Error),
//   • emit_signal reaches the proxy's connectSignal handler,
//   • emit_property_changed updates the proxy's cached property,
//   • after unexport() the object is gone (a further call errors).
//
// All calls are driven through RAW async callbacks (never Promise `.then` — a
// Promise continuation does not drain under a blocking node-gi GLib loop,
// node-gtk #442/#121). The proxy targets the connection's own UNIQUE name, so
// no bus-name owning/timing is involved; nothing nondeterministic is recorded.

export const EXPORT_EXPECTED = {
    implSurface: {
        export: 'function',
        unexport: 'function',
        unexport_from_connection: 'function',
        emit_signal: 'function',
        emit_property_changed: 'function',
        flush: 'function',
        get_object_path: 'function',
    },
    objectPath: '/org/gjsify/NodeGiExportScenario',
    echo: 'echo:hi',
    // GJS appends the message's Gio.UnixFDList as a trailing method argument —
    // null when the call carries no fds; node-gi mirrors the shape.
    echoFdArg: 'null',
    levelBefore: 7,
    levelAfterSet: 99,
    boomErrHasName: true,
    boomErrHasMessage: true,
    signal: 'ping!',
    propAfterChanged: 99,
    afterUnexportErrors: true,
};

const IFACE = 'org.gjsify.NodeGiExportScenario';
const OBJ_PATH = '/org/gjsify/NodeGiExportScenario';
const XML = `<node><interface name="${IFACE}">
<method name="Echo"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Boom"><arg type="s" direction="out"/></method>
<property name="Level" type="i" access="readwrite"/>
<signal name="Pinged"><arg type="s"/></signal>
</interface></node>`;

/**
 * Run the object-export round-trip and return the normalized result object
 * (matches EXPORT_EXPECTED on a working runtime). Blocks on a GLib main loop
 * until the round-trip completes (bounded by a safety timeout).
 * @param {{ Gio: any, GLib: any }} ns
 * @returns {object}
 */
export function runExportScenario({ Gio, GLib }) {
    const conn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    let echoFdArg = 'unset';
    const service = {
        Level: 7,
        Echo(s, fdList) {
            echoFdArg = fdList === null ? 'null' : typeof fdList;
            return `echo:${s}`;
        },
        Boom() {
            throw new Error('kaboom');
        },
    };

    const result = {
        implSurface: {},
        objectPath: null,
        echo: null,
        echoFdArg: null,
        levelBefore: null,
        levelAfterSet: null,
        boomErrHasName: null,
        boomErrHasMessage: null,
        signal: null,
        propAfterChanged: null,
        afterUnexportErrors: null,
    };

    const impl = Gio.DBusExportedObject.wrapJSObject(XML, service);
    for (const k of Object.keys(EXPORT_EXPECTED.implSurface)) result.implSurface[k] = typeof impl[k];

    impl.export(conn, OBJ_PATH);
    result.objectPath = impl.get_object_path();

    const loop = GLib.MainLoop.new(null, false);
    const finish = () => loop.quit();

    // The proxy targets our OWN connection's unique name — always resolvable,
    // never racing a name-ownership handshake; never recorded (it is per-run).
    const dest = conn.get_unique_name();
    const ProxyClass = Gio.DBusProxy.makeProxyWrapper(XML);
    new ProxyClass(conn, dest, OBJ_PATH, (proxy, initErr) => {
        if (initErr) {
            result.initError = String(initErr);
            finish();
            return;
        }
        let signalSeen = null;
        proxy.connectSignal('Pinged', (_p, _sender, args) => {
            signalSeen = args[0];
        });
        proxy.EchoRemote('hi', ([echoed]) => {
            result.echo = echoed;
            result.echoFdArg = echoFdArg;
            // Property GET via org.freedesktop.DBus.Properties (async — the
            // get-property closure runs on this same loop).
            conn.call(
                dest,
                OBJ_PATH,
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', [IFACE, 'Level']),
                new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_s1, res1) => {
                    result.levelBefore = conn.call_finish(res1).deepUnpack()[0].deepUnpack();
                    // Property SET: the set-property closure writes through to
                    // the JS object.
                    conn.call(
                        dest,
                        OBJ_PATH,
                        'org.freedesktop.DBus.Properties',
                        'Set',
                        new GLib.Variant('(ssv)', [IFACE, 'Level', new GLib.Variant('i', 99)]),
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (_s2, res2) => {
                            conn.call_finish(res2);
                            result.levelAfterSet = service.Level;
                            // A throwing method returns a DBus error carrying the
                            // gjs-style error name + the thrown message.
                            proxy.BoomRemote((_v, boomErr) => {
                                const msg = boomErr && boomErr.message ? boomErr.message : '';
                                result.boomErrHasName = msg.includes('org.gnome.gjs.JSError.Error');
                                result.boomErrHasMessage = msg.includes('kaboom');
                                // emit_signal + emit_property_changed, then give
                                // the bus a settle window before reading back.
                                impl.emit_signal('Pinged', new GLib.Variant('(s)', ['ping!']));
                                impl.emit_property_changed('Level', new GLib.Variant('i', 99));
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                                    result.signal = signalSeen;
                                    // The PropertiesChanged emission updated the
                                    // proxy's cached property.
                                    result.propAfterChanged = proxy.Level;
                                    impl.unexport();
                                    proxy.EchoRemote('again', (_r, err) => {
                                        result.afterUnexportErrors = Boolean(err);
                                        finish();
                                    });
                                    return false; // G_SOURCE_REMOVE
                                });
                            });
                        },
                    );
                },
            );
        });
    });

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
        result.timedOut = true;
        finish();
        return false;
    });
    loop.run();
    return result;
}
