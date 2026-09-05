/** @jsxImportSource react */
// The preferences group's React Native half, rendered through React's real reconciler.
//
// THE NUMBERS IN THIS FILE ARE THE NUMBERS `preferences.gtk.spec.tsx` ASSERTS. Every
// `describe` below has a same-named counterpart there, and every case marked "the pair" is
// asserted twice — once off a live `Adw.*` widget, once off the React tree here. The GTK
// side reads a hidden label as `get_visible() === false`; this side reads it as `display:
// 'none'`, which is the same fact in the two vocabularies and is why both halves keep the
// hidden node IN the tree rather than rendering `null`.
//
// WHAT IS AND IS NOT MEASURED HERE, restated because the rows below step further into
// interaction than any suite in this package has: `react-test-renderer` runs React's own
// reconciler and its own hook dispatcher, so a press really does drive
// `ComboState.select` / `SpinState.increment` / `PasswordEntryRowState.togglePeek`, and the
// re-render that follows is real. The host components are the double
// (`../testing/react-native.ts`), which is type-pinned to React Native's own surface and
// contributes no behaviour. What is absent is the platform: `secureTextEntry: true` is an
// INSTRUCTION to a text input that is not in this process, and `disabled` on a `Pressable`
// is an instruction the double does not honour — it forwards `onPress` regardless. So the
// suite asserts that a widget ASKS for a thing, never that the platform did it, and the
// press rows below call `onPress` only where the widget itself is meant to allow it.
//
// A ROW THAT ASSERTS NOTHING IS THE FAILURE THIS FILE WAS WRITTEN AGAINST. `does not throw`
// with no expectation passes over a React tree that dropped the update — React swallows a
// `setState` on an unmounted tree in silence — so every case below reads a value back and
// compares it. Where the claim is "nothing happened", the assertion is that the value is
// UNCHANGED and that the change callback was not called, never that no error was raised.

import { act } from 'react-test-renderer';
import { describe, expect, it } from '@gjsify/unit';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_TEXT, RCT_TEXT_INPUT, RCT_VIEW } from '../testing/react-native.js';
import { childrenOf, mount, mounted, textOf, type Style } from '../testing/render.spec.js';
import { AdwComboRow } from './combo-row.native.js';
import { AdwPasswordEntryRow } from './password-entry-row.native.js';
import { AdwPreferencesGroup } from './preferences-group.native.js';
import { AdwPreferencesPage } from './preferences-page.native.js';
import { AdwSpinRow } from './spin-row.native.js';

/** `display: 'none'` is this half's spelling of GTK's `get_visible() === false`. */
const hidden = (node: ReactTestRendererJSON): boolean => (node.props.style as Style)?.display === 'none';

/** Every node in the tree, depth-first — the counterpart of the GTK suite's `labels` walk. */
function flatten(node: ReactTestRendererJSON): ReactTestRendererJSON[] {
    const found = [node];
    for (const child of node.children ?? []) {
        if (typeof child !== 'string') found.push(...flatten(child as ReactTestRendererJSON));
    }
    return found;
}

/** Every `Text` node, as `[text, visible]` — the shape `preferences.gtk.spec.tsx` reads. */
const texts = (node: ReactTestRendererJSON): [string, boolean][] =>
    flatten(node)
        .filter((n) => n.type === RCT_TEXT)
        .map((n) => [textOf(n), !hidden(n)]);

/**
 * The group HEADER's two labels, as `[text, visible]`.
 *
 * Read BY POSITION, which is what makes it exact rather than a search — the same reason
 * `preferences.gtk.spec.tsx` stops its walk at the `GtkListBox`. A group holding one row has
 * three empty `Text` nodes in it (the header's description, and the row's title and
 * subtitle), so "find the text reading ''" would match whichever came first and pass for the
 * wrong one. The group renders header-then-card, so the header is child 0 and its two labels
 * can be compared whole.
 */
const headerLabels = (group: ReactTestRendererJSON): [string, boolean][] =>
    childrenOf(childrenOf(group)[0] as ReactTestRendererJSON).map((n) => [textOf(n), !hidden(n)]);

/**
 * A ROW's two labels, as `[text, visible]` — the same reading, one level down.
 *
 * `AdwRowLabels` is child 0 of every row here, exactly as the header box is child 0 of the
 * group, so the reader is the same shape and is spelled separately only because "header" is
 * not what it names on a row.
 */
