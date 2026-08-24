// SPDX-License-Identifier: MIT
//
// The `adw-host-counter` window again — this time written as SolidJS JSX and
// compiled by `@gjsify/rolldown-plugin-solid`, so the two showcases are a
// deliberate A/B: same widgets, same assertions, one imperative through the host
// ops and one through a real framework compiler.
//
// WHAT ONLY THIS SHOWCASE CAN PROVE. `gtk-host`'s type surface is gated by
// `scripts/check-type-surfaces.mjs`, and that gate says so itself: "Nothing about
// RUNTIME." Until this file existed, nothing anywhere compiled a single line of
// JSX. The build step is the part that can fail silently — pointed at a `.tsx`
// with no JSX configuration, Rolldown's transformer defaults to the automatic
// React runtime, emits `import { jsx } from "react/jsx-runtime"`, reports the
// unresolved import as a WARNING and exits 0. So the artifact exists, the CI leg
// is green, and the app dies at its first import under GJS.
//
// THE COMPILER'S OUTPUT SHAPE, measured on this file's own markup:
//
//   var _el$ = _$createElement("adw-application-window"), _el$2 = …;
//   _$insertNode(_el$, _el$2);
//   _$setProp(_el$, "title", "solid-host counter");
//
// Children are inserted BEFORE properties are set, and `createElement` never sees
// a prop — which is why construct-only properties cannot be an adapter's problem
// and the host defers materialisation (ADR 0027 § Decision 5). `cssName` below is
// that claim made executable: it is construct-only on every GtkWidget, it is
// authored as a plain JSX attribute, and the probe reads it back off the real
// widget.
//
// SELF-VERIFYING ON EVERY LAUNCH, like its sibling. `GJSIFY_HOST_PROBE=1` runs
// the assertions headlessly and exits; the GUI path runs the SAME assertions from
// `activate` before the window is shown, so `scripts/showcase-smoke.mjs` — which
// only launches and waits — carries them. A throw inside a GLib callback prints
// `JS ERROR` and lets the process exit 0, and that marker is exactly what the
// smoke gate greps for.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * Every GLib/GTK diagnostic this process emits, captured rather than merely
 * printed — GTK's failure mode is exit 0, so a mis-parented tree has to be read
 * out of the log rather than out of the exit code. Identical mechanism to
 * `adw-host-counter`; see that file for why the writer forwards instead of
 * swallowing.
 */
const diagnostics: string[] = [];
const decoder = new TextDecoder();
const verboseLogging = GLib.getenv('G_MESSAGES_DEBUG') !== null;

GLib.log_set_writer_func((level, fields) => {
    try {
        const raw = (fields as unknown as { MESSAGE?: unknown } | null)?.MESSAGE;
        const message = raw instanceof Uint8Array ? decoder.decode(raw) : String(raw ?? '');
        // MASK the level: `g_logv` ORs in `G_LOG_FLAG_FATAL`, so `WARNING|FATAL`
        // is 18 and an unmasked `<= 16` misses it under `--g-fatal-warnings`.
        const severity = level & GLib.LogLevelFlags.LEVEL_MASK;
        if (severity <= GLib.LogLevelFlags.LEVEL_WARNING) diagnostics.push(message);
        if (verboseLogging || severity <= GLib.LogLevelFlags.LEVEL_MESSAGE) printerr(message);
    } catch {
        printerr('<solid-host probe: a log message could not be decoded>');
    }
    return GLib.LogWriterOutput.HANDLED;
});

import { createRoot, createSignal } from 'solid-js';

import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren } from '@gjsify/gtk-host/conformance';
import { For, widgetOf } from '@gjsify/gtk-host/solid';
import type { HostNode } from '@gjsify/gtk-host';

registerBuiltinWidgets();

interface Row {
    readonly id: number;
    readonly title: string;
}

interface Ui {
    readonly node: HostNode;
    readonly increment: () => void;
    readonly addRow: () => void;
    readonly removeFirstRow: () => void;
    readonly count: () => number;
}

/**
 * The whole UI as one JSX expression.
 *
 * `<For>` comes from the ADAPTER, not from `solid-js/web`: `solid-js/web` is the
 * DOM renderer and its components build DOM elements nobody here can place — the
 * measured result is a subtree that renders nothing, silently, at exit 0.
 */
function buildUi(app: Adw.Application | null): Ui {
    const [count, setCount] = createSignal(0);
    const [rows, setRows] = createSignal<readonly Row[]>([]);
    let nextRow = 1;

    const increment = () => setCount((n) => n + 1);
    const addRow = () => {
        const id = nextRow;
        nextRow += 1;
        setRows((current) => [...current, { id, title: `Row ${id}` }]);
    };
    const removeFirstRow = () => setRows((current) => current.slice(1));

    const node = (
        <adw-application-window
            title="solid-host counter"
            defaultWidth={480}
            defaultHeight={520}
            application={app ?? undefined}
        >
            <adw-toolbar-view>
                <adw-header-bar slot="top">
                    <gtk-label label="Built by SolidJS JSX" slot="title" />
                </adw-header-bar>
                <adw-preferences-page slot="content">
                    <adw-preferences-group title="Rows">
                        {/* Rendered BEFORE the counter row on purpose: Adw.PreferencesGroup
                            has no `insert()`, so the policy degrades to `remove-all` and the
                            host has to replay the tail. Solid's anchored insertion is what
                            makes that path run at all. */}
                        <For each={rows()}>
                            {(row) => <adw-action-row title={row.title} subtitle="added at runtime" />}
                        </For>
                        {/* `cssName` is construct-only. The compiler sets it AFTER
                            `createElement`, so this attribute only survives because the host
                            defers materialisation. */}
                        <adw-action-row title="Clicks" subtitle={String(count())} cssName="row" />
                    </adw-preferences-group>
                    <adw-preferences-group title="Actions">
                        {/* `orientation="vertical"` as a STRING is the case GObject drops
                            silently; the host resolves the nick against GtkOrientation. */}
                        <gtk-box orientation="vertical" spacing={12} marginTop={12}>
                            <gtk-button label="Increment" halign="center" onClicked={increment} />
                            <gtk-button label="Add row" halign="center" onClicked={addRow} />
                            <gtk-button label="Remove first row" halign="center" onClicked={removeFirstRow} />
                        </gtk-box>
                    </adw-preferences-group>
                </adw-preferences-page>
            </adw-toolbar-view>
        </adw-application-window>
    ) as HostNode;

    return { node, increment, addRow, removeFirstRow, count };
}

