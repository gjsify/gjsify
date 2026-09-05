// SPDX-License-Identifier: MIT
//
// Renders this showcase's window to PNG, so the README's pictures are
// REGENERATED rather than remembered.
//
// WHY IT EXISTS AT ALL. `@gjsify/gtk-host`'s probe harness records the incident
// behind this: a tree whose assertions all passed rendered an EMPTY window, exit 0,
// zero GTK diagnostics, because the only witness to "did this draw" is the window.
// `app.ts` asserts the tree; this draws it. A screenshot pasted into a README once
// and never regenerated is the same class of claim as a comment with a live count
// in it — true when written, unfalsifiable afterwards.
//
// It captures through `captureWidgetPng` (`Gtk.WidgetPaintable` → `render_texture`
// → `save_to_png_bytes`), not through the compositor, so it needs no screenshot
// portal and produces the same bytes on a headless runner as on a desktop.
//
// THE WINDOW MUST BE PRESENTED for that to work — `get_native().get_renderer()` is
// null until it is — and on a live session a presented window TAKES KEYBOARD FOCUS.
// Measured while making these very images: a stray keystroke from the session
// landed in the path entry, the read failed on a relative path, and the picture was
// wrong in a way only a careful reader would catch. So the text is re-read
// immediately before every capture and a mismatch REFUSES rather than saves.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { captureWidgetPng } from '@gjsify/devtools';

import { EffectServicesWindow } from './window.js';

declare const print: (message: string) => void;
declare const printerr: (message: string) => void;

/** Where the images land. `docs/` is the convention the storybook showcase set. */
const OUT_DIR = GLib.getenv('SHOT_DIR') ?? `${GLib.get_current_dir()}/docs`;

/** `<name>=<path>` pairs. The defaults are the two states worth a picture. */
const SHOTS: ReadonlyArray<readonly [string, string]> = (
    GLib.getenv('SHOT_PATHS') ?? 'listing=/etc,not-found=/etc/nope-such-directory'
)
    .split(',')
    .map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)] as const;
    });

/** 250 ms debounce + the read + a frame to draw it, with room to spare. */
const SETTLE_MS = 1200;

let failures = 0;

const capture = (window: EffectServicesWindow, name: string, expected: string): void => {
    const actual = window.pathEntry.get_text();
    if (actual !== expected) {
        // Not a retry: a contaminated entry means the session typed into the window,
        // and the next attempt is no less exposed than this one.
        printerr(`shot ${name}: entry reads ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
        failures++;
        return;
    }
    const png = captureWidgetPng(window);
    if (png === null) {
        printerr(`shot ${name}: no renderer — the window is not realized`);
        failures++;
        return;
    }
    const file = Gio.File.new_for_path(`${OUT_DIR}/${name}.png`);
    file.replace_contents(png, null, false, Gio.FileCreateFlags.NONE, null);
    print(`shot ${name}: ${png.length} bytes → ${file.get_path()} · ${window.state.outcome._tag}`);
};

const app = new Adw.Application({ application_id: 'eu.jumplink.EffectAdwServicesShot' });

app.connect('activate', () => {
    app.hold();
    const window = new EffectServicesWindow({ application: app, defaultWidth: 620, defaultHeight: 660 });
    window.present();

    let index = 0;
    const next = (): boolean => {
        if (index >= SHOTS.length) {
            window.close();
            app.release();
            app.quit();
            return GLib.SOURCE_REMOVE;
        }
        const [name, path] = SHOTS[index];
        index++;
        window.pathEntry.set_text(path);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            capture(window, name, path);
            return next();
        });
        return GLib.SOURCE_REMOVE;
    };

    // Let the window allocate before the first keystroke: a capture before the
    // first frame returns null, which reads as "the tree is empty".
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, next);
});

await app.runAsync([]);

if (failures > 0) printerr(`shot: ${failures} capture(s) refused`);