const rowLabels = (row: ReactTestRendererJSON): [string, boolean][] =>
    childrenOf(childrenOf(row)[0] as ReactTestRendererJSON).map((n) => [textOf(n), !hidden(n)]);

/** A row's trailing value label — child 1, after the label column. */
const valueLabel = (row: ReactTestRendererJSON): [string, boolean] => {
    const node = childrenOf(row)[1] as ReactTestRendererJSON;
    if (node.type !== RCT_TEXT) throw new Error(`child 1 is a ${String(node.type)}, not the value label`);
    return [textOf(node), !hidden(node)];
};

/** The one node carrying `accessibilityLabel`, or a failure naming what was there instead. */
function labelled(node: ReactTestRendererJSON, label: string): ReactTestRendererJSON {
    const found = flatten(node).filter((n) => n.props.accessibilityLabel === label);
    if (found.length !== 1) {
        throw new Error(
            `expected exactly one node labelled ${JSON.stringify(label)}, found ${found.length} — ` +
                `the tree carries ${JSON.stringify(flatten(node).map((n) => n.props.accessibilityLabel))}`,
        );
    }
    return found[0] as ReactTestRendererJSON;
}

/**
 * Press a host node, through React's own act.
 *
 * The PROPS ARE READ OFF THE HOST NODE and not off the `Pressable` composite, which is the
 * one place the double is knowingly not React Native: real `Pressable` turns `onPress` into
 * responder handlers and does NOT forward it, this one does, and `testing/react-native.ts`
 * says so at the export. That makes the tree readable; what it does not make is a proof that
 * a tap arrives, which is the platform gap named at the head of this file.
 */
function press(node: ReactTestRendererJSON): void {
    const onPress = node.props.onPress as (() => void) | undefined;
    if (typeof onPress !== 'function') {
        throw new Error(`the node carries no onPress, so nothing can ever press it: ${JSON.stringify(node.props)}`);
    }
    act(() => {
        onPress();
    });
}

