/** @jsxImportSource react */
// `AdwComboRow` on React Native — `Adw.ComboRow`'s selection model, run in TypeScript. (On
// the pragma, see `bin.native.tsx`.)
//
// `@gjsify/adwaita-core`'s `ComboState` IS `adw-combo-row.c`'s selection: the same
// index↔value mapping, the same autoselect when the model is replaced under a selection the
// new one does not have, the same `GTK_INVALID_LIST_POSITION` sentinel for an empty model,
// and the same `n_items > 1` chooser rule. So this file renders the answers libadwaita would
// have computed instead of `options[selected]`, which agrees with `Adw.ComboRow` while the
// model is static and nowhere else.
//
// THE CHOOSER RULE IS THE ONE A HAND-WRITTEN PORT DROPS. `model_changed` makes the arrow
// visible and the row activatable on `n_items > 1` and hides both otherwise — one item or
// none is not a choice, so the row stops LOOKING like one and tapping does nothing. Measured
// as three numbers this suite asserts: 0 options → no chevron, 1 → no chevron, 2 → chevron.
// `presentsChooser` is the shared predicate; the EFFECT is each renderer's own, and the two
// siblings already disagree about it (`@gjsify/adwaita-web` also disables its `<select>`,
// `@gjsify/adwaita-nativescript` only collapses the chevron and guards the tap). This half
// does both, because a `Pressable` that is present and inert is the shape a suite can read.
//
// THE MACHINE IS THE STATE, WHICH IS GObject'S CONTRACT AND NOT REACT'S — the same rule
// `entry-row.native.tsx` states for its buffer. `selected` seeds the row and overwrites it
// whenever the PROP changes; a pick the consumer does not echo back still stands. That is
// what the GTK half does too, for a mechanical reason rather than a matching decision:
// `@gjsify/gtk-host` patches a property only when the prop changes, so an unechoed pick
// survives there as well.
//
// THERE IS NO POPOVER. `Adw.ComboRow` opens a `GtkPopover` over a `GtkListView`; this half
// advances to the next option on each press and wraps, which is what a row with no overlay
// layer can do honestly. The README names it. What the press DOES exercise is the real
// `ComboState.select` guard — bounds and no-op-on-same — so the arithmetic under it is the
// shipped one.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ComboState, normalizeComboOptions } from '@gjsify/adwaita-core';

import type { AdwComboRowProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE, ADW_ROW_STYLE, AdwRowLabels } from '../row-shell.native.js';

/**
 * The glyph the chooser draws.
 *
 * `pan-down-symbolic` is an icon-theme name, this package ships no icon renderer for React
 * Native, and the two sibling renderers each answer that differently — `@gjsify/adwaita-web`
 * masks a generated CSS class from the name and draws no text, `@gjsify/adwaita-nativescript`
 * has a vendored SVG. So this glyph is this half's own and is named in the README as a
 * divergence rather than as a shared fallback.
 */
const CHEVRON_GLYPH = '▾';

/**
 * A model's content as one string, for a dependency that compares by VALUE.
 *
 * The separators are control characters rather than a space or a comma: an authored label may
 * contain either, and a key that two different models can share is a change this component
 * would not notice.
 */
const optionsKey = (model: AdwComboRowProps['model']): string =>
    normalizeComboOptions(model)
        .map((option) => `${option.value}\u0000${option.label}`)
        .join('\u0001');

