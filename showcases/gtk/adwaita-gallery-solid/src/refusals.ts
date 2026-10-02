// SPDX-License-Identifier: MIT
//
// The other half of the gallery answer: the blocks that get NO framework snippet,
// and `gtk-host`'s own reason, READ OUT OF THE HOST rather than assumed.
//
// `ADWAITA_GALLERY_REFUSALS` in `scripts/adwaita-gallery-trees.mjs` says these
// gallery widgets refuse a child. That is a claim about the descriptor table on
// `main`, and a stale refusal is exactly as wrong as a missing snippet — it tells a
// reader a port cannot do something it now can. So it is measured, and IT ALREADY
// PAID: rebasing onto #1368 ("curate the five adaptive Adw containers") turned
// three of these green, and this probe is what said so rather than the gallery
// quietly shipping three refusals that had stopped being true.
//
//   ACCEPTED  <adw-clamp> took <gtk-label> — the refusal list is STALE
//   ACCEPTED  <adw-overlay-split-view> took <adw-toolbar-view> — the refusal list is STALE
//   refused   <adw-navigation-split-view> < <adw-toolbar-view>: rejected-child
//
// The third one is the interesting reading: `rejected-child` and NOT
// `uncurated-placement` means the container IS curated and the CHILD TYPE is wrong
// — GTK takes only an `Adw.NavigationPage` in those slots. All three are snippets
// now; only a wrong-type child stays here.
//
// The PATTERN rather than the incident is the point, and it has paid twice: curating
// `AdwExpanderRow` for `@gjsify/adwaita-react-native` turned `<adw-expander-row> <
// <adw-entry-row>` green the same way. The gallery block is a tree now and the
// placement left this list — noticed by the plain-Node arm of
// `check-generated-website-data.mjs`, which reads a refusal's GType against the
// descriptor directory and does not need the probe to run.
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

/**
 * Every placement the refusal list claims is impossible, as parent + child.
 *
 * A PLACEMENT LEAVES THIS LIST WHEN ITS PARENT IS CURATED *AND NOTHING ELSE LEDGES
 * IT* — and `<adw-wrap-box>` is the entry that did: it was probed here for as long as the
 * tag had no child policy, curating it made the gallery's refusal false, and arm 5b of
 * `check-generated-website-data.mjs` — the arm this probe's first payment argued for —
 * refused the pair in the same run, without needing the probe to run at all. The four GTK
 * layout containers at the bottom are the second shape: curating them made their gallery
 * refusals false too, but the ledger below took them over, and arm 5b's third arm refuses
 * a ledgered parent this list does not probe. So a curated placement with an entry in
 * {@link PLACEMENTS_NOT_IN_THE_GALLERY} STAYS here and is measured as ACCEPTED; a curated
 * placement with no such entry must leave, or that arm fails rather than the gallery
 * quietly losing a widget.
 */
const PLACEMENTS: readonly [parent: string, child: string][] = [
    ['adw-preferences-dialog', 'adw-preferences-page'],
    ['adw-bottom-sheet', 'gtk-box'],
    ['adw-carousel', 'gtk-label'],
    ['adw-sidebar', 'gtk-label'],
    ['adw-tab-view', 'gtk-label'],
    ['adw-toggle-group', 'gtk-label'],
    ['adw-view-switcher', 'gtk-label'],
    // The four GTK layout containers, curated together. They STAY in this list and are no
    // longer refusals — each is a TREE on the gallery now, so arm 5b's ledger
    // (`PLACEMENTS_NOT_IN_THE_GALLERY` below) is where the claim about them lives, and the
    // three arms of that arm read this list. They are still measured here, because a probe
    // of something no ledger explains is a pass about nothing, and because the trees write
    // exactly these placements.
    ['gtk-revealer', 'gtk-label'],
    ['gtk-paned', 'gtk-label'],
    ['gtk-expander', 'gtk-label'],
    ['gtk-center-box', 'gtk-label'],
    // `Gtk.Popover`'s content is its `child` PROPERTY, so nothing about the widget names it
    // — and the descriptor table curates no child policy for `GtkPopover`, which is the
    // refusal `ADWAITA_GALLERY_REFUSALS` states. Probed so arm 5b of
    // `check-generated-website-data.mjs` has something to measure rather than prose.
    ['gtk-popover', 'gtk-label'],
    // Curated by #1368, so this is no longer a PLACEMENT refusal — GTK refuses the
    // child TYPE. Kept because the gallery's tree depends on it: the split view's
    // slots take an `Adw.NavigationPage` and nothing else.
    ['adw-navigation-split-view', 'adw-toolbar-view'],
    // IS a gallery block of its own now (gtk/windows), and its tree is childless because every
    // child placement into it is refused — so this pair is the measurement behind that refusal.
    ['gtk-action-bar', 'gtk-button'],
];

