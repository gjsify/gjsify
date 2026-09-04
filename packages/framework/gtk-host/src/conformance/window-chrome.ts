// The window decoration a window may hold exactly ONCE, and what a composition that
// produced it twice looks like from outside.
//
// THE INVARIANT IS NOT "one header bar", and getting that wrong makes the check
// useless in both directions. Adwaita composes several header bars deliberately:
// every `AdwNavigationPage` in an `AdwNavigationView` carries its own, and
// `AdwNavigationSplitView` shows the sidebar's and the content's AT THE SAME TIME.
// What a window has exactly one of is its WINDOW CONTROLS — the close/maximize/
// minimize set GTK packs as a `GtkWindowControls`, once per side of the decoration
// layout. Two of them on one side is two close buttons, only one of which is the one
// the user means, and nothing on screen tells them apart.
//
// MEASURED on gjs 1.88.1 / GTK 4.22.4 / libadwaita 1.9.3, over four compositions
// built by hand (a nested-navigator stack of three header bars, the same tree with
// the chrome collapsed onto one, an `AdwNavigationSplitView`, and a detached tree):
//
//   - libadwaita hides NOTHING by itself. Three stacked `AdwHeaderBar`s in one window
//     produced three mapped, non-empty `GtkWindowControls` on the end side — three
//     close buttons, all drawn, all reachable.
//   - The split view is the discriminator the count has to survive: two MAPPED header
//     bars and exactly ONE non-empty `GtkWindowControls` per side, because libadwaita
//     splits the decoration layout across them. A check that counted header bars
//     would refuse Adwaita's own composition.
//   - MAPPED is the only honest reading. On the three-bar tree, counting controls
//     whose whole ancestor chain is `visible` answered FOUR: an `AdwNavigationPage`
//     that is pooled in the view but not on screen is `visible` and not mapped, so
//     its header bar counts as drawn. `get_mapped()` disagrees, correctly.
//   - An unmapped tree answers 0 to every count. A detached tree and an unpresented
//     window both read "no problem", which is the green-that-checked-nothing shape —
//     so `windowChromeProblems` REFUSES an unmapped root instead of clearing it.
//
// THE INVARIANT IS ABOUT THE RESTING COMPOSITION, which is the one false positive a
// caller will hit. `Adw.NavigationView` keeps the DEPARTING page mapped while the
// arriving one slides in, so a window mid-push legitimately draws two header bars and
// two sets of controls — measured, four of each at the moment a nested tab group is
// entered. Ask after the transition, or turn transitions off for the measurement;
// iterating the main context does not advance the clock enough to wait one out.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { descendants } from './tree.js';

/** GType name of a widget, without asking the widget to be anything in particular. */
const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/** What a window's chrome actually draws, per side of the decoration layout. */
export interface WindowChromeCensus {
    /** Mapped, non-empty `GtkWindowControls` packed at the start of their header bar. */
    readonly start: number;
    /** The same at the end. On a GNOME host with a `:close` layout this is the close button. */
    readonly end: number;
    /** Mapped header bars, for the report. NOT the invariant — see the header. */
    readonly headerBars: number;
    /** Whether the root is mapped at all, i.e. whether the three counts mean anything. */
    readonly mapped: boolean;
}

const isHeaderBar = (name: string): boolean => name === 'AdwHeaderBar' || name === 'GtkHeaderBar';

/**
 * Count what the window's chrome draws.
 *
 * `get_empty()` is asked as well as `get_mapped()` because a `GtkWindowControls` is
 * mapped on both sides of every header bar and draws buttons only on the side the
 * decoration layout puts them: measured, a GNOME `:close` layout leaves six of the
 * eight controls in a three-bar window empty and invisible.
 */
export function windowChromeCensus(root: Gtk.Widget): WindowChromeCensus {
    let start = 0;
    let end = 0;
    let headerBars = 0;
    for (const widget of descendants(root)) {
        const name = typeOf(widget);
        if (isHeaderBar(name)) {
            if (widget.get_mapped()) headerBars++;
            continue;
        }
        if (name !== 'GtkWindowControls') continue;
        const controls = widget as unknown as Gtk.WindowControls;
        if (!controls.get_mapped() || controls.get_empty()) continue;
        if (controls.get_side() === Gtk.PackType.START) start++;
        else end++;
    }
    return { start, end, headerBars, mapped: root.get_mapped() };
}

/**
 * Every way this window's chrome is wrong, in sentences.
 *
 * An empty array is the only clean answer, and it is not reachable by accident: an
 * unmapped root and a window whose chrome draws nothing at all are both named, so
 * "no duplicates" cannot be produced by a tree that draws no chrome to duplicate.
 */
export function windowChromeProblems(root: Gtk.Widget): string[] {
    const census = windowChromeCensus(root);
    const where = typeOf(root);
    if (!census.mapped) {
        return [
            `${where} is not mapped, so nothing under it draws yet and every count is 0 — present() the window ` +
                'before asking, or this reads as green having measured nothing',
        ];
    }
    const problems: string[] = [];
    const seen = `${census.headerBars} mapped header bar(s)`;
    for (const [side, count] of [
        ['start', census.start],
        ['end', census.end],
    ] as const) {
        if (count <= 1) continue;
        problems.push(
            `${count} sets of window controls draw at the ${side} of their header bar in this ${where}, and a ` +
                `window has one — ${count - 1} of those close buttons close nothing the user is looking at (${seen})`,
        );
    }
    if (census.start + census.end === 0) {
        problems.push(
            `no window control draws anywhere in this ${where}, so its chrome offers no way to close or move it ` +
                `(${seen}) — an Adwaita window carries no titlebar of its own, so a header bar has to`,
        );
    }
    return problems;
}
