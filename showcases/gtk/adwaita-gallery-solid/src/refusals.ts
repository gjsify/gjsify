// SPDX-License-Identifier: MIT
//
// The other half of the gallery answer: the blocks that get NO framework snippet,
// and `gtk-host`'s own reason, READ OUT OF THE HOST rather than assumed.
//
// `ADWAITA_GALLERY_REFUSALS` in `scripts/adwaita-gallery-trees.mjs` says thirteen
// gallery widgets refuse a child with `uncurated-placement`. That is a claim about
// the descriptor table on `main`, it moves when the table does (PR #1368 curates
// `AdwClamp`), and a stale refusal is exactly as wrong as a missing snippet — it
// tells a reader a port cannot do something it now can. So it is measured.
//
// This is deliberately NOT a JSX file: the refusal comes from the HOST's placement
// policy, not from any adapter's compiler, so driving it through `createElement` +
// `insert` asks the question with nothing else in the way.

import Gtk from 'gi://Gtk?version=4.0';
import system from 'system';

import { createElement, GtkHostError, insert, materialize, registerBuiltinWidgets } from '@gjsify/gtk-host';
import { installDiagnosticsGate } from '@gjsify/gtk-host/conformance';

declare const print: (message: string) => void;

registerBuiltinWidgets();
Gtk.init();
installDiagnosticsGate().reset();

/** Every placement the refusal list claims is impossible, as parent + child. */
const PLACEMENTS: readonly [parent: string, child: string][] = [
    ['adw-clamp', 'gtk-label'],
    ['adw-wrap-box', 'gtk-button'],
    ['adw-preferences-dialog', 'adw-preferences-page'],
    ['adw-navigation-split-view', 'adw-toolbar-view'],
    ['adw-overlay-split-view', 'adw-toolbar-view'],
    ['adw-bottom-sheet', 'gtk-box'],
    ['adw-carousel', 'gtk-label'],
    ['adw-expander-row', 'adw-entry-row'],
    ['adw-sidebar', 'gtk-label'],
    ['adw-tab-view', 'gtk-label'],
    ['adw-toggle-group', 'gtk-label'],
    ['adw-view-switcher', 'gtk-label'],
    // Not a gallery block of its own, but the reason `Adw.ToolbarView`'s bottom bar
    // is a styled box in every framework snippet while the GJS and Blueprint tabs
    // use the real thing.
    ['gtk-action-bar', 'gtk-button'],
];

let refused = 0;
const accepted: string[] = [];
for (const [parentTag, childTag] of PLACEMENTS) {
    const parent = createElement(parentTag);
    const child = createElement(childTag);
    try {
        insert(child, parent);
        // MATERIALISE, and this is the whole method. The host defers construction
        // (ADR 0027 § Decision 5), so `insert` alone only LINKS the node — measured:
        // all thirteen placements below "succeeded" at insert and the probe reported
        // the refusal list as stale, which is the green-that-checked-nothing shape in
        // its red-that-measured-nothing form. The placement is performed when the
        // parent becomes a widget, which is what a render does and what this now does.
        materialize(parent);
        accepted.push(`${parentTag} < ${childTag}`);
        print(`ACCEPTED  <${parentTag}> took <${childTag}> — the refusal list is STALE`);
    } catch (error) {
        refused += 1;
        const code = error instanceof GtkHostError ? error.code : 'not-a-GtkHostError';
        print(`refused   <${parentTag}> < <${childTag}>: ${code}`);
    }
}

print(`REFUSALS: ${refused}/${PLACEMENTS.length} refused, ${accepted.length} accepted`);
system.exit(accepted.length === 0 ? 0 : 1);
