/** @jsxImportSource react */
// The React Native halves of the five boxed-list rows, through React's real reconciler.
//
// ONE FILE FOR FIVE WIDGETS, on purpose and not for brevity. Every claim below has a
// counterpart in `rows.gtk.spec.tsx` under the same `describe` name, and the pairs only
// stay pairs if they are written where a reader can see both — the package already does
// this for `AdwBin`, whose GTK coverage lives in `clamp.gtk.spec.tsx`.
//
// WHERE EACH ASSERTION READS FROM, and why it is two places. Nesting and styles come off
// `toJSON()`, which is the HOST tree. Press behaviour comes off
// `renderer.root.findByType(Pressable)`, which is the COMPOSITE the widget rendered:
// real `Pressable` turns `onPress` into responder handlers rather than forwarding it to
// the host node, so reading `onPress` off `toJSON()` would assert a property of the
// double instead of a property of the widget. `../testing/react-native.ts` carries that.
//
// WHAT IS NOT MEASURED HERE is Yoga and the device — a `flexDirection` in a style object
// is an instruction to a layout engine that is not in this process. The README says so;
// the GTK half of this package is where "and it got it" is asserted.
//
// The harness — the act environment, the renderer, `textOf` — is `../testing/render.spec.ts`.
// The bundle is built WITHOUT the production define for the reason that file measures:
// `act()` exists only in React's development build.