/** First descendant matching `pred`, breadth-first over the REAL widget tree. */
function findDescendant(root: Gtk.Widget, pred: (w: Gtk.Widget) => boolean): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [root];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (widget !== root && pred(widget)) return widget;
        queue.push(...gtkChildren(widget));
    }
    return null;
}

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
function rowTitles(root: Gtk.Widget): string[] {
    const found: string[] = [];
    const walk = (widget: Gtk.Widget) => {
        if (widget instanceof Adw.ActionRow) found.push(widget.title);
        for (const child of gtkChildren(widget)) walk(child);
    };
    walk(root);
    return found;
}

function runProbe(): number {
    // Start from zero: in the GUI path this runs from `activate`, after Adw
    // startup, where a portal/theme/a11y warning is routine in a container.
    diagnostics.length = 0;

    const failures: string[] = [];
    const check = (what: string, ok: boolean) => {
        if (!ok) failures.push(what);
    };

    // `createRoot` and not bare JSX: every `{count()}` in the markup above
    // compiles to a computation, and a computation created without an owner is
    // never disposed — Solid says so on stderr, and this showcase counts stderr.
    const ui = createRoot(() => buildUi(null));
    const window = widgetOf(ui.node);

    // 1. The string enum nick reached GTK. GObject would have kept HORIZONTAL, so
    //    read the property back — materialisation always returns something.
    const box = findDescendant(window, (w) => w instanceof Gtk.Box) as Gtk.Box | null;
    check('a GtkBox was built from JSX', box !== null);
    check("orientation='vertical' reached GTK", box?.orientation === Gtk.Orientation.VERTICAL);

    // 2. Slotted placement authored as a JSX attribute.
    check('AdwToolbarView is in the window', findDescendant(window, (w) => w instanceof Adw.ToolbarView) !== null);
    check('AdwHeaderBar is in the window', findDescendant(window, (w) => w instanceof Adw.HeaderBar) !== null);

    // 3. A CONSTRUCT-ONLY property authored in JSX survived, although the
    //    compiler sets every property after `createElement`.
    const clicks = findDescendant(
        window,
        (w) => w instanceof Adw.ActionRow && w.title === 'Clicks',
    ) as Adw.ActionRow | null;
    check('the counter row was built', clicks !== null);
    check('construct-only cssName survived deferred materialisation', clicks?.cssName === 'row');

    // 4. A signal bound by the COMPILER (`setProp(el, "onClicked", fn)`) is
    //    connected to the real widget. Emitted on GTK's side, not by calling the
    //    handler — calling it would prove only that the closure exists.
    const incrementButton = findDescendant(
        window,
        (w) => w instanceof Gtk.Button && w.label === 'Increment',
    ) as Gtk.Button | null;
    check('the increment button was built', incrementButton !== null);
    incrementButton?.emit('clicked');
    check('clicking updated the subtitle through the signal', clicks?.subtitle === '1');
    check('the signal ran exactly once', ui.count() === 1);

    // 5. `<For>` inserts before the static sibling, through the `remove-all`
    //    degradation, and removal takes the right row out.
    ui.addRow();
    ui.addRow();
    check(
        'rows land before the counter row',
        JSON.stringify(rowTitles(window)) === JSON.stringify(['Row 1', 'Row 2', 'Clicks']),
    );
    ui.removeFirstRow();
    check(
        'removing the first row leaves the rest in order',
        JSON.stringify(rowTitles(window)) === JSON.stringify(['Row 2', 'Clicks']),
    );

    // 6. …and none of it may have been reported to GLib.
    check(`no GTK diagnostics (saw ${diagnostics.length})`, diagnostics.length === 0);

    const report = {
        rows: rowTitles(window),
        count: ui.count(),
        diagnostics: diagnostics.length,
        tree: dumpTree(window).split('\n').length,
    };
    if (failures.length > 0) {
        print(`PROBE: FAIL ${JSON.stringify({ failures, ...report })}`);
        return 1;
    }
    print(`PROBE: PASS ${JSON.stringify(report)}`);
    return 0;
}

if (GLib.getenv('GJSIFY_HOST_PROBE') === '1') {
    // Headless one-shot: assert and exit, no window, no main loop.
    Gtk.init();
    imports.system.exit(runProbe());
} else {
    const app = new Adw.Application({ application_id: 'eu.jumplink.SolidHostCounter' });
    app.connect('activate', () => {
        const failed = runProbe();
        if (failed !== 0) imports.system.exit(failed);

        const ui = createRoot(() => buildUi(app));
        (widgetOf(ui.node) as Adw.ApplicationWindow).present();
    });
    await app.runAsync([]);
}
