/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK halves of the five boxed-list rows, against the libadwaita that is installed.
//
// ONE FILE FOR FIVE WIDGETS, matching `rows.native.spec.tsx` describe for describe: every
// claim here has a counterpart there, and a pair only reads as a pair if both halves are
// written where the same reader finds them.
//
// WHAT THIS HALF IS FOR. The React Native suite asserts what a widget ASKS FOR — a style
// object, a prop handed to `Pressable`. This one asserts what the real widget ANSWERS:
// `activatable` read back off `Adw.ActionRow`, `active` off `Adw.SwitchRow`, `text` off
// `Adw.EntryRow` after libadwaita's own max-length truncation. Three of those numbers are
// the same numbers on both sides, and that is the whole claim of the package.
//
// EVERY DESCRIBE IS GATED BY `installDiagnosticsGate`, because GTK's failure mode is exit
// 0: a property GObject refuses, a child placed where no policy accepts it and a widget
// that never renders all leave a green suite behind a `GLib-…-CRITICAL` nobody reads.
//
// The harness is `../testing/gtk.spec.tsx` — the realised, pumped window, the tree search,
// the GType name, the diagnostics gate. The reason a widget must be in a REALISED, sized
// window before anything about it can be measured is written down there. What is local
// below is only what the ROWS need: the boxed list they have to be mounted inside, and a
// BLOCKING settle the shared one deliberately does not do.

import type Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { BUTTON_ROW_ACTIVATABLE } from '@gjsify/adwaita-core';
import { blankReason, shotEvidence } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren } from '@gjsify/gtk-host/conformance';

import { capture, find, laidOut as laidOutBare, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwActionRow } from './action-row.gtk.js';
import { AdwButtonRow } from './button-row.gtk.js';
import { AdwEntryRow } from './entry-row.gtk.js';
import { AdwExpanderRow } from './expander-row.gtk.js';
import { AdwSwitchRow } from './switch-row.gtk.js';

/** The frame the rows are laid out in — narrow enough that a row is not the window. */
const FRAME_WIDTH = 600;
const FRAME_HEIGHT = 200;

/**
 * What the boxed list takes off the frame width before a row sees it — 2 points of frame
 * on each side, measured on libadwaita 1.9.3 through `<adw-preferences-group>`.
 */
const BOXED_LIST_INSET = 4;

/**
 * Mount into a REALISED, sized window INSIDE A BOXED LIST, let GTK lay out, run the body.
 *
 * THE `<adw-preferences-group>` IS NOT DECORATION, and it took the diagnostics gate to
 * say so. Every widget in this file is a `GtkListBoxRow`, and presenting one that is not
 * inside a `Gtk.ListBox` raises `gtk_list_box_row_grab_focus: assertion 'box != NULL'
 * failed` the moment the window hands out initial focus — measured on gjs 1.88.1 /
 * libadwaita 1.9.3, and it took ten of these tests down at once. It is a CRITICAL, so
 * without the gate it would have been a line of stderr under a green suite; and it is a
 * fact about the widgets rather than about the harness, which is why the fix is to mount
 * them the way an application does rather than to quieten the assertion. The two rows
 * that survived it are the entry row's, because its embedded `GtkText` takes the focus
 * before the row is asked for it — the same defect hiding behind a different child.
 */
function laidOut(
    element: React.ReactNode,
    body: (container: Gtk.Widget, rerender: (next: React.ReactNode) => void) => void,
): void {
    const inGroup = (node: React.ReactNode): React.ReactNode => <adw-preferences-group>{node}</adw-preferences-group>;
    laidOutBare(
        inGroup(element),
        (container, _window, rerender) => body(container, (next) => rerender(inGroup(next))),
        { frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT },
    );
}

/** Every `Gtk.Label` in the real tree, by its text — the rows build their own. */
function labelTexts(root: Gtk.Widget): string[] {
    const found: string[] = [];
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel') found.push((widget as Gtk.Label).label);
        queue.push(...gtkChildren(widget));
    }
    return found;
}

/** The first `Gtk.Label` in the real tree carrying `text` — the rows build their own. */
function findLabel(root: Gtk.Widget, text: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel' && (widget as Gtk.Label).label === text) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no GtkLabel "${text}" under:\n${dumpTree(root)}`);
}

/** The GTypes between `widget` and `stop`, nearest first — WHERE a child landed. */
function ancestry(widget: Gtk.Widget, stop: Gtk.Widget): string[] {
    const found: string[] = [];
    for (let parent = widget.get_parent(); parent !== null && parent !== stop; parent = parent.get_parent()) {
        found.push(typeOf(parent));
    }
    return found;
}

