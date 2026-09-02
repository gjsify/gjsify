// Validation harness: drive a running Adwaita Storybook over its
// org.gjsify.Devtools DBus surface — open every story and capture a PNG of the
// window via the in-process GSK renderer. Run with:
//
//   gjs -m tools/shoot-stories.js <app-id> <out-dir> [title]
//
// <app-id>  e.g. org.gjsify.AdwaitaStorybook (object path derived from it)
// <out-dir> directory to write <slug>.png screenshots into
// [title]   optional single "Category/Name" to shoot (default: all stories)

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

const IFACE = 'org.gjsify.Devtools';

const [appId, outDir, onlyTitle] = ARGV;
if (!appId || !outDir) {
    printerr('usage: gjs -m tools/shoot-stories.js <app-id> <out-dir> [title]');
    imports.system.exit(2);
}
const objPath = '/' + appId.replace(/\./g, '/') + '/devtools';
GLib.mkdir_with_parents(outDir, 0o755);

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

function slug(title) {
    return title
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
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

// One screenshot attempt; returns the PNG bytes or null when not renderable yet.
function shootOnce() {
    try {
        const png = call('Screenshot', new GLib.Variant('(s)', ['']), '(ay)').recursiveUnpack()[0];
        return png && png.length > 0 ? png : null;
    } catch {
        return null;
    }
}

// Normalise window geometry, then WARM UP: the GSK renderer reports a zero-size
// window until the compositor has allocated + realised it. Poll until the first
// screenshot is non-empty so we don't race the heavy initial story-instantiation.
call('ResizeWindow', new GLib.Variant('(ii)', [1200, 800]), null);
let warm = false;
for (let i = 0; i < 40; i++) {
    call('PresentWindow', null, null);
    GLib.usleep(400000);
    if (shootOnce()) {
        warm = true;
        break;
    }
}
print(`[shoot] window ${warm ? 'ready' : 'NOT ready (continuing anyway)'}`);

const storiesJson = call('ListStories', null, '(s)').recursiveUnpack()[0];
const stories = JSON.parse(storiesJson);
const titles = (onlyTitle ? stories.filter((s) => s.title === onlyTitle) : stories).map((s) => s.title);
print(`[shoot] ${titles.length} story/stories to capture`);

let ok = 0;
const failures = [];
for (const title of titles) {
    try {
        const [opened] = call('OpenStory', new GLib.Variant('(s)', [title]), '(b)').recursiveUnpack();
        if (!opened) {
            failures.push(`${title}: OpenStory returned false`);
            continue;
        }
        // Retry: a freshly-switched story needs a frame to allocate + render.
        let png = null;
        for (let attempt = 0; attempt < 8 && !png; attempt++) {
            call('PresentWindow', null, null);
            GLib.usleep(350000);
            png = shootOnce();
        }
        if (!png) {
            failures.push(`${title}: empty screenshot`);
            continue;
        }
        const path = `${outDir}/${slug(title)}.png`;
        GLib.file_set_contents(path, png);
        ok++;
        print(`[shoot] ✔ ${title} -> ${path} (${png.length} bytes)`);
    } catch (e) {
        failures.push(`${title}: ${e}`);
    }
}

print(`[shoot] done: ${ok}/${titles.length} captured`);
if (failures.length) {
    printerr('[shoot] failures:\n  ' + failures.join('\n  '));
    imports.system.exit(failures.length === titles.length ? 1 : 0);
}