/** {@link import('./combo-row.js').AdwComboRow} on React Native. */
export function AdwComboRow({
    title,
    subtitle,
    model,
    selected,
    useSubtitle,
    onNotifySelected,
}: AdwComboRowProps): ReactElement | null {
    // SEEDED IN THE INITIALISER, not in an effect: an effect runs after the first paint, so a
    // row mounted with `selected` would render the wrong label for a frame — and, worse, the
    // chevron would appear a frame after the row it belongs to.
    const [row] = useState(() => {
        const state = new ComboState();
        state.setOptions(normalizeComboOptions(model));
        if (selected !== undefined) state.setSelectedIndex(selected);
        return state;
    });
    const [snapshot, setSnapshot] = useState(() => ({
        selected: row.selectedIndex,
        label: row.selectedLabel,
        presentsChooser: row.presentsChooser,
    }));

    useEffect(
        () =>
            row.subscribe((change) => {
                setSnapshot({ selected: change.selected, label: change.label, presentsChooser: row.presentsChooser });
                // FIRED FOR A PROGRAMMATIC CHANGE TOO, and `props.ts` carries why: the GTK
                // half is a real GObject and `notify::selected` does not know where a change
                // came from, so gating this on `change.interactive` would make the two halves
                // disagree about the most ordinary thing a consumer does.
                onNotifySelected?.(change.selected);
            }),
        [row, onNotifySelected],
    );

    // One effect per property, for the reason `entry-row.native.tsx` gives: each setter has
    // its own guard in the C, so a combined effect would run both for one changed prop and
    // the order would start to matter.
    // The model's CONTENT as one comparable string. Both halves of every option, because an
    // option that changes only its `value` is a different model — and separators that cannot
    // occur in an authored label, so `['a b']` and `['a', 'b']` are two keys and not one.
    const key = optionsKey(model);

    // `setOptions` IS THE ONE SETTER WITH NO GUARD, and it needs this latch rather than
    // deserving one. Every other setter in the core early-outs on an unchanged value, so a
    // mount effect that re-applies what the initialiser already set is silent; `setOptions`
    // ALWAYS emits, because the label is read out of the MODEL and can change at an
    // unchanged index. Measured before this ref existed: mounting a combo row called
    // `onNotifySelected(0)` with nothing having happened — `[0, 1]` where a single press
    // should report `[1]` — and a one-option row, which cannot be picked at all, reported
    // `[0]`. The GTK half is silent there (setting a model that does not move the selection
    // fires no `notify::selected`), so this is the two halves agreeing, not a convenience.
    const appliedOptions = useRef(key);
    useEffect(() => {
        if (appliedOptions.current === key) return;
        appliedOptions.current = key;
        row.setOptions(normalizeComboOptions(model));
        // `key` and not `model` in the dependency, and `model` read inside: an inline
        // `model={['a','b']}` literal is a new array on every render, so depending on its
        // IDENTITY would re-run this — and therefore re-emit — forever.
    }, [row, key]);
    useEffect(() => {
        if (selected !== undefined) row.setSelectedIndex(selected);
    }, [row, selected]);

    const advance = useCallback(() => {
        // `select` is the USER pick and carries libadwaita's own guard: it refuses an index the
        // model does not have and refuses the already-selected one. Wrapping is this half's,
        // not the core's — there is no popover to pick from.
        //
        // THERE IS NO `if (!presentsChooser) return;` HERE, and its absence is measured rather
        // than assumed: with one option the wrap lands back on the selected index and `select`
        // refuses it; with none, `row.count` is 0, the modulo is NaN and `hasIndex` refuses
        // that too. The guard was written first and no mutation of it could turn a test red,
        // which makes it code that cannot be wrong and cannot be checked. `disabled` on the
        // Pressable is what a real platform honours; the core's guard is what holds when a
        // harness ignores it.
        row.select((row.selectedIndex + 1) % row.count);
    }, [row]);

    return (
        <Pressable
            style={ADW_ROW_STYLE}
            accessibilityRole="combobox"
            disabled={!snapshot.presentsChooser}
            onPress={advance}
        >
            <AdwRowLabels title={title} subtitle={useSubtitle === true ? snapshot.label : subtitle} />
            <Text>{snapshot.label}</Text>
            <View style={snapshot.presentsChooser ? undefined : ADW_ROW_HIDDEN_STYLE}>
                <Text>{CHEVRON_GLYPH}</Text>
            </View>
        </Pressable>
    );
}
