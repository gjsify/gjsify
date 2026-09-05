/** @jsxImportSource @gjsify/gtk-host/react */
// The preferences group's GTK half, against the libadwaita that is installed.
//
// THE NUMBERS IN THIS FILE ARE THE NUMBERS `preferences.native.spec.tsx` ASSERTS. That is
// what "one API surface, two implementations" has to mean if it means anything: not two
// files that compile, but two renderers agreeing on a number neither of them invented.
// Each `gated` describe below has a same-named counterpart there, and every `expect` marked
// "the pair" is asserted twice — once off the live GTK tree here, once off a React tree
// there.
//
// WHY THE PROPERTY AND NOT THE PICTURE, for most of it. `clamp.gtk.spec.tsx` photographs,
// because a clamp's whole subject is an allocation and GTK's failure mode is exit 0 with an
// empty window. These five widgets are about STATE — which label is visible, which item is
// selected, what the entry masks — and a photograph cannot answer any of it. What replaces
// it is that every assertion below reads a property off the REAL widget after a real
// allocation, and `withGtk`'s diagnostics gate makes "and libadwaita said nothing about it"
// an assertion rather than a hope. The one place a size WOULD be the answer — is the group's
// hidden card actually taking no space — is asserted as `get_visible()`, because that is the
// property `update_listbox_visibility` writes and a zero height would also be true of a card
// that simply has nothing in it.
//
// A COMBO ROW IS MEASURED INSIDE A GROUP BECAUSE IT HAS TO BE. `AdwComboRow` does not
// override `GtkWidget:grab_focus`, so an activatable one alone in a window reaches
// `gtk_list_box_row_grab_focus` and raises `assertion 'box != NULL' failed` — at exit 0,
// which is why `installDiagnosticsGate` is what turns it red. `Adw.EntryRow` and
// `Adw.SpinRow` DO override it and delegate to an inner widget, so the two bare
// `AdwPasswordEntryRow` fixtures below are not the same case. Verified by moving one combo
// row out of its group: the gate fires.
//
// THE CONTROLS ARE ALLOCATED, WHICH IS NOT FREE. An empty `Gtk.Box` appended after layout is
// 0×0, so a suite that only asks "did something render" proves nothing about a control that
// was never given a size. Every row asserted here is inside a `laidOut` window that has been
// pumped to a real frame, and the rows that carry a control assert a NUMBER off it.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';

import { find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwComboRow, comboSelectedIndex } from './combo-row.gtk.js';
import { AdwPasswordEntryRow } from './password-entry-row.gtk.js';
import { AdwPreferencesGroup } from './preferences-group.gtk.js';
import { AdwPreferencesPage } from './preferences-page.gtk.js';
import { AdwSpinRow } from './spin-row.gtk.js';

/**
 * The group HEADER's labels, as `[text, visible]` — the two `update_*_visibility` writes.
 *
 * The walk stops at the `GtkListBox`, and that is what makes the assertion exact rather than
 * a search. A group holding one row has THREE empty labels in it — the header's description
 * and the row's title and subtitle — so `find the label reading ''` would match whichever
 * came first and pass for the wrong one. Scoped to the header, the answer is a two-element
 * array and can be compared whole.
 */
function headerLabels(group: Gtk.Widget): [string, boolean][] {
    const found: [string, boolean][] = [];
    const walk = (widget: Gtk.Widget): void => {
        for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
            if (typeOf(child) === 'GtkListBox') continue;
            if (typeOf(child) === 'GtkLabel') found.push([(child as Gtk.Label).label, child.get_visible()]);
            walk(child);
        }
    };
    walk(group);
    return found;
}

/**
 * The group's header box — the widget `update_header_visibility` writes.
 *
 * Found by its style class rather than by position, because it is what libadwaita puts the
 * class on: `adw-preferences-group.ui` names the box `header` and the stylesheet's
 * `min-height`/`margin-bottom` rules key off it.
 */
function headerBox(group: Gtk.Widget): Gtk.Widget {
    const walk = (widget: Gtk.Widget): Gtk.Widget | null => {
        for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
            if (child.has_css_class('header')) return child;
            const found = walk(child);
            if (found !== null) return found;
        }
        return null;
    };
    const found = walk(group);
    if (found === null) throw new Error('the preferences group has no .header box');
    return found;
}