/**
 * Pump the main loop until `done()`, or give up after two seconds and let the assertion
 * report what it found.
 *
 * `while (context.pending()) context.iteration(false)` — what `laidOut` uses for the
 * initial layout — CANNOT do this one, and the difference is measured. A `Gtk.Revealer`
 * reveals off the frame clock; with no source ready, `pending()` is false immediately, so
 * a non-blocking spin returns in microseconds having advanced nothing: 200 such rounds
 * left the disclosed child mapped and still allocated 0×0. `iteration(true)` waits for
 * the next frame, and with animations off the reveal settles in about 8 ms.
 */
function settle(done: () => boolean): void {
    const context = GLib.MainContext.default();
    const deadline = GLib.get_monotonic_time() + 2_000_000;
    while (!done() && GLib.get_monotonic_time() < deadline) context.iteration(true);
}

export default async () => {
    await withGtk(async ({ gated, display }) => {
        await gated('the boxed-list rows are the real libadwaita ones', async () => {
            await it('renders AdwActionRow with both labels and its suffix child', async () => {
                laidOut(
                    <AdwActionRow title="Wi-Fi" subtitle="Connected">
                        <gtk-label label="suffix" />
                    </AdwActionRow>,
                    (container) => {
                        const row = find(container, 'AdwActionRow') as Adw.ActionRow;
                        expect(row.title).toBe('Wi-Fi');
                        expect(row.subtitle).toBe('Connected');
                        // The child reached the row's own tree — `add_suffix`, which is
                        // gtk-host's curated default slot for this GType.
                        expect(labelTexts(row)).toContain('suffix');
                    },
                );
            });

            await it('leaves AdwActionRow unactivatable, which is its template’s default', async () => {
                // The same `false` `rows.native.spec.tsx` reads as `disabled: true` on the
                // `Pressable`, and the reason neither half invents a default.
                laidOut(<AdwActionRow title="Wi-Fi" />, (container) => {
                    expect((find(container, 'AdwActionRow') as Adw.ActionRow).activatable).toBe(false);
                });
            });

            await it('takes `activatable` to the row', async () => {
                laidOut(<AdwActionRow title="Wi-Fi" activatable={true} />, (container) => {
                    expect((find(container, 'AdwActionRow') as Adw.ActionRow).activatable).toBe(true);
                });
            });

            await it('renders AdwButtonRow, which the installed libadwaita makes activatable', async () => {
                // This is `BUTTON_ROW_ACTIVATABLE` measured rather than asserted:
                // `rows.native.spec.tsx` reads the constant out of `@gjsify/adwaita-core`
                // and this row reads the same answer off the real widget. If libadwaita
                // ever grew an opt-out, one of the two would move without the other.
                laidOut(<AdwButtonRow title="Add Account" />, (container) => {
                    const row = find(container, 'AdwButtonRow') as Adw.ButtonRow;
                    expect(row.title).toBe('Add Account');
                    expect(row.activatable).toBe(BUTTON_ROW_ACTIVATABLE);
                });
            });

            await it('renders AdwSwitchRow with its value and its init-time activatability', async () => {
                laidOut(<AdwSwitchRow title="Developer mode" subtitle="For debugging" active={true} />, (container) => {
                    const row = find(container, 'AdwSwitchRow') as Adw.SwitchRow;
                    expect(row.title).toBe('Developer mode');
                    expect(row.subtitle).toBe('For debugging');
                    expect(row.active).toBe(true);
                    // `adw_switch_row_init` makes the ROW activatable and points its
                    // activatable-widget at the slider — the rule the React Native half
                    // spells as a press on the row inverting the value.
                    expect(row.activatable).toBe(true);
                });
            });

            await it('renders AdwExpanderRow, and its default child is a DISCLOSED row', async () => {
                laidOut(
                    <AdwExpanderRow title="Advanced" subtitle="More options">
                        <adw-action-row title="disclosed" />
                        <gtk-label slot="suffix" label="sfx" />
                    </AdwExpanderRow>,
                    (container) => {
                        const row = find(container, 'AdwExpanderRow') as Adw.ExpanderRow;
                        expect(row.title).toBe('Advanced');
                        expect(row.subtitle).toBe('More options');
                        // libadwaita's own default, and the one the React Native half
                        // seeds `ExpanderState` with.
                        expect(row.expanded).toBe(false);

                        // WHERE each child landed, not just that both are present. This
                        // is what the curated descriptor added in this change decides: an
                        // unslotted child goes through `add_row` and lands under the
                        // REVEALER, `slot="suffix"` goes through `add_suffix` and lands
                        // inside the header `AdwActionRow`. Measured on libadwaita 1.9.3
                        // — before the descriptor, both were an `uncurated-placement`
                        // refusal, because the generated table knows the tag and no
                        // placement, and `set_child` (inherited from `GtkListBoxRow`)
                        // exists and would have replaced the template.
                        expect(ancestry(findLabel(row, 'disclosed'), row)).toStrictEqual([
                            'GtkBox',
                            'GtkBox',
                            'AdwActionRow',
                            'GtkListBox',
                            'GtkRevealer',
                            'GtkBox',
                        ]);
                        expect(ancestry(findLabel(row, 'sfx'), row)).toStrictEqual([
                            'GtkBox',
                            'GtkBox',
                            'GtkBox',
                            'AdwActionRow',
                            'GtkListBox',
                            'GtkBox',
                        ]);
                    },
                );
            });

            await it('renders AdwEntryRow carrying its four properties', async () => {
                laidOut(
                    <AdwEntryRow
                        title="Endpoint"
                        text="https://example.invalid"
                        editable={false}
                        showApplyButton={true}
                    />,
                    (container) => {
                        const row = find(container, 'AdwEntryRow') as Adw.EntryRow;
                        expect(row.title).toBe('Endpoint');
                        expect(row.text).toBe('https://example.invalid');
                        expect(row.editable).toBe(false);
                        expect(row.showApplyButton).toBe(true);
                    },
                );
            });
        });

        await gated('max-length counts CHARACTERS on both halves', async () => {
            await it('keeps two code points, as clampEntryText does on React Native', async () => {
                // `'🔒éx'` is 3 characters and 4 UTF-16 units. libadwaita truncates to two
                // CHARACTERS; `rows.native.spec.tsx` asserts the same `'🔒é'` — 2 code
                // points, 3 units — from `@gjsify/adwaita-core`'s `clampEntryText`.
                laidOut(<AdwEntryRow title="x" maxLength={2} text="🔒éx" />, (container) => {
                    const row = find(container, 'AdwEntryRow') as Adw.EntryRow;
                    expect(row.maxLength).toBe(2);
                    expect(row.text).toBe('🔒é');
                    expect([...row.text].length).toBe(2);
                    expect(row.text.length).toBe(3);
                });
            });
        });

        await gated('the signal props reach the right signals', async () => {
            await it('AdwActionRow: `activate()` reaches onActivated', async () => {
                // `adw_action_row_activate` is public API with no `activatable` check of
                // its own — the gate lives in `GtkListBox`, which is why the React Native
                // half asserts the CLICK path and this one asserts the emission.
                let activations = 0;
                laidOut(
                    <AdwActionRow
                        title="Wi-Fi"
                        activatable={true}
                        onActivated={() => {
                            activations += 1;
                        }}
                    />,
                    (container) => {
                        (find(container, 'AdwActionRow') as Adw.ActionRow).activate();
                    },
                );
                expect(activations).toBe(1);
            });

            await it('AdwButtonRow: the `activated` signal reaches onActivated', async () => {
                // `Adw.ButtonRow` installs no public activate function — only the signal —
                // so this asserts the BINDING the host made, which is the half this
                // module owns.
                let activations = 0;
                laidOut(
                    <AdwButtonRow
                        title="Add Account"
                        onActivated={() => {
                            activations += 1;
                        }}
                    />,
                    (container) => {
                        find(container, 'AdwButtonRow').emit('activated');
                    },
                );
                expect(activations).toBe(1);
            });

            await it('AdwSwitchRow: a write from outside the host reaches onNotifyActive', async () => {
                const seen: boolean[] = [];
                laidOut(
                    <AdwSwitchRow title="x" active={false} onNotifyActive={(active) => seen.push(active)} />,
                    (container) => {
                        const row = find(container, 'AdwSwitchRow') as Adw.SwitchRow;
                        row.active = true;
                    },
                );
                expect(seen).toStrictEqual([true]);
            });

            await it('AdwSwitchRow: a write of the value already held is SILENT', async () => {
                // GObject's own early-return, and the same gate `SwitchRowState.setActive`
                // returns on the React Native half.
                const seen: boolean[] = [];
                laidOut(
                    <AdwSwitchRow title="x" active={true} onNotifyActive={(active) => seen.push(active)} />,
                    (container) => {
                        (find(container, 'AdwSwitchRow') as Adw.SwitchRow).active = true;
                    },
                );
                expect(seen).toStrictEqual([]);
            });

            await it('AdwExpanderRow: a write from outside the host reaches onNotifyExpanded', async () => {
                const seen: boolean[] = [];
                laidOut(
                    <AdwExpanderRow title="x" expanded={false} onNotifyExpanded={(open) => seen.push(open)} />,
                    (container) => {
                        (find(container, 'AdwExpanderRow') as Adw.ExpanderRow).expanded = true;
                    },
                );
                expect(seen).toStrictEqual([true]);
            });

            await it('AdwExpanderRow: a write of the value already held is SILENT', async () => {
                // GObject's own early-return, and the same gate `ExpanderState.setExpanded`
                // returns on the React Native half.
                const seen: boolean[] = [];
                laidOut(
                    <AdwExpanderRow title="x" expanded={true} onNotifyExpanded={(open) => seen.push(open)} />,
                    (container) => {
                        (find(container, 'AdwExpanderRow') as Adw.ExpanderRow).expanded = true;
                    },
                );
                expect(seen).toStrictEqual([]);
            });

            await it('AdwExpanderRow: the ROW owns the flag — an unechoed toggle survives a re-render', async () => {
                // GObject's contract, not React's, and the reason the React Native half
                // keeps `ExpanderState` as its buffer instead of rendering `expanded`
                // straight from the prop. `@gjsify/gtk-host` patches a property only when
                // the PROP changes, so a disclosure opened from outside and never echoed
                // back into the prop is still open after the next render.
                const element = <AdwExpanderRow title="x" expanded={false} />;
                laidOut(element, (container, rerender) => {
                    const row = find(container, 'AdwExpanderRow') as Adw.ExpanderRow;
                    row.expanded = true;
                    rerender(element);
                    expect(row.expanded).toBe(true);
                });
            });

            await it('AdwExpanderRow: a prop CHANGE re-seeds the row, and is not echoed back', async () => {
                // The other side of the same rule: `false` written again is no change and
                // reaches nothing, so taking a disclosure back needs the prop to MOVE.
                // When it does, the notify the host's own write raises is dropped by its
                // `isHostWriteTarget` guard — which is what lets the prop be controlled
                // with no latch in `expander-row.gtk.tsx`.
                const seen: boolean[] = [];
                laidOut(
                    <AdwExpanderRow title="x" expanded={true} onNotifyExpanded={(open) => seen.push(open)} />,
                    (container, rerender) => {
                        const row = find(container, 'AdwExpanderRow') as Adw.ExpanderRow;
                        expect(row.expanded).toBe(true);
                        rerender(
                            <AdwExpanderRow title="x" expanded={false} onNotifyExpanded={(open) => seen.push(open)} />,
                        );
                        expect(row.expanded).toBe(false);
                        expect(seen).toStrictEqual([]);
                    },
                );
            });

            await it('AdwEntryRow: a text write reaches onNotifyText with the new value', async () => {
                const seen: string[] = [];
                laidOut(<AdwEntryRow title="x" text="" onNotifyText={(text) => seen.push(text)} />, (container) => {
                    (find(container, 'AdwEntryRow') as Adw.EntryRow).text = 'typed';
                });
                expect(seen).toStrictEqual(['typed']);
            });

            await it('AdwEntryRow: `apply` and `entry-activated` reach their own props', async () => {
                const fired: string[] = [];
                laidOut(
                    <AdwEntryRow
                        title="x"
                        showApplyButton={true}
                        onApply={() => fired.push('apply')}
                        onEntryActivated={() => fired.push('entry-activated')}
                    />,
                    (container) => {
                        const row = find(container, 'AdwEntryRow');
                        row.emit('apply');
                        row.emit('entry-activated');
                    },
                );
                expect(fired).toStrictEqual(['apply', 'entry-activated']);
            });
        });

        if (display !== null) {
            // A `Gtk.Revealer`'s reveal is a DURATION, and a suite that reads a size
            // mid-transition asserts whichever frame it happened to catch. With
            // animations off the revealed allocation is the first one the frame clock
            // produces. `Gtk.Settings.get_default()` is null exactly when there is no
            // default display, which this branch has already excluded — a narrowing, not
            // a probe.
            const settings = Gtk.Settings.get_default();
            if (settings !== null) settings.gtkEnableAnimations = false;

            await gated('the disclosure is an allocation, not a flag', async () => {
                await it('allocates the disclosed row nothing until it is revealed', async () => {
                    // `expanded` reads back on a widget that never drew anything, so the
                    // flag proves nothing on its own. What the disclosure IS, is an
                    // allocation: 0×0 and unmapped while collapsed, the row's full width
                    // below the header once revealed — and PARENTED throughout, which is
                    // the fact the React Native half matches by hiding its disclosure
                    // rather than unmounting it.
                    laidOut(
                        <AdwExpanderRow title="Advanced">
                            <adw-action-row title="disclosed" />
                        </AdwExpanderRow>,
                        (container) => {
                            const row = find(container, 'AdwExpanderRow') as Adw.ExpanderRow;
                            const revealer = find(row, 'GtkRevealer');
                            // Searched from the REVEALER, because the expander's own
                            // header is an `AdwActionRow` too and breadth-first from the
                            // row would find that one.
                            const disclosed = find(revealer, 'AdwActionRow');
                            const header = find(row, 'AdwActionRow');
                            // Breadth-first from the expander, so this is the HEADER's
                            // list box — the revealer's own is one level deeper.
                            const headerList = find(row, 'GtkListBox');
                            const collapsedHeight = row.get_height();

                            expect(disclosed === header).toBe(false);
                            expect(disclosed.get_mapped()).toBe(false);
                            expect(disclosed.get_width()).toBe(0);
                            expect(disclosed.get_height()).toBe(0);
                            expect(disclosed.get_parent() !== null).toBe(true);
                            expect(revealer.get_height()).toBe(0);
                            expect(collapsedHeight).toBe(headerList.get_height());

                            row.expanded = true;
                            settle(() => disclosed.get_height() > 0);

                            expect(disclosed.get_mapped()).toBe(true);
                            // 596, not the frame's 600 — the boxed list's 2-point frame
                            // on each side, the same `BOXED_LIST_INSET` the header row is
                            // measured against below.
                            expect(disclosed.get_width()).toBe(FRAME_WIDTH - BOXED_LIST_INSET);
                            expect(disclosed.get_height()).toBe(header.get_height());
                            // Every number below is a RELATION between two things the
                            // tree reports, so nothing here can be satisfied by a window
                            // that drew nothing: the expander IS its header list plus its
                            // revealer stacked in one box, the revealer is the disclosed
                            // row plus the inner list's own frame, and the header list
                            // gains exactly the 1-point separator a second visible row
                            // costs it. Measured on libadwaita 1.9.3: 109 = 55 + 54.
                            expect(row.get_height()).toBe(headerList.get_height() + revealer.get_height());
                            expect(revealer.get_height()).toBe(disclosed.get_height() + BOXED_LIST_INSET);
                            expect(headerList.get_height()).toBe(collapsedHeight + 1);

                            const bounds = disclosed.compute_bounds(row);
                            expect(bounds[0]).toBe(true);
                            // Where the header list ends, to the point — below the
                            // header and not over it, which is the mis-parenting class
                            // this suite exists for and costs no GTK diagnostic.
                            expect(bounds[1].get_y()).toBe(headerList.get_height());
                        },
                    );
                });
            });

            await gated('the picture, not only the setter', async () => {
                await it('actually draws a row, with its title inside its own allocation', async () => {
                    // A property read proves `set_property` was called; it says nothing
                    // about whether anything was ever allocated. GTK's failure mode is an
                    // empty window at exit 0, so this row reads the PNG and the geometry.
                    laidOut(<AdwActionRow title="Wi-Fi" subtitle="Connected" />, (container) => {
                        const row = find(container, 'AdwActionRow');
                        expect(blankReason(shotEvidence(row, capture))).toBe(null);
                        // 596, not the frame's 600: the boxed list draws a 2-point frame
                        // on each side, so the row is inset by exactly `BOXED_LIST_INSET`.
                        // Measured on libadwaita 1.9.3 — the number is asserted rather
                        // than a `> 0`, because "it has some width" is what an empty
                        // window also reports.
                        expect(row.get_width()).toBe(FRAME_WIDTH - BOXED_LIST_INSET);

                        // The title is allocated INSIDE the row it belongs to. A label
                        // that renders at a negative offset, or past the row's right
                        // edge, is the mis-parenting class this suite exists for and
                        // costs no GTK diagnostic at all.
                        const title = find(row, 'GtkLabel');
                        const bounds = title.compute_bounds(row);
                        expect(bounds[0]).toBe(true);
                        expect(bounds[1].get_x() >= 0).toBe(true);
                        expect(bounds[1].get_height() > 0).toBe(true);
                        expect(bounds[1].get_x() + bounds[1].get_width() <= row.get_width()).toBe(true);
                    });
                });
            });
        }
    });
};
