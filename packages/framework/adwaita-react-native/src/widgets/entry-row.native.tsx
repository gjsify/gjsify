/** @jsxImportSource react */
// `AdwEntryRow` on React Native — `update_empty` run in TypeScript.
// (On the pragma, see `bin.native.tsx`.)
//
// `@gjsify/adwaita-core`'s `EntryRowState` IS `adw-entry-row.c`: the same five-output
// truth table over the same four inputs, the same `text_changed` latch with both of its
// reset paths, the same character-counted truncation and the same two-way Enter dispatch.
// So this file renders the answers libadwaita would have computed instead of a
// `TextInput` with a floating label bolted on, which agrees with `Adw.EntryRow` while the
// row is idle and nowhere else.
//
// THE MACHINE IS THE BUFFER, WHICH IS GObject'S CONTRACT AND NOT REACT'S. `text` seeds
// the row and overwrites it whenever the PROP changes; a keystroke the consumer does not
// echo back still stands. That is what the GTK half does too, for a mechanical reason
// rather than a matching decision: `@gjsify/gtk-host` patches a property only when the
// prop changes, so an unechoed keystroke survives there as well. A strictly controlled
// spelling (`value={text}`) would make the two halves disagree on the most common
// interaction there is.
//
// `maxLength` IS NOT HANDED TO `TextInput`, and that is the measurement the core exists
// for. `Adw.EntryRow:max-length` counts CHARACTERS; `TextInput.maxLength` counts UTF-16
// units, so `'🔒é'` is 2 to GTK and 3 to the platform, and a limit of 2 cuts the surrogate
// pair in half. `clampEntryText`, which `EntryRowState.setText` already applies, counts
// code points.
//
// THE TITLE IS THE PLACEHOLDER OR THE LABEL, NEVER BOTH, and which one is
// `emptyTarget` — the endpoint of libadwaita's empty↔filled cross-fade. GTK animates
// between two title widgets over `EMPTY_ANIMATION_DURATION_MS`; here it is a hard swap at
// the two endpoints, the same compromise `@gjsify/adwaita-nativescript` makes, because a
// cross-fade needs an animation seam this slice does not add.
//
// WHAT IS DERIVED AND NOT DRAWN: `editIconVisible`, `editIconSensitive` and
// `indicatorVisible`. All three are icons, this package ships no icon renderer for React
// Native, and the last is driven only by the private hook `Adw.PasswordEntryRow` uses.
// The README carries the omission.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ENTRY_ROW_APPLY_TOOLTIP, EntryRowState } from '@gjsify/adwaita-core';

import type { AdwEntryRowProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE, ADW_ROW_STYLE, ADW_ROW_TEXT_COLUMN_STYLE } from '../row-shell.native.js';

/**
 * The glyph the apply button draws.
 *
 * `adw-entry-apply-symbolic` is a libadwaita-INTERNAL icon name — `ENTRY_ROW_APPLY_ICON_NAME`
 * carries it as data — and this package ships no icon renderer for React Native, so the
 * button stands in with a character. NOT the one `@gjsify/adwaita-web` draws: that renderer
 * masks a generated `.adw-icon--<name>` CSS class from the same name and draws no text at
 * all, so this glyph is this half's own and is named in the README as a divergence rather
 * than as a shared fallback. The tooltip beside it comes from core, so the accessible name
 * is one string in one place.
 */
const APPLY_GLYPH = '✓';

/** {@link import('./entry-row.js').AdwEntryRow} on React Native. */
export function AdwEntryRow({
    title,
    text,
    maxLength,
    editable,
    showApplyButton,
    onNotifyText,
    onApply,
    onEntryActivated,
}: AdwEntryRowProps): ReactElement | null {
    // SEEDED IN THE INITIALISER, not in an effect: an effect runs after the first paint,
    // so a row mounted with `text` would render empty for a frame and — worse — the
    // placeholder-vs-label decision would flip visibly on a row that was never empty.
    const [row] = useState(() => {
        const state = new EntryRowState();
        state.setMaxLength(maxLength ?? 0);
        state.setEditable(editable !== false);
        state.setShowApplyButton(showApplyButton === true);
        state.setText(text ?? '');
        return state;
    });
    const [snapshot, setSnapshot] = useState(() => row.state);

    useEffect(() => row.subscribe(setSnapshot), [row]);

    // One effect per property rather than one over all of them: each setter has its own
    // guard in the C — `setMaxLength` truncates and re-derives, `setShowApplyButton`
    // retracts a pending latch when turned OFF and does nothing when turned on — so a
    // combined effect would run four setters for one changed prop and the order in which
    // it did so would start to matter. Every setter is idempotent, so a re-run costs
    // nothing.
    useEffect(() => {
        row.setMaxLength(maxLength ?? 0);
    }, [row, maxLength]);
    useEffect(() => {
        row.setEditable(editable !== false);
    }, [row, editable]);
    useEffect(() => {
        row.setShowApplyButton(showApplyButton === true);
    }, [row, showApplyButton]);
    useEffect(() => {
        row.setText(text ?? '');
    }, [row, text]);

    const changeText = useCallback(
        (next: string) => {
            // `setText` returns the `notify::text` gate, and it is not decoration here:
            // the truncation happens INSIDE it, so a keystroke past `max-length` changes
            // nothing and must be silent.
            if (row.setText(next)) onNotifyText?.(row.text);
        },
        [row, onNotifyText],
    );

    const beginEditing = useCallback(() => {
        row.setEditing(true);
    }, [row]);
    const endEditing = useCallback(() => {
        row.setEditing(false);
    }, [row]);

    const apply = useCallback(() => {
        row.apply();
        onApply?.();
    }, [row, onApply]);

    const submit = useCallback(() => {
        // `text_activated_cb` emits exactly ONE of the two signals, and which one is the
        // latch's answer rather than this file's.
        const activation = row.activate();
        if (activation.signal === 'apply') onApply?.();
        else onEntryActivated?.();
    }, [row, onApply, onEntryActivated]);

    return (
        <View style={ADW_ROW_STYLE}>
            <View style={ADW_ROW_TEXT_COLUMN_STYLE}>
                <Text style={snapshot.emptyTarget === 1 ? undefined : ADW_ROW_HIDDEN_STYLE}>{title ?? ''}</Text>
                <TextInput
                    value={snapshot.text}
                    editable={snapshot.editable}
                    placeholder={snapshot.emptyTarget === 0 ? title : undefined}
                    onChangeText={changeText}
                    onFocus={beginEditing}
                    onBlur={endEditing}
                    onSubmitEditing={submit}
                />
            </View>
            <Pressable
                style={snapshot.applyButtonVisible ? undefined : ADW_ROW_HIDDEN_STYLE}
                accessibilityLabel={ENTRY_ROW_APPLY_TOOLTIP}
                onPress={apply}
            >
                <Text>{APPLY_GLYPH}</Text>
            </Pressable>
        </View>
    );
}