/**
 * The inline value view `adw-combo-row.ui` binds to `use-subtitle`, inverted.
 *
 * The walk SKIPS the popover, which holds a second `GtkListView` — the chooser's list. A
 * breadth-first `find` happens to reach the inline one first today; that is an accident of
 * where libadwaita puts the popover, and an assertion resting on it would flip silently.
 */
function inlineValueView(row: Gtk.Widget): Gtk.Widget {
    const walk = (widget: Gtk.Widget): Gtk.Widget | null => {
        for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
            if (typeOf(child) === 'GtkPopover') continue;
            if (typeOf(child) === 'GtkListView') return child;
            const found = walk(child);
            if (found !== null) return found;
        }
        return null;
    };
    const found = walk(row);
    if (found === null) throw new Error('the combo row draws no inline GtkListView');
    return found;
}

/** A `GtkListBox`'s children, which is what `Adw.PreferencesGroup` counts. */
function rowCount(listbox: Gtk.Widget): number {
    let count = 0;
    for (let child = listbox.get_first_child(); child !== null; child = child.get_next_sibling()) count += 1;
    return count;
}

export default async () => {
    await withGtk(async ({ gated }) => {
        await gated('the widgets are the real libadwaita ones', async () => {
            await it('renders AdwPreferencesPage as an Adw.PreferencesPage carrying its identity', async () => {
                laidOut(
                    <AdwPreferencesPage
                        title="General"
                        iconName="preferences-system-symbolic"
                        name="general"
                        description="Everything else"
                        descriptionCentered={true}
                        useUnderline={true}
                    >
                        <AdwPreferencesGroup title="Appearance" />
                    </AdwPreferencesPage>,
                    (container) => {
                        const page = find(container, 'AdwPreferencesPage') as Adw.PreferencesPage;
                        expect(page.title).toBe('General');
                        expect(page.iconName).toBe('preferences-system-symbolic');
                        // ALL SIX, because the page is the one widget here whose properties
                        // are mostly not drawn — so "it rendered" says nothing about whether
                        // they arrived. Dropping any of the last three from this half left
                        // every test green before this line existed.
                        expect(page.description).toBe('Everything else');
                        expect(page.descriptionCentered).toBe(true);
                        expect(page.useUnderline).toBe(true);
                        // `name` is the PAGE's property and not `GtkWidget:name` — the two
                        // collide, and gtk-host's generated table omits the widget one from
                        // this tag for exactly that reason. Reading it back is what says the
                        // right one was written.
                        expect(page.name).toBe('general');
                        expect(typeOf(find(page, 'AdwPreferencesGroup'))).toBe('AdwPreferencesGroup');
                    },
                );
            });

            await it('renders AdwPreferencesGroup as an Adw.PreferencesGroup holding its rows', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance" description="How it looks">
                        <AdwComboRow title="Style" model={['Light', 'Dark']} />
                        <AdwSpinRow title="Scale" />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const group = find(container, 'AdwPreferencesGroup') as Adw.PreferencesGroup;
                        expect(group.title).toBe('Appearance');
                        expect(group.description).toBe('How it looks');
                        // The `ordered` policy appended BOTH, in order — a `single` policy
                        // would have kept only the last, which is the divergence
                        // `clamp.gtk.spec.tsx` pins for `Adw.Bin`.
                        expect(rowCount(find(group, 'GtkListBox'))).toBe(2);
                    },
                );
            });

            await it('renders the three rows as their real Adw types', async () => {
                laidOut(
                    <AdwPreferencesGroup title="All three">
                        <AdwComboRow title="Style" model={['Light', 'Dark']} />
                        <AdwSpinRow title="Scale" />
                        <AdwPasswordEntryRow title="Password" />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const group = find(container, 'AdwPreferencesGroup');
                        expect(typeOf(find(group, 'AdwComboRow'))).toBe('AdwComboRow');
                        expect(typeOf(find(group, 'AdwSpinRow'))).toBe('AdwSpinRow');
                        expect(typeOf(find(group, 'AdwPasswordEntryRow'))).toBe('AdwPasswordEntryRow');
                    },
                );
            });
        });

        // `update_title_visibility`, `update_description_visibility` and
        // `update_listbox_visibility` — three of the five answers
        // `derivePreferencesGroupHeader` gives the React Native half in one call. The pair
        // suite asserts the same three off a React tree.
        await gated('the group header both halves answer alike', async () => {
            await it('hides the description label when the description is empty — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow title="Style" model={['Light', 'Dark']} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const group = find(container, 'AdwPreferencesGroup');
                        // The title label carries the text and is visible; the description
                        // label is present, empty and NOT visible. BOTH are in the tree, and
                        // the array is compared WHOLE — an assertion that only looked for the
                        // hidden one would also pass over a header that lost its title.
                        expect(headerLabels(group)).toStrictEqual([
                            ['Appearance', true],
                            ['', false],
                        ]);
                    },
                );
            });

            await it('shows both header labels when both are set — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance" description="How it looks">
                        <AdwComboRow title="Style" model={['Light', 'Dark']} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const group = find(container, 'AdwPreferencesGroup');
                        expect(headerLabels(group)).toStrictEqual([
                            ['Appearance', true],
                            ['How it looks', true],
                        ]);
                    },
                );
            });

            await it('hides the whole HEADER when neither label is set — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup>
                        <AdwComboRow title="Style" model={['Light', 'Dark']} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const group = find(container, 'AdwPreferencesGroup');
                        // The third of the five answers, and the only one the other rows
                        // cannot reach: with a title set the header box is visible whatever
                        // else is true. The React Native half asserts the same fixture.
                        expect(headerBox(group).get_visible()).toBe(false);
                        // …and the card stays. A group with rows and no heading is a real
                        // state.
                        expect(find(group, 'GtkListBox').get_visible()).toBe(true);
                    },
                );
            });

            await it('hides a pure-markup title, where React Native paints it — the divergence', async () => {
                laidOut(
                    <AdwPreferencesGroup title="<b></b>">
                        <AdwComboRow title="Style" model={['Light', 'Dark']} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const group = find(container, 'AdwPreferencesGroup');
                        // `adw-preferences-group.ui` sets `use-markup` on both labels and
                        // `update_title_visibility` reads `gtk_label_get_text` — the
                        // DISPLAYED text, markup already parsed — so this title is an empty
                        // label here. The React Native half has no Pango, paints the string
                        // verbatim and shows it. Both sides of the README's divergence are
                        // now measured off the same fixture rather than described.
                        expect(headerLabels(group)).toStrictEqual([
                            ['<b></b>', false],
                            ['', false],
                        ]);
                        expect(headerBox(group).get_visible()).toBe(false);
                    },
                );
            });

            await it('hides the CARD at zero rows and shows it at one — the pair', async () => {
                laidOut(<AdwPreferencesGroup title="Appearance" />, (container, _window, rerender) => {
                    const group = find(container, 'AdwPreferencesGroup');
                    // `update_listbox_visibility` reads the RAW child count, so this is
                    // the assertion that separates "the group is empty" from "the group
                    // is gone": the HEADER stays, the card does not.
                    expect(find(group, 'GtkListBox').get_visible()).toBe(false);
                    // …and the HEADER stays. An empty group still announces what it is.
                    expect(headerLabels(group)).toStrictEqual([
                        ['Appearance', true],
                        ['', false],
                    ]);

                    rerender(
                        <AdwPreferencesGroup title="Appearance">
                            <AdwComboRow title="Style" model={['Light', 'Dark']} />
                        </AdwPreferencesGroup>,
                    );
                    const after = find(container, 'AdwPreferencesGroup');
                    expect(find(after, 'GtkListBox').get_visible()).toBe(true);
                    expect(rowCount(find(after, 'GtkListBox'))).toBe(1);
                });
            });
        });

        // `ComboState`'s selection model, against the `GtkSingleSelection` it is a port of.
        await gated('the combo row both halves answer alike', async () => {
            await it('carries the model and the selected position — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow title="Style" model={['Light', 'Dark', 'System']} selected={1} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const row = find(container, 'AdwComboRow') as Adw.ComboRow;
                        expect(row.model?.get_n_items()).toBe(3);
                        expect(comboSelectedIndex(row.selected)).toBe(1);
                    },
                );
            });

            await it('is NOT activatable at one option and IS at two — the pair', async () => {
                // `model_changed` sets `gtk_list_box_row_set_activatable (n_items > 1)`: one
                // item is not a choice, so the row stops being one. This is the number the
                // React Native half asserts as `presentsChooser`, and it is the rule a
                // hand-written port drops — a one-item combo that still looks tappable.
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow title="Style" model={['Light']} />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        expect((find(container, 'AdwComboRow') as Gtk.ListBoxRow).activatable).toBe(false);
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwComboRow title="Style" model={['Light', 'Dark']} />
                            </AdwPreferencesGroup>,
                        );
                        expect((find(container, 'AdwComboRow') as Gtk.ListBoxRow).activatable).toBe(true);
                    },
                );
            });

            await it('keeps the selection across an unrelated re-render', async () => {
                // WHAT THE MEMO IN `combo-row.gtk.tsx` IS FOR, as an assertion rather than a
                // paragraph. gtk-host writes a property only when the prop CHANGES, and a
                // freshly constructed `Gtk.StringList` is a new value on every render — so
                // without the memo an unrelated prop change rewrites `model`, and
                // `adw_combo_row_set_model` takes the selection back to 0. Nothing else in
                // this suite re-renders a combo row, so nothing else can see it.
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow title="Style" model={['Light', 'Dark', 'System']} selected={2} />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        expect(comboSelectedIndex((find(container, 'AdwComboRow') as Adw.ComboRow).selected)).toBe(2);
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwComboRow title="Theme" model={['Light', 'Dark', 'System']} selected={2} />
                            </AdwPreferencesGroup>,
                        );
                        const row = find(container, 'AdwComboRow') as Adw.ComboRow;
                        expect(row.title).toBe('Theme');
                        expect(comboSelectedIndex(row.selected)).toBe(2);
                    },
                );
            });

            await it('reports a pick the WIDGET made and not one this half wrote — the divergence', async () => {
                // A HOST-ROUTED `notify::` IS DEAF TO THE LAYER'S OWN WRITE, and this row is
                // one of the places that costs something. gtk-host suppresses a `notify::`
                // raised inside its own property write — module-wide, which is what stops a
                // controlled `Adw.EntryRow` re-entering `onNotifyText` — and writing the
                // `selected` prop from a re-render IS that write. So the callback the props
                // file used to promise "fires on every change" fires on every change EXCEPT
                // the one an application makes, which is the ordinary one.
                //
                // Asserted in both directions, because only the pair distinguishes "the
                // handler is suppressed" from "the handler was never connected".
                const seen: number[] = [];
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow
                            title="Style"
                            model={['Light', 'Dark', 'System']}
                            selected={0}
                            onNotifySelected={(index) => seen.push(index)}
                        />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        seen.length = 0;
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwComboRow
                                    title="Style"
                                    model={['Light', 'Dark', 'System']}
                                    selected={2}
                                    onNotifySelected={(index) => seen.push(index)}
                                />
                            </AdwPreferencesGroup>,
                        );
                        const row = find(container, 'AdwComboRow') as Adw.ComboRow;
                        // The widget really moved — so this is a dropped notification and
                        // not a write that failed.
                        expect(comboSelectedIndex(row.selected)).toBe(2);
                        expect(seen).toStrictEqual([]);

                        // The same property, moved from outside the host's write bracket:
                        // the connection is live and the callback carries the new position.
                        row.selected = 1;
                        expect(seen).toStrictEqual([1]);
                    },
                );
            });

            await it('hides the inline value under useSubtitle — the pair', async () => {
                // The BINDING, which is the half that is deterministic: `adw-combo-row.ui`
                // gives the inline `current` view `visible` bound to `use-subtitle` with
                // `sync-create|invert-boolean`, so the value never occupies both the
                // trailing slot and the subtitle. The React Native half asserts the same
                // fact as a hidden trailing label; before it did, that half drew the value
                // twice.
                const row = (container: Gtk.Widget): Adw.ComboRow => find(container, 'AdwComboRow') as Adw.ComboRow;
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow title="Style" subtitle="Authored" model={['Light', 'Dark']} selected={1} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        expect(inlineValueView(row(container)).get_visible()).toBe(true);
                    },
                );
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow
                            title="Style"
                            subtitle="Authored"
                            model={['Light', 'Dark']}
                            selected={1}
                            useSubtitle={true}
                        />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        expect(inlineValueView(row(container)).get_visible()).toBe(false);
                        // WHEN THE VALUE REACHES THE SUBTITLE IS WHERE THE TWO HALVES PART,
                        // and this is the measurement behind the README's divergence rather
                        // than a guess: `adw_combo_row_set_use_subtitle` calls
                        // `selection_changed`, and the subtitle is written by
                        // `selection_item_changed` — a different function, reached only from
                        // `notify::selected-item` and `set_model`. So the AUTHORED subtitle
                        // survives switching `use-subtitle` on…
                        expect(row(container).subtitle).toBe('Authored');
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwComboRow
                                    title="Style"
                                    subtitle="Authored"
                                    model={['Light', 'Dark']}
                                    selected={0}
                                    useSubtitle={true}
                                />
                            </AdwPreferencesGroup>,
                        );
                        // …and the next selection change is what publishes it.
                        expect(row(container).subtitle).toBe('Light');
                    },
                );
            });

            await it('spells an empty model’s selection the way the core does — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwComboRow title="Style" model={[]} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const row = find(container, 'AdwComboRow') as Adw.ComboRow;
                        // `AdwComboRow:selected` is a `guint`, so libadwaita stores
                        // `GTK_INVALID_LIST_POSITION` — 4294967295. `comboSelectedIndex`
                        // translates it to the `-1` `@gjsify/adwaita-core` uses, so one state
                        // has one spelling across the two halves.
                        expect(row.selected).toBe(0xff_ff_ff_ff);
                        expect(comboSelectedIndex(row.selected)).toBe(-1);
                    },
                );
            });
        });

        // `SpinState`'s clamp, against the `Gtk.Adjustment` it is a port of.
        await gated('the spin row both halves answer alike', async () => {
            await it('carries the authored range and value — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwSpinRow title="Scale" adjustment={{ lower: 0, upper: 200, stepIncrement: 25 }} value={50} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const row = find(container, 'AdwSpinRow') as Adw.SpinRow;
                        expect(row.value).toBe(50);
                        expect(row.adjustment.lower).toBe(0);
                        expect(row.adjustment.upper).toBe(200);
                        expect(row.adjustment.stepIncrement).toBe(25);
                    },
                );
            });

            await it('clamps a value authored below the range — the pair', async () => {
                // The row a hand-written port gets wrong: `value` is not stored and then
                // corrected, it never exists out of range. 5 into 10…20 is 10 on both halves.
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwSpinRow title="Scale" adjustment={{ lower: 10, upper: 20 }} value={5} />
                    </AdwPreferencesGroup>,
                    (container) => {
                        expect((find(container, 'AdwSpinRow') as Adw.SpinRow).value).toBe(10);
                    },
                );
            });

            await it('re-clamps when a bound moves under the value — the pair', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwSpinRow title="Scale" adjustment={{ lower: 0, upper: 100 }} value={80} />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        expect((find(container, 'AdwSpinRow') as Adw.SpinRow).value).toBe(80);
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwSpinRow title="Scale" adjustment={{ lower: 0, upper: 50 }} value={80} />
                            </AdwPreferencesGroup>,
                        );
                        // 80 was legal and is not any more. Both halves answer 50.
                        expect((find(container, 'AdwSpinRow') as Adw.SpinRow).value).toBe(50);
                    },
                );
            });

            await it('keeps a value the WIDGET moved across an unrelated re-render — the pair', async () => {
                // WHAT THE MEMO IN `spin-row.gtk.tsx` IS FOR, as an assertion rather than a
                // paragraph — the same shape `combo-row.gtk.tsx`'s model memo already has
                // one for. A freshly constructed `Gtk.Adjustment` is a new value on every
                // render, so without the memo an unrelated prop change re-sets it and takes
                // the value back to whatever was AUTHORED. Nothing else in either suite
                // re-renders a spin row after its value moved, so nothing else can see it.
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwSpinRow title="Scale" adjustment={{ lower: 0, upper: 100, stepIncrement: 10 }} value={50} />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        // The stepper's effect without the click: the widget owns its value,
                        // as `Adw.ComboRow` owns its selection.
                        (find(container, 'AdwSpinRow') as Adw.SpinRow).value = 60;
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwSpinRow
                                    title="Zoom"
                                    adjustment={{ lower: 0, upper: 100, stepIncrement: 10 }}
                                    value={50}
                                />
                            </AdwPreferencesGroup>,
                        );
                        const row = find(container, 'AdwSpinRow') as Adw.SpinRow;
                        expect(row.title).toBe('Zoom');
                        expect(row.value).toBe(60);
                    },
                );
            });

            await it('reports a value the WIDGET moved and not one this half wrote — the divergence', async () => {
                // The combo row's finding by a DIFFERENT route, which is why it is a second
                // vector: this row writes no `value` property at all, it re-sets the memoised
                // `Gtk.Adjustment`, and `notify::value` is raised from inside THAT host write.
                // So the suppression is reached through an object the props file never names,
                // and a reader would not predict it from the combo row's paragraph alone.
                const seen: number[] = [];
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwSpinRow
                            title="Scale"
                            adjustment={{ lower: 0, upper: 200, stepIncrement: 25 }}
                            value={50}
                            onNotifyValue={(value) => seen.push(value)}
                        />
                    </AdwPreferencesGroup>,
                    (container, _window, rerender) => {
                        seen.length = 0;
                        rerender(
                            <AdwPreferencesGroup title="Appearance">
                                <AdwSpinRow
                                    title="Scale"
                                    adjustment={{ lower: 0, upper: 200, stepIncrement: 25 }}
                                    value={75}
                                    onNotifyValue={(value) => seen.push(value)}
                                />
                            </AdwPreferencesGroup>,
                        );
                        const row = find(container, 'AdwSpinRow') as Adw.SpinRow;
                        expect(row.value).toBe(75);
                        expect(seen).toStrictEqual([]);

                        row.value = 25;
                        expect(seen).toStrictEqual([25]);
                    },
                );
            });

            await it('formats the value with `digits` — the pair, as a STRING', async () => {
                laidOut(
                    <AdwPreferencesGroup title="Appearance">
                        <AdwSpinRow
                            title="Scale"
                            adjustment={{ lower: 0, upper: 10, stepIncrement: 1 }}
                            value={3.14159}
                            digits={2}
                        />
                    </AdwPreferencesGroup>,
                    (container) => {
                        const row = find(container, 'AdwSpinRow') as Adw.SpinRow;
                        expect(row.digits).toBe(2);
                        // `Adw.SpinRow` implements `GtkEditable`, so the DISPLAYED text is
                        // readable — and asserting the number alone would leave the two
                        // halves free to draw 3.14159 and 3.14.
                        //
                        // THE SEPARATOR IS THE PROCESS LOCALE'S AND THE DIGITS ARE NOT.
                        // Measured on gjs 1.88.1 under a de_DE locale: this reads `3,14`,
                        // where the React Native half's `toFixed(2)` gives `3.14` on every
                        // machine there is. `gtk_spin_button_update` formats through the C
                        // library's locale; `Number.prototype.toFixed` is specified never to.
                        // So the two halves agree on the DIGIT CONTENT and disagree on one
                        // character, and the README names it. Normalising the separator here
                        // keeps the pair a real assertion; building the expectation from the
                        // locale instead would make this test measure the RUNNER, which is a
                        // green that says nothing.
                        expect(row.get_text().replace(',', '.')).toBe('3.14');
                    },
                );
            });
        });

        // `EntryRowState` + `PasswordEntryRowState`, against the widget they are a port of.
        await gated('the password entry row both halves answer alike', async () => {
            await it('masks its contents on mount — the pair', async () => {
                laidOut(<AdwPasswordEntryRow title="Password" text="hunter2" />, (container) => {
                    const row = find(container, 'AdwPasswordEntryRow') as Adw.PasswordEntryRow;
                    expect(row.get_text()).toBe('hunter2');
                    // `gtk_text_set_visibility (FALSE)` is what the mask IS, and the internal
                    // `GtkText` is where it lives. The React Native half asserts the same
                    // state as `secureTextEntry: true`.
                    expect((find(row, 'GtkText') as Gtk.Text).visibility).toBe(false);
                });
            });

            await it('counts `max-length` and truncates past it — the pair', async () => {
                laidOut(<AdwPasswordEntryRow title="Password" text="abcdefgh" maxLength={4} />, (container) => {
                    const row = find(container, 'AdwPasswordEntryRow') as Adw.PasswordEntryRow;
                    expect(row.maxLength).toBe(4);
                    expect(row.get_text()).toBe('abcd');
                });
            });

            await it('carries `editable` and `show-apply-button` — the pair', async () => {
                // Two properties this half writes and nothing read back. `editable` is
                // asserted against `GtkEditable`'s TRUE default as well, because an omitted
                // boolean prop and a written `false` are the same picture in a tree dump.
                laidOut(
                    <AdwPasswordEntryRow title="Password" text="hunter2" editable={false} showApplyButton={true} />,
                    (container) => {
                        const row = find(container, 'AdwPasswordEntryRow') as Adw.PasswordEntryRow;
                        expect(row.editable).toBe(false);
                        expect(row.showApplyButton).toBe(true);
                    },
                );
                laidOut(<AdwPasswordEntryRow title="Password" text="hunter2" />, (container) => {
                    const row = find(container, 'AdwPasswordEntryRow') as Adw.PasswordEntryRow;
                    expect(row.editable).toBe(true);
                    expect(row.showApplyButton).toBe(false);
                });
            });
        });
    });
};
