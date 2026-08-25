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
// SELF-VERIFYING ON EVERY LAUNCH, like its sibling, through the SAME harness:
// `runHostProbeApp` from `@gjsify/gtk-host` owns the env gate, the diagnostics
// collector, the `check()` recorder, the `PROBE: PASS|FAIL <json>` protocol and
// the rule that the GUI path runs the same assertions before presenting. This file
// used to carry 68 lines of that, 58 of them byte-identical to the sibling's copy.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { createRoot, createSignal } from 'solid-js';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { descendants, dumpTree, findDescendant } from '@gjsify/gtk-host/conformance';
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

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
const rowTitles = (root: Gtk.Widget): string[] =>
    descendants(root)
        .filter((w): w is Adw.ActionRow => w instanceof Adw.ActionRow)
        .map((row) => row.title);

/** Everything this showcase claims, read back off the REAL widget tree. */
function assertUi(ui: Ui, check: ProbeCheck): Record<string, unknown> {
    const window = widgetOf(ui.node);

    // The button is found FIRST because two later checks reach the tree through it
    // rather than through a type search. See check 1.
    const incrementButton = findDescendant(
        window,
        (w) => w instanceof Gtk.Button && w.label === 'Increment',
    ) as Gtk.Button | null;
    check('the increment button was built', incrementButton !== null);

    // 1. The string enum nick reached GTK. GObject would have kept HORIZONTAL, so
    //    read the property back — materialisation always returns something.
    //
    //    Reached through the BUTTON, not as "the first Gtk.Box in the window":
    //    Adwaita builds internal boxes, and this window's first one by breadth is
    //    inside the header bar. MEASURED: with the search-by-type version, authoring
    //    `orientation="horizontal"` here still printed PROBE: PASS with byte-identical
    //    output, because the box it read was never the one this file declares.
    const box = incrementButton?.get_parent() as Gtk.Box | null;
    check('the JSX box is the button parent', box instanceof Gtk.Box);
    check("orientation='vertical' reached GTK", box?.orientation === Gtk.Orientation.VERTICAL);

    // 2. Slotted placement authored as a JSX attribute — asserted as PLACEMENT, not
    //    as presence. MEASURED: the presence version passed with `slot="bottom"` on
    //    the header bar, i.e. with the header genuinely rendered at the foot of the
    //    window, output byte-identical. A slot that is never read is the whole point
    //    of the attribute, so "it is somewhere in the subtree" asserts nothing.
    const toolbarView = findDescendant(window, (w) => w instanceof Adw.ToolbarView) as Adw.ToolbarView | null;
    check('AdwToolbarView is in the window', toolbarView !== null);
    //    `slot="content"` is exact: AdwToolbarView has a real getter for it.
    check('slot="content" placed the page', toolbarView?.get_content() instanceof Adw.PreferencesPage);

    const headerBar = findDescendant(window, (w) => w instanceof Adw.HeaderBar) as Adw.HeaderBar | null;
    check('AdwHeaderBar is in the window', headerBar !== null);
    //    `slot="top"` has no getter — `add_top_bar` is write-only and the height
    //    getters read 0 until the window is allocated, which a headless probe never
    //    does. What IS readable is the style class Adwaita puts on the revealer it
    //    wraps each bar in: `top-bar` or `bottom-bar` (measured, gjs 1.88.1). Walking
    //    up to the toolbar view and looking for it separates the two slots, which no
    //    subtree search can.
    const topBarClassAbove = (widget: Gtk.Widget | null): boolean => {
        for (let w = widget; w !== null && w !== toolbarView; w = w.get_parent()) {
            if (w.get_css_classes().includes('top-bar')) return true;
        }
        return false;
    };
    check('slot="top" put the header in the TOP bar', topBarClassAbove(headerBar));
    //    `slot="title"` was authored and never asserted: deleting the label left the
    //    probe green. AdwHeaderBar has an exact getter for this one.
    const titleWidget = headerBar?.get_title_widget();
    check(
        'slot="title" placed the header label',
        titleWidget instanceof Gtk.Label && titleWidget.label === 'Built by SolidJS JSX',
    );

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

    return { rows: rowTitles(window), count: ui.count(), tree: dumpTree(window).split('\n').length };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.SolidHostCounter',
    // `createRoot` and not bare JSX: every `{count()}` in the markup above compiles
    // to a computation, and a computation created without an owner is never disposed
    // — Solid says so on stderr, and the harness counts stderr.
    build: (app) => createRoot(() => buildUi(app)),
    assert: assertUi,
    present: (ui) => (widgetOf(ui.node) as Adw.ApplicationWindow).present(),
});