/**
 * Placements probed here that are NOT a gallery block's refusal, with the reason.
 *
 * A LEDGER and not a comment, because `check-generated-website-data.mjs` holds this list
 * and `ADWAITA_GALLERY_REFUSALS` against each other: every placement below is either a
 * refusal the gallery makes or an entry here. Nothing held the two before, so a refusal
 * could claim `uncurated-placement` with nothing probing it, and a probe could measure a
 * placement no page refuses — in both directions, green.
 *
 * AND THE THREE DIRECTIONS IT IS READ IN. Arm 5b refuses a parent this ledger names that
 * {@link PLACEMENTS} does not probe, so an entry here is a MEASUREMENT as much as a claim,
 * and the four GTK layout containers below are the shape that finally made the difference
 * visible: curated, so their gallery blocks are TREES, and a tree is measured rather than
 * refused. The exit code at the bottom of the file reads the third direction — an ACCEPTED
 * placement this ledger does NOT explain is the stale-refusal alarm, and one it does is
 * the answer it was asked for.
 */
export const PLACEMENTS_NOT_IN_THE_GALLERY: Record<string, string> = {
    'adw-navigation-split-view':
        'curated by #1368, so this is no longer a PLACEMENT refusal — GTK refuses the child TYPE. Probed because the gallery TREE depends on it: the slots take an Adw.NavigationPage and nothing else.',
    // The four GTK layout containers, curated together, and the same reason in each: the
    // descriptor table now says how a child is adopted, so each gallery block is a TREE and
    // each pair in `PLACEMENTS` is ACCEPTED. `adw-navigation-split-view` above is the other
    // half of the shape — probed, ledgered, and refused by GTK — and these four are probed,
    // ledgered and accepted.
    'gtk-revealer':
        'curated, so this is no longer a refusal: GtkRevealer takes ONE child through set_child (gtkrevealer.c:666-679). Probed because the gallery TREE depends on that placement being accepted.',
    'gtk-paned':
        'curated, so this is no longer a refusal: GtkPaned routes "start" and "end" to set_start_child and set_end_child (gtkpaned.c:793-834). Probed because the gallery TREE writes both slots.',
    'gtk-expander':
        'curated, so this is no longer a refusal: GtkExpander routes a bare child to set_child and type="label" to set_label_widget (gtkexpander.c:449-465). Probed because the gallery TREE places the child.',
    'gtk-center-box':
        'curated, so this is no longer a refusal: GtkCenterBox routes three type names to three setters (gtkcenterbox.c:113-135). Probed because the gallery TREE writes all three slots.',
};

let refused = 0;
/** `{ parent, child }` — the shape the alarm at the bottom has to read. */
const accepted: { parent: string; child: string }[] = [];
for (const [parentTag, childTag] of PLACEMENTS) {
    const parent = createElement(parentTag);
    const child = createElement(childTag);
    try {
        insert(child, parent);
        // MATERIALISE, and this is the whole method. The host defers construction
        // (ADR 0027 § Decision 5), so `insert` alone only LINKS the node — measured:
        // every placement above "succeeded" at insert and the probe reported the
        // refusal list as stale, which is the green-that-checked-nothing shape in its
        // red-that-measured-nothing form. The placement is performed when the parent
        // becomes a widget, which is what a render does and what this now does.
        //
        // (That note said "all thirteen" and this list has held ELEVEN since the file
        // landed — thirteen is the count from before the two ACCEPTED placements in
        // the header left it. A number restated beside the list it counts is a copy,
        // and this one was already wrong when it was written, so it now names the
        // list instead of counting it.)
        materialize(parent);
        accepted.push({ parent: parentTag, child: childTag });
        // THE LINE NAMES THE LEDGER when there is one, because "STALE" is the wrong
        // word for a placement this file already EXPLAINS: the four GTK layout
        // containers are accepted because their blocks are trees, and the tree is the
        // answer rather than a contradiction of the list.
        print(
            Object.hasOwn(PLACEMENTS_NOT_IN_THE_GALLERY, parentTag)
                ? `ACCEPTED  <${parentTag}> took <${childTag}> — expected: it is ledgered in PLACEMENTS_NOT_IN_THE_GALLERY`
                : `ACCEPTED  <${parentTag}> took <${childTag}> — the refusal list is STALE`,
        );
    } catch (error) {
        refused += 1;
        const code = error instanceof GtkHostError ? error.code : 'not-a-GtkHostError';
        print(`refused   <${parentTag}> < <${childTag}>: ${code}`);
    }
}

// THE ALARM IS ABOUT WHAT NOTHING EXPLAINS. It used to be `accepted.length === 0`, which
// was the same rule while every accepted placement had LEFT `PLACEMENTS` — the rule the
// docblock above now states in full. Four entries stopped leaving it (curated, probed AND
// ledgered), so the old exit would have cried STALE forever on four placements that are
// the answer, not a contradiction. An acceptance this file's own
// {@link PLACEMENTS_NOT_IN_THE_GALLERY} accounts for is measured and expected; one it does
// not is the refusal list having stopped being true, and only that one exits 1.
const unexplained = accepted.filter(({ parent: p }) => !Object.hasOwn(PLACEMENTS_NOT_IN_THE_GALLERY, p));
print(
    `REFUSALS: ${refused}/${PLACEMENTS.length} refused, ${accepted.length} accepted ` +
        `(${unexplained.length} of them unexplained)`,
);
system.exit(unexplained.length === 0 ? 0 : 1);