import { describe, expect, it } from '@gjsify/unit';
import { act, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import { BUTTON_ROW_ACTIVATABLE } from '@gjsify/adwaita-core';

// THE COMPONENTS COME FROM `react-native`, THE HOST NAMES FROM THE DOUBLE, and mixing
// them up costs the whole file. `renderer.root.findByType(X)` matches by function
// IDENTITY, and the widgets import `'react-native'` — which `build:test:node` aliases
// onto the double's BUILT `lib/esm` module. A spec importing the double's `src` module
// instead holds a second copy of every component, so `findByType` finds nothing:
// measured, 15 of 64 tests failed with `No instances found with node type: "Pressable"`
// while every `toJSON()` assertion beside them passed. The `RCT_*` names are plain
// strings, so their module instance cannot matter.
import { Pressable, Switch, TextInput, View } from 'react-native';

import { RCT_SWITCH, RCT_TEXT, RCT_TEXT_INPUT, RCT_VIEW } from '../testing/react-native.js';
import { mount, textOf, type Style } from '../testing/render.spec.js';
import { AdwActionRow } from './action-row.native.js';
import { AdwButtonRow } from './button-row.native.js';
import { AdwEntryRow } from './entry-row.native.js';
import { AdwExpanderRow } from './expander-row.native.js';
import { AdwSwitchRow } from './switch-row.native.js';

/** The row skeleton `../row-shell.native.tsx` emits, as the literal both halves are read against. */
const ROW_STYLE = { flexDirection: 'row', alignItems: 'center' };
const TEXT_COLUMN_STYLE = { flexDirection: 'column', flexGrow: 1, flexShrink: 1 };
const HIDDEN_STYLE = { display: 'none' };

/** The glyphs `expander-row.native.tsx` stands in for `pan-down`/`pan-up-symbolic` with. */
const CHEVRON_COLLAPSED = '▾';
const CHEVRON_EXPANDED = '▴';

const json = (renderer: ReactTestRenderer): ReactTestRendererJSON => renderer.toJSON() as ReactTestRendererJSON;

/** The element children of a host node, with text nodes dropped. */
const elementChildren = (node: ReactTestRendererJSON): ReactTestRendererJSON[] =>
    ((node.children ?? []) as unknown[]).filter((child) => typeof child !== 'string') as ReactTestRendererJSON[];

/** The first host node of `type` in the rendered tree, breadth-first. */
function host(node: ReactTestRendererJSON, type: string): ReactTestRendererJSON {
    const queue: ReactTestRendererJSON[] = [node];
    while (queue.length > 0) {
        const current = queue.shift() as ReactTestRendererJSON;
        if (current.type === type) return current;
        queue.push(...elementChildren(current));
    }
    throw new Error(`no <${type}> in ${JSON.stringify(node)}`);
}

/** The `index`-th element child, named rather than indexed twice at every call site. */
function child(node: ReactTestRendererJSON, index: number): ReactTestRendererJSON {
    const found = elementChildren(node)[index];
    if (found === undefined) throw new Error(`no child ${index} in ${JSON.stringify(node)}`);
    return found;
}

/** The two labels of a row, in `AdwRowLabels`'s fixed order: title, then subtitle. */
function labels(tree: ReactTestRendererJSON): [ReactTestRendererJSON, ReactTestRendererJSON] {
    const texts = elementChildren(child(tree, 0));
    if (texts.length !== 2) throw new Error(`expected two labels, got ${JSON.stringify(texts)}`);
    return [texts[0] as ReactTestRendererJSON, texts[1] as ReactTestRendererJSON];
}

export default async () => {
    await describe('AdwActionRow on React Native — the tree it emits', async () => {
        await it('is a pressable row holding the label column, then the suffix', async () => {
            const tree = json(
                mount(
                    <AdwActionRow title="Wi-Fi" subtitle="Connected">
                        <View testID="suffix" />
                    </AdwActionRow>,
                ),
            );
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.props.style as Style).toStrictEqual(ROW_STYLE);

            const children = elementChildren(tree);
            expect(children.length).toBe(2);
            expect(children[0]?.props.style as Style).toStrictEqual(TEXT_COLUMN_STYLE);
            expect(children[1]?.props.testID).toBe('suffix');
        });

        await it('hides the TITLE too when it is empty, not only the subtitle', async () => {
            // `string_is_not_empty` is bound to BOTH labels in `adw-action-row.ui`, and
            // the title's is the half a hand-written port drops. Both nodes stay in the
            // tree so the suite can say WHICH one is hidden.
            const [title, subtitle] = labels(json(mount(<AdwActionRow subtitle="Connected" />)));
            expect(title.props.style as Style).toStrictEqual(HIDDEN_STYLE);
            expect(textOf(subtitle)).toBe('Connected');
            expect(subtitle.props.style as Style).toBe(undefined);
        });

        await it('hides the subtitle when it is empty, and keeps the title', async () => {
            const [title, subtitle] = labels(json(mount(<AdwActionRow title="Wi-Fi" />)));
            expect(textOf(title)).toBe('Wi-Fi');
            expect(title.props.style as Style).toBe(undefined);
            expect(subtitle.props.style as Style).toStrictEqual(HIDDEN_STYLE);
        });
    });

    await describe('AdwActionRow on React Native — activation', async () => {
        await it('is inert unless activatable, which is libadwaita’s own default', async () => {
            // `Adw.ActionRow`'s template sets `activatable=False`, and
            // `rows.gtk.spec.tsx` reads that same `false` off the real widget.
            const renderer = mount(<AdwActionRow title="Wi-Fi" />);
            expect(renderer.root.findByType(Pressable).props.disabled).toBe(true);
        });

        await it('presses through to `activated` once the row is activatable', async () => {
            let activations = 0;
            const renderer = mount(
                <AdwActionRow
                    title="Wi-Fi"
                    activatable={true}
                    onActivated={() => {
                        activations += 1;
                    }}
                />,
            );
            const pressable = renderer.root.findByType(Pressable);
            expect(pressable.props.disabled).toBe(false);
            act(() => {
                (pressable.props.onPress as () => void)();
            });
            expect(activations).toBe(1);
        });
    });

    await describe('AdwButtonRow on React Native — the tree it emits', async () => {
        await it('centres its one label and is always activatable', async () => {
            // NOT `disabled={false}` written here: `BUTTON_ROW_ACTIVATABLE` is core's,
            // and `rows.gtk.spec.tsx` reads the same `true` off `Adw.ButtonRow`'s own
            // `activatable` property in the installed libadwaita.
            expect(BUTTON_ROW_ACTIVATABLE).toBe(true);
            const renderer = mount(<AdwButtonRow title="Add Account" />);
            const tree = json(renderer);
            expect(tree.props.style as Style).toStrictEqual({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
            });
            expect(renderer.root.findByType(Pressable).props.disabled).toBe(false);

            const label = host(tree, RCT_TEXT);
            expect(textOf(label)).toBe('Add Account');
            expect(label.props.style as Style).toBe(undefined);
        });

        await it('hides its label when the title is empty', async () => {
            const label = host(json(mount(<AdwButtonRow />)), RCT_TEXT);
            expect(label.props.style as Style).toStrictEqual(HIDDEN_STYLE);
        });

        await it('emits `activated` on a press', async () => {
            let activations = 0;
            const renderer = mount(
                <AdwButtonRow
                    title="Add Account"
                    onActivated={() => {
                        activations += 1;
                    }}
                />,
            );
            act(() => {
                (renderer.root.findByType(Pressable).props.onPress as () => void)();
            });
            expect(activations).toBe(1);
        });
    });

    await describe('AdwSwitchRow on React Native — two routes into one transition', async () => {
        await it('shows the controlled value on a real Switch', async () => {
            const tree = json(mount(<AdwSwitchRow title="Developer mode" />));
            expect(tree.type).toBe(RCT_VIEW);
            expect(host(tree, RCT_SWITCH).props.value).toBe(false);
            expect(host(json(mount(<AdwSwitchRow title="x" active={true} />)), RCT_SWITCH).props.value).toBe(true);
        });

        await it('inverts when the ROW is pressed, not only the handle', async () => {
            // `adw_switch_row_init` points the activatable widget at the slider, so the
            // title is part of the control. `SwitchRowState.activate()` is that rule.
            const seen: boolean[] = [];
            const renderer = mount(<AdwSwitchRow title="x" active={false} onNotifyActive={(a) => seen.push(a)} />);
            act(() => {
                (renderer.root.findByType(Pressable).props.onPress as () => void)();
            });
            expect(seen).toStrictEqual([true]);
        });

        await it('inverts the other way from an ON row', async () => {
            const seen: boolean[] = [];
            const renderer = mount(<AdwSwitchRow title="x" active={true} onNotifyActive={(a) => seen.push(a)} />);
            act(() => {
                (renderer.root.findByType(Pressable).props.onPress as () => void)();
            });
            expect(seen).toStrictEqual([false]);
        });

        await it('notifies for a handle drag that changes the value', async () => {
            const seen: boolean[] = [];
            const renderer = mount(<AdwSwitchRow title="x" active={false} onNotifyActive={(a) => seen.push(a)} />);
            act(() => {
                (renderer.root.findByType(Switch).props.onValueChange as (v: boolean) => void)(true);
            });
            expect(seen).toStrictEqual([true]);
        });

        await it('stays SILENT for a set to the value already held', async () => {
            // `adw_switch_row_set_active` early-returns on an unchanged value BEFORE it
            // writes the slider, so libadwaita emits nothing — the gate
            // `SwitchRowState.setActive` returns. A renderer that re-emits whatever its
            // platform hands it reads a redelivery as a user change.
            const seen: boolean[] = [];
            const renderer = mount(<AdwSwitchRow title="x" active={false} onNotifyActive={(a) => seen.push(a)} />);
            act(() => {
                (renderer.root.findByType(Switch).props.onValueChange as (v: boolean) => void)(false);
            });
            expect(seen).toStrictEqual([]);
        });
    });

    await describe('AdwExpanderRow on React Native — the disclosure', async () => {
        /** `[header, disclosure]` — the expander's two element children, in order. */
        const halves = (renderer: ReactTestRenderer): [ReactTestRendererJSON, ReactTestRendererJSON] => {
            const tree = json(renderer);
            const parts = elementChildren(tree);
            if (parts.length !== 2) throw new Error(`expected a header and a disclosure, got ${JSON.stringify(parts)}`);
            return [parts[0] as ReactTestRendererJSON, parts[1] as ReactTestRendererJSON];
        };

        /** The chevron — the last element child of the header. */
        const chevron = (renderer: ReactTestRenderer): string => {
            const parts = elementChildren(halves(renderer)[0]);
            return textOf(parts[parts.length - 1] as ReactTestRendererJSON);
        };

        await it('is a header row and a disclosure that is HIDDEN, not absent', async () => {
            // Hidden and still in the tree, because that is what GTK does: the disclosed
            // child sits under a `Gtk.Revealer`, which leaves it parented and unmapped —
            // `rows.gtk.spec.tsx` asserts exactly that, 0×0 with a live parent. Rendering
            // `null` here would look identical and lose every child's state on a collapse.
            const renderer = mount(
                <AdwExpanderRow title="Advanced" subtitle="More options">
                    <View testID="disclosed" />
                </AdwExpanderRow>,
            );
            const tree = json(renderer);
            expect(tree.type).toBe(RCT_VIEW);
            // No style on the outer node: a `View` already stacks its children in a
            // column, so writing one would be a second author for React Native's default.
            expect(tree.props.style as Style).toBe(undefined);

            const [header, disclosure] = halves(renderer);
            expect(header.props.style as Style).toStrictEqual(ROW_STYLE);
            expect(disclosure.props.style as Style).toStrictEqual(HIDDEN_STYLE);
            expect(child(disclosure, 0).props.testID).toBe('disclosed');
            expect(chevron(renderer)).toBe(CHEVRON_COLLAPSED);
        });

        await it('starts revealed when `expanded` is written', async () => {
            const renderer = mount(
                <AdwExpanderRow title="Advanced" expanded={true}>
                    <View testID="disclosed" />
                </AdwExpanderRow>,
            );
            expect(halves(renderer)[1].props.style as Style).toBe(undefined);
            expect(chevron(renderer)).toBe(CHEVRON_EXPANDED);
        });

        await it('reveals on a HEADER press, and reports the new flag once', async () => {
            const seen: boolean[] = [];
            const renderer = mount(
                <AdwExpanderRow title="Advanced" onNotifyExpanded={(open) => seen.push(open)}>
                    <View testID="disclosed" />
                </AdwExpanderRow>,
            );
            act(() => {
                (renderer.root.findByType(Pressable).props.onPress as () => void)();
            });
            expect(seen).toStrictEqual([true]);
            expect(halves(renderer)[1].props.style as Style).toBe(undefined);
            expect(chevron(renderer)).toBe(CHEVRON_EXPANDED);
        });

        await it('collapses again on a second press', async () => {
            const seen: boolean[] = [];
            const renderer = mount(<AdwExpanderRow title="Advanced" onNotifyExpanded={(open) => seen.push(open)} />);
            const press = renderer.root.findByType(Pressable).props.onPress as () => void;
            act(() => press());
            act(() => press());
            expect(seen).toStrictEqual([true, false]);
            expect(halves(renderer)[1].props.style as Style).toStrictEqual(HIDDEN_STYLE);
        });

        await it('the ROW owns the flag — an unechoed toggle survives a re-render', async () => {
            // GObject's contract, not React's, and `rows.gtk.spec.tsx` asserts the same
            // thing on the real widget: a disclosure the user opened and the consumer did
            // not echo back into the prop is still open after the next render.
            const seen: boolean[] = [];
            const element = (
                <AdwExpanderRow title="Advanced" expanded={false} onNotifyExpanded={(open) => seen.push(open)} />
            );
            const renderer = mount(element);
            act(() => {
                (renderer.root.findByType(Pressable).props.onPress as () => void)();
            });
            act(() => {
                renderer.update(element);
            });
            expect(halves(renderer)[1].props.style as Style).toBe(undefined);
            expect(seen).toStrictEqual([true]);
        });

        await it('a prop CHANGE re-seeds the row, and is not echoed back', async () => {
            // The other side of the same rule: `false` written again is no change and
            // reaches nothing, so taking a disclosure back needs the prop to MOVE. When
            // it does, the consumer is hearing its own write, so nothing is reported —
            // the echo `@gjsify/gtk-host`'s host-write guard drops on the other half.
            const seen: boolean[] = [];
            const renderer = mount(
                <AdwExpanderRow title="Advanced" expanded={true} onNotifyExpanded={(open) => seen.push(open)} />,
            );
            expect(halves(renderer)[1].props.style as Style).toBe(undefined);
            act(() => {
                renderer.update(
                    <AdwExpanderRow title="Advanced" expanded={false} onNotifyExpanded={(open) => seen.push(open)} />,
                );
            });
            expect(halves(renderer)[1].props.style as Style).toStrictEqual(HIDDEN_STYLE);
            expect(chevron(renderer)).toBe(CHEVRON_COLLAPSED);
            expect(seen).toStrictEqual([]);
        });
    });

    await describe('AdwEntryRow on React Native — update_empty’s endpoints', async () => {
        await it('is a placeholder while empty, and no floating label', async () => {
            const tree = json(mount(<AdwEntryRow title="Endpoint" />));
            expect(child(child(tree, 0), 0).props.style as Style).toStrictEqual(HIDDEN_STYLE);
            expect(host(tree, RCT_TEXT_INPUT).props.placeholder).toBe('Endpoint');
        });

        await it('is a floating label once there is a value, and no placeholder', async () => {
            const tree = json(mount(<AdwEntryRow title="Endpoint" text="https://example.invalid" />));
            const floating = child(child(tree, 0), 0);
            expect(floating.props.style as Style).toBe(undefined);
            expect(textOf(floating)).toBe('Endpoint');
            const input = host(tree, RCT_TEXT_INPUT);
            expect(input.props.placeholder).toBe(undefined);
            expect(input.props.value).toBe('https://example.invalid');
        });

        await it('takes `editable` to the entry', async () => {
            expect(host(json(mount(<AdwEntryRow title="x" editable={false} />)), RCT_TEXT_INPUT).props.editable).toBe(
                false,
            );
        });
    });

    await describe('AdwEntryRow on React Native — max-length counts CHARACTERS', async () => {
        await it('keeps two code points where TextInput.maxLength would keep two UNITS', async () => {
            // The measurement the core exists for: `'🔒é'` is 2 characters and 3 UTF-16
            // units, so a platform limit of 2 cuts the surrogate pair in half.
            // `clampEntryText`, which `EntryRowState.setText` applies, counts code points.
            const typed = '🔒éx';
            expect([...typed].length).toBe(3);
            expect(typed.length).toBe(4);

            const seen: string[] = [];
            const renderer = mount(<AdwEntryRow title="x" maxLength={2} onNotifyText={(t) => seen.push(t)} />);
            act(() => {
                (renderer.root.findByType(TextInput).props.onChangeText as (t: string) => void)(typed);
            });
            expect(seen).toStrictEqual(['🔒é']);
            expect([...(seen[0] as string)].length).toBe(2);
            expect((seen[0] as string).length).toBe(3);
        });

        await it('does NOT hand the limit to the platform, which would count units', async () => {
            const input = json(mount(<AdwEntryRow title="x" maxLength={2} />));
            expect(host(input, RCT_TEXT_INPUT).props.maxLength).toBe(undefined);
        });

        await it('is silent for a keystroke the truncation swallows', async () => {
            // `setText` returns the `notify::text` gate and the truncation happens inside
            // it, so typing past the limit changes nothing and must not notify.
            const seen: string[] = [];
            const renderer = mount(
                <AdwEntryRow title="x" text="ab" maxLength={2} onNotifyText={(t) => seen.push(t)} />,
            );
            act(() => {
                (renderer.root.findByType(TextInput).props.onChangeText as (t: string) => void)('abc');
            });
            expect(seen).toStrictEqual([]);
        });
    });

    await describe('AdwEntryRow on React Native — the apply latch', async () => {
        const typeInto = (renderer: ReactTestRenderer, value: string, focused: boolean): void => {
            const input = renderer.root.findByType(TextInput);
            if (focused) act(() => (input.props.onFocus as () => void)());
            act(() => (input.props.onChangeText as (t: string) => void)(value));
        };

        /** The apply button's style — `undefined` while it shows, hidden while it does not. */
        const applyStyle = (renderer: ReactTestRenderer): Style => child(json(renderer), 1).props.style as Style;

        await it('stays down while the row is not being edited', async () => {
            // `text_changed_cb` latches on `show_apply_button && editing`, and the
            // `editing` half is the corner a hand-written port drops.
            const renderer = mount(<AdwEntryRow title="x" showApplyButton={true} />);
            typeInto(renderer, 'a', false);
            expect(applyStyle(renderer)).toStrictEqual(HIDDEN_STYLE);
        });

        await it('comes up when an EDITING row changes its text', async () => {
            const renderer = mount(<AdwEntryRow title="x" showApplyButton={true} />);
            typeInto(renderer, 'a', true);
            expect(applyStyle(renderer)).toBe(undefined);
        });

        await it('needs `show-apply-button`, latch or no latch', async () => {
            const renderer = mount(<AdwEntryRow title="x" />);
            typeInto(renderer, 'a', true);
            expect(applyStyle(renderer)).toStrictEqual(HIDDEN_STYLE);
        });

        await it('sends Enter to `apply` while the latch is up and to `entry-activated` while it is down', async () => {
            // `text_activated_cb` emits exactly ONE of the two, and the latch decides.
            const fired: string[] = [];
            const renderer = mount(
                <AdwEntryRow
                    title="x"
                    showApplyButton={true}
                    onApply={() => fired.push('apply')}
                    onEntryActivated={() => fired.push('entry-activated')}
                />,
            );
            const input = renderer.root.findByType(TextInput);
            act(() => (input.props.onSubmitEditing as () => void)());
            expect(fired).toStrictEqual(['entry-activated']);

            typeInto(renderer, 'a', true);
            act(() => (input.props.onSubmitEditing as () => void)());
            expect(fired).toStrictEqual(['entry-activated', 'apply']);

            // …and applying retracts the latch, so the NEXT Enter is the other signal.
            act(() => (input.props.onSubmitEditing as () => void)());
            expect(fired).toStrictEqual(['entry-activated', 'apply', 'entry-activated']);
        });

        await it('retracts a pending latch when the apply button is pressed', async () => {
            const fired: string[] = [];
            const renderer = mount(
                <AdwEntryRow title="x" showApplyButton={true} onApply={() => fired.push('apply')} />,
            );
            typeInto(renderer, 'a', true);
            expect(applyStyle(renderer)).toBe(undefined);

            act(() => (renderer.root.findByType(Pressable).props.onPress as () => void)());
            expect(fired).toStrictEqual(['apply']);
            expect(applyStyle(renderer)).toStrictEqual(HIDDEN_STYLE);
        });
    });
};
