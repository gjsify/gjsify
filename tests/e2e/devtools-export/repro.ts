// E2E fixture: a minimal Adwaita app that installs @gjsify/devtools, built to a
// GJS bundle by run.mjs and driven over DBus. It reproduces the exact app config
// the PixelRPG maker uses — `HANDLES_COMMAND_LINE` + an app-owned sibling DBus
// object exported BEFORE devtools — because that config was (wrongly) suspected
// of making `DevtoolsService.export` fail silently. It does not: this fixture
// proves `org.gjsify.Devtools` exports + answers a method call under every
// combination of those two knobs (REPRO_CMDLINE / REPRO_SIBLING).
//
// The maker's real "devtools absent" symptom was a STALE app bundle (its source
// called installDevtools() but the committed bundle predated that line), NOT a
// @gjsify/devtools bug — so this guards the export path against a genuine future
// regression and documents the correct diagnosis.

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type GObject from '@girs/gobject-2.0';
import { installDevtools } from '@gjsify/devtools';

const useCmdline = GLib.getenv('REPRO_CMDLINE') === '1';
const useSibling = GLib.getenv('REPRO_SIBLING') === '1';

// A trivial app-owned interface, exported at <base>/control BEFORE devtools — the
// maker exports its `org.pixelrpg.maker.Control` this way.
const CONTROL_XML =
    '<node><interface name="org.example.Control"><method name="Ping"><arg type="s" direction="out"/></method></interface></node>';
const controlImpl = { Ping: () => 'pong' };

const app = new Adw.Application({
    application_id: 'org.example.reprotest',
    flags: useCmdline ? Gio.ApplicationFlags.HANDLES_COMMAND_LINE : Gio.ApplicationFlags.DEFAULT_FLAGS,
});

app.connect('startup', () => {
    const conn = app.get_dbus_connection();
    const base = app.get_dbus_object_path();
    printerr(`[repro] startup conn=${!!conn} base=${base} cmdline=${useCmdline} sibling=${useSibling}`);
    if (useSibling && conn && base) {
        try {
            const control = Gio.DBusExportedObject.wrapJSObject(CONTROL_XML, controlImpl as unknown as GObject.Object);
            control.export(conn, `${base}/control`);
            printerr(`[repro] control exported at ${base}/control`);
        } catch (error) {
            printerr(`[repro] control export FAILED: ${error}`);
        }
    }
    try {
        // enabled:true bypasses the GJSIFY_DEVTOOLS env gate — this fixture tests
        // the EXPORT path itself, independent of the gate.
        const service = installDevtools(app, { enabled: true });
        printerr(`[repro] installDevtools -> ${service ? 'service' : 'null'}`);
    } catch (error) {
        printerr(`[repro] installDevtools THREW: ${error}`);
    }
    printerr(`[repro] READY ${base}`);
});

app.connect('command_line', () => {
    app.activate();
    return 0;
});
app.connect('activate', () => {
    app.hold();
});

app.run([]);
