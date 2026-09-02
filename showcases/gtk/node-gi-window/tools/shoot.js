// Screenshot a running node-gi window over its org.gjsify.Devtools DBus surface —
// the sanctioned way to capture a GJS/GTK app's window (gdbus can't save the binary
// `ay` reply itself). Run against a window started with GJSIFY_DEVTOOLS=1:
//
//   node dist/app.node.mjs &   # (or: gjs -m dist/app.gjs.mjs &), with GJSIFY_DEVTOOLS=1
//   gjs -m tools/shoot.js <app-id> <out.png>
//
// <app-id>  eu.jumplink.NodeGiWindow (the devtools object path is derived from it)
// <out.png> file to write the PNG into
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

const IFACE = 'org.gjsify.Devtools';
const [appId, outPath] = ARGV;
if (!appId || !outPath) {
    printerr('usage: gjs -m tools/shoot.js <app-id> <out.png>');
    imports.system.exit(2);
}
const objPath = '/' + appId.replace(/\./g, '/') + '/devtools';
const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

function call(method, params, replyType) {
    return bus.call_sync(
        appId,
        objPath,
        IFACE,
        method,
        params,
        replyType ? new GLib.VariantType(replyType) : null,
        Gio.DBusCallFlags.NONE,
        15000,
        null,
    );
}

// Wait for the app to claim its bus name + export the devtools object.
let status = null;
for (let i = 0; i < 60; i++) {
    try {
        status = call('GetStatus', null, '(s)').recursiveUnpack()[0];
        break;
    } catch {
        GLib.usleep(500000); // 0.5s
    }
}
if (status == null) {
    printerr(`[shoot] timed out waiting for ${appId} on the session bus`);
    imports.system.exit(1);
}
print(`[shoot] status: ${status}`);
print(`[shoot] tree: ${call('DumpTree', new GLib.Variant('(si)', ['', 4]), '(s)').recursiveUnpack()[0]}`);

// One screenshot attempt; null when the window is not renderable yet (a just-mapped
// window reports a zero-size GSK frame for the first few frames).
function shootOnce() {
    try {
        const png = call('Screenshot', new GLib.Variant('(s)', ['']), '(ay)').recursiveUnpack()[0];
        return png && png.length > 0 ? png : null;
    } catch {
        return null;
    }
}

let png = null;
for (let i = 0; i < 40 && !png; i++) {
    call('PresentWindow', null, null);
    GLib.usleep(400000);
    png = shootOnce();
}
if (!png) {
    printerr('[shoot] empty screenshot — the window never became renderable');
    imports.system.exit(1);
}
GLib.file_set_contents(outPath, png);
print(`[shoot] wrote ${outPath} (${png.length} bytes)`);