export default async () => {
    await describe('AdwPreferencesPage on React Native — the tree it emits', async () => {
        await it('is a column that draws the description and NOT the identity', async () => {
            const tree = mounted(
                <AdwPreferencesPage
                    title="General"
                    iconName="preferences-system-symbolic"
                    name="general"
                    description="Everything else"
                >
                    <AdwPreferencesGroup title="Appearance" />
                </AdwPreferencesPage>,
            );
            expect(tree.type).toBe(RCT_VIEW);
            // The COLUMN is the widget and not the theme — a page whose groups sit side by
            // side is not a preferences page — so it is asserted here the way every other
            // container in this package asserts its own (`banner`, `button-content`,
            // `header-bar`, `toolbar-view`, `wrap-box`).
            expect(tree.props.style as Style).toStrictEqual({ flexDirection: 'column', alignSelf: 'stretch' });
            // `title`, `iconName` and `name` are identity, not paint — `Adw.PreferencesPage`
            // draws none of them either. Pinned as a NEGATIVE so the day one appears is a
            // decision and not a drift: no text node anywhere carries them.
            const drawn = texts(tree).map(([text]) => text);
            expect(drawn).not.toContain('General');
            expect(drawn).not.toContain('preferences-system-symbolic');
            expect(drawn).not.toContain('general');
            expect([
                textOf(childrenOf(tree)[0] as ReactTestRendererJSON),
                !hidden(childrenOf(tree)[0] as ReactTestRendererJSON),
            ]).toStrictEqual(['Everything else', true]);
        });

        await it('hides the description node when there is no description', async () => {
            const tree = mounted(<AdwPreferencesPage title="General" />);
            const description = childrenOf(tree)[0] as ReactTestRendererJSON;
            expect(textOf(description)).toBe('');
            expect(hidden(description)).toBe(true);
        });

        await it('centres the description only when asked, and asks with a style', async () => {
            const plain = mounted(<AdwPreferencesPage description="Everything else" />);
            const centred = mounted(<AdwPreferencesPage description="Everything else" descriptionCentered={true} />);
            const styleOf = (tree: ReactTestRendererJSON): Style =>
                flatten(tree).filter((n) => n.type === RCT_TEXT)[0]?.props.style as Style;
            expect(styleOf(plain)).toBe(undefined);
            expect(styleOf(centred)).toStrictEqual({ textAlign: 'center' });
        });
    });

    await describe('the group header both halves answer alike', async () => {
        await it('hides the description label when the description is empty — the pair', async () => {
            const tree = mounted(
                <AdwPreferencesGroup title="Appearance">
                    <AdwComboRow title="Style" model={['Light', 'Dark']} />
                </AdwPreferencesGroup>,
            );
            // The same two rows the GTK suite reads off `GtkLabel`s: the title carries its
            // text and is visible, the description is present, empty and not drawn.
            expect(headerLabels(tree)).toStrictEqual([
                ['Appearance', true],
                ['', false],
            ]);
        });

        await it('is a column of header over card, which is structure and not theme', async () => {
            const tree = mounted(
                <AdwPreferencesGroup title="Appearance" description="How it looks">
                    <AdwComboRow title="Style" model={['Light', 'Dark']} />
                </AdwPreferencesGroup>,
            );
            expect(tree.props.style as Style).toStrictEqual({ flexDirection: 'column', alignSelf: 'stretch' });
            // The header stacks its two labels; the card stacks its rows. Both are the
            // widget's own layout, and without them the group is a row of everything.
            expect((childrenOf(tree)[0] as ReactTestRendererJSON).props.style as Style).toStrictEqual({
                flexDirection: 'column',
            });
            expect((childrenOf(tree)[1] as ReactTestRendererJSON).props.style as Style).toStrictEqual({
                flexDirection: 'column',
                alignSelf: 'stretch',
            });
        });

        await it('shows both header labels when both are set — the pair', async () => {
            const tree = mounted(
                <AdwPreferencesGroup title="Appearance" description="How it looks">
                    <AdwComboRow title="Style" model={['Light', 'Dark']} />
                </AdwPreferencesGroup>,
            );
            expect(headerLabels(tree)).toStrictEqual([
                ['Appearance', true],
                ['How it looks', true],
            ]);
        });

        await it('hides the whole HEADER when neither label is set — the pair', async () => {
            // `update_header_visibility` is the third answer, and the only one the other
            // rows here cannot reach: with a title set the header box is visible whatever
            // else is true, so `headerVisible` could be replaced by `true` and stay green.
            // It is a three-way OR, and this fixture is the only input that falsifies all
            // three — which also pins the `hasHeaderSuffix: false` literal at the call site,
            // since a `true` there would keep the header up with no labels in it.
            const bare = mounted(
                <AdwPreferencesGroup>
                    <AdwComboRow title="Style" model={['Light', 'Dark']} />
                </AdwPreferencesGroup>,
            );
            expect(hidden(childrenOf(bare)[0] as ReactTestRendererJSON)).toBe(true);
            // …and the CARD is still there. A group with rows and no heading is a real
            // state, and hiding the header must not take the rows with it.
            expect(hidden(childrenOf(bare)[1] as ReactTestRendererJSON)).toBe(false);
        });

        await it('paints a pure-markup title, where GTK hides it — the divergence', async () => {
            // The README names this one. `derivePreferencesGroupHeader` reads the DISPLAYED
            // text, and `adw-preferences-group.ui` sets `use-markup` on both labels — so
            // `<b></b>` is an empty label on GTK. This half has no Pango and passes
            // `useMarkup: false`, which is the case the core documents that value for.
            // Asserted rather than described: passing `true` here would hide the label, and
            // the GTK suite asserts the other side of the same fixture.
            const tree = mounted(
                <AdwPreferencesGroup title="<b></b>">
                    <AdwComboRow title="Style" model={['Light', 'Dark']} />
                </AdwPreferencesGroup>,
            );
            expect(headerLabels(tree)).toStrictEqual([
                ['<b></b>', true],
                ['', false],
            ]);
        });

        await it('hides the CARD at zero rows and shows it at one — the pair', async () => {
            const empty = mounted(<AdwPreferencesGroup title="Appearance" />);
            // The card is the SECOND child of the group; the first is the header. Reading it
            // by position rather than by searching for a hidden node is deliberate — a search
            // would also match the empty description label and pass for the wrong reason.
            expect(hidden(childrenOf(empty)[1] as ReactTestRendererJSON)).toBe(true);
            // …and the header stays. An empty group still announces what it is.
            expect(headerLabels(empty)).toStrictEqual([
                ['Appearance', true],
                ['', false],
            ]);

            const filled = mounted(
                <AdwPreferencesGroup title="Appearance">
                    <AdwComboRow title="Style" model={['Light', 'Dark']} />
                </AdwPreferencesGroup>,
            );
            expect(hidden(childrenOf(filled)[1] as ReactTestRendererJSON)).toBe(false);
        });

        await it('counts an unrendered `&&` branch as no row, which `Children.count` would not', async () => {
            const show = false;
            const tree = mounted(
                <AdwPreferencesGroup title="Appearance">{show && <AdwSpinRow title="Scale" />}</AdwPreferencesGroup>,
            );
            // `{show && <Row/>}` puts a `false` in `children`, and THAT is where the two
            // readings part: measured on react 19, `Children.count(false)` is 1 while
            // `Children.toArray(false).length` is 0. So `count` would keep an empty card
            // painted. A `{show ? <Row/> : null}` fixture does NOT separate them — both answer
            // 0 for a bare `null` — which is why this row is written with `&&`, the form a
            // consumer actually writes.
            expect(hidden(childrenOf(tree)[1] as ReactTestRendererJSON)).toBe(true);
        });
    });

    await describe('the combo row both halves answer alike', async () => {
        await it('carries the model and the selected position — the pair', async () => {
            const tree = mounted(<AdwComboRow title="Style" model={['Light', 'Dark', 'System']} selected={1} />);
            // The GTK half reads `model.get_n_items() === 3` and `selected === 1`; here the
            // observable is the label the selection resolves to, which is the same fact read
            // through `ComboState`'s index↔label mapping.
            expect(valueLabel(tree)).toStrictEqual(['Dark', true]);
        });

        await it('is NOT a chooser at one option and IS at two — the pair', async () => {
            const one = mounted(<AdwComboRow title="Style" model={['Light']} />);
            const two = mounted(<AdwComboRow title="Style" model={['Light', 'Dark']} />);
            // `presentsChooser` is `n_items > 1`, the same predicate the GTK half exposes as
            // `Gtk.ListBoxRow:activatable`. Both effects are asserted: the chevron is present
            // and undrawn, and the row asks not to be pressed.
            expect(one.props.disabled).toBe(true);
            expect(two.props.disabled).toBe(false);
            const chevronOf = (tree: ReactTestRendererJSON): ReactTestRendererJSON =>
                flatten(tree).filter((n) => n.type === RCT_TEXT && textOf(n) === '▾')[0] as ReactTestRendererJSON;
            expect(hidden(childrenOf(one).filter((n) => n.children?.includes(chevronOf(one)))[0] ?? one)).toBe(true);
        });

        await it('moves the value into the subtitle under useSubtitle, once — the pair', async () => {
            const off = mounted(
                <AdwComboRow title="Style" subtitle="Authored" model={['Light', 'Dark']} selected={1} />,
            );
            const on = mounted(
                <AdwComboRow
                    title="Style"
                    subtitle="Authored"
                    model={['Light', 'Dark']}
                    selected={1}
                    useSubtitle={true}
                />,
            );
            // `adw-combo-row.ui` binds the inline value view's `visible` to `use-subtitle`
            // INVERTED, and `selection_changed` writes the item into the subtitle — so
            // libadwaita draws the value in exactly one place. BOTH readings are asserted,
            // because asserting only the subtitle passes over a row that draws it twice,
            // which is what this half did.
            expect(rowLabels(off)).toStrictEqual([
                ['Style', true],
                ['Authored', true],
            ]);
            expect(valueLabel(off)).toStrictEqual(['Dark', true]);
            expect(rowLabels(on)).toStrictEqual([
                ['Style', true],
                ['Dark', true],
            ]);
            expect(valueLabel(on)).toStrictEqual(['Dark', false]);
        });

        await it('spells an empty model’s selection the way the core does — the pair', async () => {
            // `ADW_COMBO_NO_SELECTION` is -1, and the label it resolves to is `''`. The GTK
            // half reads the same state as `GTK_INVALID_LIST_POSITION` and translates it to
            // -1 through `comboSelectedIndex`.
            const seen: number[] = [];
            const renderer = mount(<AdwComboRow title="Style" model={[]} onNotifySelected={(s) => seen.push(s)} />);
            const tree = renderer.toJSON() as ReactTestRendererJSON;
            expect(tree.props.disabled).toBe(true);
            expect(valueLabel(tree)).toStrictEqual(['', true]);

            // AND A PRESS INVENTS NOTHING, which is the row that separates `ComboState.select`
            // from `setSelectedIndex`. With no options the wrap is `(-1 + 1) % 0`, i.e. NaN:
            // `select` refuses it through `hasIndex`, while the permissive `setSelectedIndex`
            // would take a non-finite index to 0 and move the row from "nothing selected" to
            // "the first item" — of a model that has none. Measured: swapping the one call for
            // the other leaves every other assertion in this suite green and only this one red.
            press(tree);
            expect(seen).toStrictEqual([]);
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['', true]);
        });

        await it('advances on a press, and reports the position it moved to', async () => {
            const seen: number[] = [];
            const renderer = mount(
                <AdwComboRow
                    title="Style"
                    model={['Light', 'Dark', 'System']}
                    onNotifySelected={(s) => seen.push(s)}
                />,
            );
            press(renderer.toJSON() as ReactTestRendererJSON);
            expect(seen).toStrictEqual([1]);
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['Dark', true]);
            press(renderer.toJSON() as ReactTestRendererJSON);
            press(renderer.toJSON() as ReactTestRendererJSON);
            // Three presses over three options wrap back to the first, and every step was
            // reported — not "it did not throw".
            expect(seen).toStrictEqual([1, 2, 0]);
        });

        await it('does not re-apply an equal model handed to it as a fresh array', async () => {
            // `model={['Light', 'Dark']}` written inline is a NEW array every render, and
            // `setModel` is the one core setter with no unchanged-value guard: keyed on
            // the array's identity the mount effect would re-apply and re-emit on every
            // parent render, reporting a selection change nobody made. Keyed on the
            // CONTENT it is silent, which is what the GTK half does by not writing an
            // unchanged prop at all.
            const seen: number[] = [];
            const renderer = mount(
                <AdwComboRow
                    title="Style"
                    model={['Light', 'Dark']}
                    selected={1}
                    onNotifySelected={(v) => seen.push(v)}
                />,
            );
            expect(seen).toStrictEqual([]);
            act(() => {
                renderer.update(
                    <AdwComboRow
                        title="Theme"
                        model={['Light', 'Dark']}
                        selected={1}
                        onNotifySelected={(v) => seen.push(v)}
                    />,
                );
            });
            expect(seen).toStrictEqual([]);
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['Dark', true]);
        });

        await it('does nothing at one option — the press the chooser rule refuses', async () => {
            const seen: number[] = [];
            const renderer = mount(
                <AdwComboRow title="Style" model={['Light']} onNotifySelected={(s) => seen.push(s)} />,
            );
            press(renderer.toJSON() as ReactTestRendererJSON);
            // The claim is that NOTHING happened, so the assertion is the unchanged value and
            // the silent callback — never that no error was raised.
            //
            // WHAT REFUSES IT IS `ComboState.select`, and that is worth being exact about: the
            // double forwards `onPress` even under `disabled`, so the press really does reach
            // the widget, and what stops it is the core's own guard — a wrap over one option
            // lands back on the selected index, and `select` refuses the already-selected one.
            // A private `if (!presentsChooser) return;` in the widget was measured REDUNDANT
            // here (removing it left this row green) and has been removed rather than kept as
            // code no test can fail on.
            expect(seen).toStrictEqual([]);
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['Light', true]);
        });
    });

    await describe('the spin row both halves answer alike', async () => {
        await it('carries the authored range and value — the pair', async () => {
            const tree = mounted(
                <AdwSpinRow title="Scale" adjustment={{ lower: 0, upper: 200, stepIncrement: 25 }} value={50} />,
            );
            expect(valueLabel(tree)).toStrictEqual(['50', true]);
        });

        await it('clamps a value authored below the range — the pair', async () => {
            const tree = mounted(<AdwSpinRow title="Scale" adjustment={{ lower: 10, upper: 20 }} value={5} />);
            expect(valueLabel(tree)).toStrictEqual(['10', true]);
        });

        await it('takes a range that MOVES entirely, without clamping the value on the way', async () => {
            // `setValue` clamps against whatever range is installed at the time, and this
            // fixture is the one that can SEE that: every other row here straddles the
            // default 0…100, while this range sits entirely above it. It used to hold an
            // ORDER — four prop effects, bounds before value — because the range arrived as
            // three separate props; writing the value first clamped 250 to 100, and the
            // bounds then re-clamped it to 200. There is no order left to get wrong: the
            // range and the value go in one `configure`, which is why the stream below is
            // one number and not three.
            //
            // The INITIALISER is not held here either way: `mount` flushes effects inside
            // `act`, so the settled tree is the effects' answer. What the initialiser buys
            // is the first frame, which this harness cannot read — `create()` outside `act`
            // returns a null tree on React 19 (`render.spec.ts`).
            const tree = mounted(<AdwSpinRow title="Scale" adjustment={{ lower: 200, upper: 300 }} value={250} />);
            expect(valueLabel(tree)).toStrictEqual(['250', true]);

            const seen: number[] = [];
            const renderer = mount(
                <AdwSpinRow
                    title="Scale"
                    adjustment={{ lower: 0, upper: 100 }}
                    value={50}
                    onNotifyValue={(v) => seen.push(v)}
                />,
            );
            act(() => {
                renderer.update(
                    <AdwSpinRow
                        title="Scale"
                        adjustment={{ lower: 200, upper: 300 }}
                        value={250}
                        onNotifyValue={(v) => seen.push(v)}
                    />,
                );
            });
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['250', true]);
            // THE WHOLE STREAM, AND IT IS ONE NUMBER — which it was not before ADR 0047.
            // Three flat props were written one at a time, so `setMin(200)` ran while the
            // upper was still 100 and the range was momentarily INVERTED: the stream was
            // `[100, 200, 250]`, and the 100 was a real intermediate the GTK half never
            // produced. The range arrives as one value now and is written in one
            // `configure` with the value, so both halves notify exactly once.
            expect(seen).toStrictEqual([250]);
        });

        await it('re-clamps when a bound moves under the value — the pair', async () => {
            const seen: number[] = [];
            const renderer = mount(
                <AdwSpinRow
                    title="Scale"
                    adjustment={{ lower: 0, upper: 100 }}
                    value={80}
                    onNotifyValue={(v) => seen.push(v)}
                />,
            );
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['80', true]);
            act(() => {
                renderer.update(
                    <AdwSpinRow
                        title="Scale"
                        adjustment={{ lower: 0, upper: 50 }}
                        value={80}
                        onNotifyValue={(v) => seen.push(v)}
                    />,
                );
            });
            // 80 was legal and is not any more. Both halves answer 50 — and this half also
            // REPORTS it, because a consumer holding the value in its own state would
            // otherwise drift from the widget silently.
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['50', true]);
            expect(seen).toStrictEqual([50]);
        });

        await it('keeps a value the WIDGET moved across an unrelated re-render — the pair', async () => {
            // The same claim on this half, and it holds for the same mechanical reason the
            // GTK one does: the value effect keys on the PROP, which did not change, so a
            // stepped value is not written back to what was authored. `SpinState` is the
            // buffer here as the `Gtk.Adjustment` is there.
            const renderer = mount(
                <AdwSpinRow title="Scale" adjustment={{ lower: 0, upper: 100, stepIncrement: 10 }} value={50} />,
            );
            const increase = (): ReactTestRendererJSON =>
                flatten(renderer.toJSON() as ReactTestRendererJSON).filter(
                    (n) =>
                        n.type === RCT_VIEW &&
                        (n.children ?? []).some(
                            (c) => typeof c !== 'string' && textOf(c as ReactTestRendererJSON) === '+',
                        ),
                )[0] as ReactTestRendererJSON;
            press(increase());
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['60', true]);
            act(() => {
                renderer.update(
                    <AdwSpinRow title="Zoom" adjustment={{ lower: 0, upper: 100, stepIncrement: 10 }} value={50} />,
                );
            });
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['60', true]);
        });

        await it('formats the value with `digits` — the pair, as a STRING', async () => {
            const tree = mounted(
                <AdwSpinRow
                    title="Scale"
                    adjustment={{ lower: 0, upper: 10, stepIncrement: 1 }}
                    value={3.14159}
                    digits={2}
                />,
            );
            // The GTK half reads '3.14' back off the real widget's `GtkEditable` text.
            expect(valueLabel(tree)).toStrictEqual(['3.14', true]);
        });

        await it('steps by `step-increment` and stops at the bound', async () => {
            const seen: number[] = [];
            const renderer = mount(
                <AdwSpinRow
                    title="Scale"
                    adjustment={{ lower: 0, upper: 3, stepIncrement: 2 }}
                    value={0}
                    onNotifyValue={(v) => seen.push(v)}
                />,
            );
            const stepper = (glyph: string): ReactTestRendererJSON =>
                flatten(renderer.toJSON() as ReactTestRendererJSON).filter(
                    (n) =>
                        n.type === RCT_VIEW &&
                        (n.children ?? []).some(
                            (c) => typeof c !== 'string' && textOf(c as ReactTestRendererJSON) === glyph,
                        ),
                )[0] as ReactTestRendererJSON;
            const increase = (): ReactTestRendererJSON => stepper('+');
            const decrease = (): ReactTestRendererJSON => stepper('\u2212');

            // AT THE LOWER BOUND ALREADY, which is what the two buttons are FOR being in the
            // tree rather than absent: an absent button proves nothing about which end was
            // reached. The file says a suite can read this; without these four lines none
            // did, and both `disabled` expressions could be replaced by `false` with every
            // test still green.
            expect(decrease().props.disabled).toBe(true);
            expect(increase().props.disabled).toBe(false);

            press(increase());
            expect(seen).toStrictEqual([2]);
            expect(decrease().props.disabled).toBe(false);
            press(increase());
            // 2 + 2 is 4, the bound is 3, so the value CLAMPS rather than overshooting — and
            // the second press is a real change, so it reports.
            expect(seen).toStrictEqual([2, 3]);
            expect(increase().props.disabled).toBe(true);
            press(increase());
            // Already at the bound: `SpinState.increment` returns false and emits nothing.
            expect(seen).toStrictEqual([2, 3]);
            expect(valueLabel(renderer.toJSON() as ReactTestRendererJSON)).toStrictEqual(['3', true]);
        });
    });

    await describe('the password entry row both halves answer alike', async () => {
        await it('masks its contents on mount — the pair', async () => {
            const tree = mounted(<AdwPasswordEntryRow title="Password" text="hunter2" />);
            const input = flatten(tree).filter((n) => n.type === RCT_TEXT_INPUT)[0] as ReactTestRendererJSON;
            expect(input.props.value).toBe('hunter2');
            // The GTK half asserts the same state as `GtkText:visibility === false`.
            expect(input.props.secureTextEntry).toBe(true);
        });

        await it('counts `max-length` and truncates past it — the pair', async () => {
            const tree = mounted(<AdwPasswordEntryRow title="Password" text="abcdefgh" maxLength={4} />);
            const input = flatten(tree).filter((n) => n.type === RCT_TEXT_INPUT)[0] as ReactTestRendererJSON;
            expect(input.props.value).toBe('abcd');
            // `maxLength` is NOT handed to the platform, which is the measurement the core
            // exists for: `TextInput.maxLength` counts UTF-16 units where
            // `Adw.EntryRow:max-length` counts characters.
            expect(input.props.maxLength).toBe(undefined);
        });

        await it('counts CODE POINTS, where TextInput.maxLength would count UTF-16 units', async () => {
            // '🔒é' is 2 characters to GTK and 3 UTF-16 units to the platform. A limit of 2
            // therefore keeps the whole string here and would have cut the surrogate pair in
            // half had the prop been forwarded.
            const tree = mounted(<AdwPasswordEntryRow title="Password" text="🔒é" maxLength={2} />);
            const input = flatten(tree).filter((n) => n.type === RCT_TEXT_INPUT)[0] as ReactTestRendererJSON;
            expect(input.props.value).toBe('🔒é');
        });

        await it('unmasks on a peek press, and the button’s name flips with it', async () => {
            const renderer = mount(<AdwPasswordEntryRow title="Password" text="hunter2" />);
            const inputOf = (): ReactTestRendererJSON =>
                flatten(renderer.toJSON() as ReactTestRendererJSON).filter(
                    (n) => n.type === RCT_TEXT_INPUT,
                )[0] as ReactTestRendererJSON;

            expect(inputOf().props.secureTextEntry).toBe(true);
            press(labelled(renderer.toJSON() as ReactTestRendererJSON, 'Show Password'));
            expect(inputOf().props.secureTextEntry).toBe(false);
            // The label comes from `@gjsify/adwaita-core`, so the accessible name is one
            // string in one place across three renderers — and finding the button BY it is
            // what makes that load-bearing rather than decorative.
            press(labelled(renderer.toJSON() as ReactTestRendererJSON, 'Hide Password'));
            expect(inputOf().props.secureTextEntry).toBe(true);
        });

        await it('raises the apply button only after an edit, and clears it on apply', async () => {
            const applied: number[] = [];
            const renderer = mount(
                <AdwPasswordEntryRow title="Password" showApplyButton={true} onApply={() => applied.push(1)} />,
            );
            const applyOf = (): ReactTestRendererJSON => labelled(renderer.toJSON() as ReactTestRendererJSON, 'Apply');
            const input = (): ReactTestRendererJSON =>
                flatten(renderer.toJSON() as ReactTestRendererJSON).filter(
                    (n) => n.type === RCT_TEXT_INPUT,
                )[0] as ReactTestRendererJSON;

            // `applyButtonVisible` is `text_changed`, and the latch is `showApplyButton &&
            // editing` — so an edit while the row is NOT focused raises nothing. That is the
            // guard, asserted rather than assumed.
            expect(hidden(applyOf())).toBe(true);
            act(() => {
                (input().props.onFocus as () => void)();
            });
            act(() => {
                (input().props.onChangeText as (t: string) => void)('hunter2');
            });
            expect(hidden(applyOf())).toBe(false);
            press(applyOf());
            expect(applied).toStrictEqual([1]);
            expect(hidden(applyOf())).toBe(true);
        });

        await it('refuses edits when `editable` is false — the pair', async () => {
            const tree = mounted(<AdwPasswordEntryRow title="Password" text="hunter2" editable={false} />);
            const input = flatten(tree).filter((n) => n.type === RCT_TEXT_INPUT)[0] as ReactTestRendererJSON;
            expect(input.props.editable).toBe(false);
            // Omitted is TRUE, as `GtkEditable`'s own default is — not the `false` a missing
            // boolean prop would be if this half read the prop instead of the core's state.
            const dflt = mounted(<AdwPasswordEntryRow title="Password" text="hunter2" />);
            expect(
                (flatten(dflt).filter((n) => n.type === RCT_TEXT_INPUT)[0] as ReactTestRendererJSON).props.editable,
            ).toBe(true);
        });

        await it('fires exactly one of `apply` and `entry-activated` on Enter', async () => {
            const seen: string[] = [];
            const renderer = mount(
                <AdwPasswordEntryRow
                    title="Password"
                    showApplyButton={true}
                    onApply={() => seen.push('apply')}
                    onEntryActivated={() => seen.push('activated')}
                />,
            );
            const input = (): ReactTestRendererJSON =>
                flatten(renderer.toJSON() as ReactTestRendererJSON).filter(
                    (n) => n.type === RCT_TEXT_INPUT,
                )[0] as ReactTestRendererJSON;
            const submit = (): void => {
                act(() => {
                    (input().props.onSubmitEditing as () => void)();
                });
            };

            // Nothing pending: `text_activated_cb` emits `entry-activated`.
            submit();
            expect(seen).toStrictEqual(['activated']);

            // An edit while focused raises the apply latch, and Enter then emits `apply`
            // INSTEAD — which is the whole of `props.ts`' "exactly one of the two fires",
            // and was carried by neither suite.
            act(() => {
                (input().props.onFocus as () => void)();
            });
            act(() => {
                (input().props.onChangeText as (t: string) => void)('hunter2');
            });
            submit();
            expect(seen).toStrictEqual(['activated', 'apply']);

            // …and the latch is down again, so the next Enter is an activation.
            submit();
            expect(seen).toStrictEqual(['activated', 'apply', 'activated']);
        });

        await it('keeps the caps-lock indicator present and unshowable', async () => {
            // `indicatorVisible` is `editing && show_indicator`, and nothing on this half can
            // set `show_indicator`: React Native exposes no modifier state, and the surface
            // carries no prop libadwaita does not have. So the node is in the tree, hidden,
            // and this row is what stops it quietly disappearing — "no caps-lock warning" and
            // "no caps-lock support" must not be the same picture.
            const tree = mounted(<AdwPasswordEntryRow title="Password" text="hunter2" />);
            expect(hidden(labelled(tree, 'Caps Lock is on'))).toBe(true);
        });
    });
};
