/** @jsxImportSource react */
// `AdwPasswordEntryRow` on React Native — `update_empty` and the peek pair, run in
// TypeScript. (On the pragma, see `bin.native.tsx`.)
//
// TWO CORE STATES, COMPOSED THE WAY THE C SUBCLASSES. `@gjsify/adwaita-core`'s
// `PasswordEntryRowState` takes an `EntryRowState` in its constructor rather than extending
// it, mirroring `AdwPasswordEntryRow`, which IS a subclass but reaches its parent through the
// private `adw_entry_row_set_show_indicator` hook. So this file owns both objects and the
// coupling between them is the core's, not this file's.
//
// THE MASK IS THE ASSERTION. `secureTextEntry` is `gtk_text_set_visibility (FALSE)`, and the
// peek button is what flips it — `PasswordEntryRowState.togglePeek()` returns whether it
// changed, and `state.peekLabel` is the accessible name that flips with it, from the core so
// that "Show Password"/"Hide Password" is one string in one place across three renderers.
//
// THE CAPS-LOCK INDICATOR IS PRESENT AND CAN NEVER SHOW, and that is the honest shape rather
// than a missing feature. `indicatorVisible` is `editing && show_indicator`, and
// `show_indicator` is pushed by `PasswordEntryRowState._pushIndicator` from
// `!revealed && capsLockOn` — but React Native exposes no keyboard modifier state, so nothing
// on this half can ever set `capsLockOn`. The same wall `@gjsify/adwaita-nativescript` hit,
// which made `setCapsLockOn` a host seam. This half has no seam to offer (the surface carries
// no prop libadwaita does not have), so the node is in the tree, hidden, and the README says
// it can only ever be hidden. Rendering nothing instead would make "no caps-lock warning" and
// "no caps-lock support" the same picture.
//
// `maxLength` IS NOT HANDED TO `TextInput`, and that is the measurement the core exists for.
// `Adw.EntryRow:max-length` counts CHARACTERS; `TextInput.maxLength` counts UTF-16 units, so
// `'🔒é'` is 2 to GTK and 3 to the platform, and a limit of 2 cuts the surrogate pair in half.
// `clampEntryText`, which `EntryRowState.setText` already applies, counts code points.
//
// THE TITLE IS THE PLACEHOLDER OR THE LABEL, NEVER BOTH, and which one is `emptyTarget` — the
// endpoint of libadwaita's empty↔filled cross-fade. GTK animates between two title widgets
// over `EMPTY_ANIMATION_DURATION_MS`; here it is a hard swap at the two endpoints, the same
// compromise `@gjsify/adwaita-nativescript` makes, because a cross-fade needs an animation
// seam this slice does not add.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ENTRY_ROW_APPLY_TOOLTIP, EntryRowState, PasswordEntryRowState } from '@gjsify/adwaita-core';

import type { AdwPasswordEntryRowProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE, ADW_ROW_STYLE, ADW_ROW_TEXT_COLUMN_STYLE } from '../row-shell.native.js';

/**
 * The glyphs the apply button and the caps-lock indicator draw.
 *
 * `adw-entry-apply-symbolic` and `caps-lock-symbolic` are icon names — the core carries both
 * as data — and this package ships no icon renderer for React Native. NOT the ones
 * `@gjsify/adwaita-web` draws: that renderer masks a generated CSS class from the same names
 * and draws no text at all, so these are this half's own and are named in the README as a
 * divergence rather than as a shared fallback.
 */
const APPLY_GLYPH = '✓';

/** @see {@link APPLY_GLYPH} */
const CAPS_LOCK_GLYPH = '⇪';

/** The peek button's two glyphs, standing in for `view-reveal`/`view-conceal-symbolic`. */
const PEEK_GLYPHS = { revealed: '🙈', concealed: '👁' } as const;

/** {@link import('./password-entry-row.js').AdwPasswordEntryRow} on React Native. */
export function AdwPasswordEntryRow({
    title,
    text,
    maxLength,
    editable,
    showApplyButton,
    onNotifyText,
    onApply,
    onEntryActivated,
}: AdwPasswordEntryRowProps): ReactElement | null {
    // SEEDED IN THE INITIALISERS, not in effects: an effect runs after the first paint, so a
    // row mounted with `text` would render empty for a frame and the placeholder-vs-label
    // decision would flip visibly on a row that was never empty. The password state is built
    // over the SAME entry object — that is the whole coupling.
    const [row] = useState(() => {
        const state = new EntryRowState();
        state.setMaxLength(maxLength ?? 0);
        state.setEditable(editable !== false);
        state.setShowApplyButton(showApplyButton === true);
        state.setText(text ?? '');
        return state;
    });
    const [password] = useState(() => new PasswordEntryRowState(row));
    const [entry, setEntry] = useState(() => row.state);
    const [peek, setPeek] = useState(() => password.state);

    useEffect(() => row.subscribe(setEntry), [row]);
    useEffect(() => password.subscribe(setPeek), [password]);

    // One effect per property rather than one over all of them: each setter has its own guard
    // in the C — `setMaxLength` truncates and re-derives, `setShowApplyButton` retracts a
    // pending latch when turned OFF and does nothing when turned on — so a combined effect
    // would run four setters for one changed prop and the order in which it did so would
    // start to matter. Every setter is idempotent, so a re-run costs nothing.
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
            // `setText` returns the `notify::text` gate, and it is not decoration here: the
            // truncation happens INSIDE it, so a keystroke past `max-length` changes nothing
            // and must be silent.
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

    const togglePeek = useCallback(() => {
        password.togglePeek();
    }, [password]);

    return (
        <View style={ADW_ROW_STYLE}>
            <View style={ADW_ROW_TEXT_COLUMN_STYLE}>
                <Text style={entry.emptyTarget === 1 ? undefined : ADW_ROW_HIDDEN_STYLE}>{title ?? ''}</Text>
                <TextInput
                    value={entry.text}
                    editable={entry.editable}
                    secureTextEntry={!peek.revealed}
                    placeholder={entry.emptyTarget === 0 ? title : undefined}
                    onChangeText={changeText}
                    onFocus={beginEditing}
                    onBlur={endEditing}
                    onSubmitEditing={submit}
                />
            </View>
            <Text
                accessibilityLabel={peek.indicatorTooltip}
                style={entry.indicatorVisible ? undefined : ADW_ROW_HIDDEN_STYLE}
            >
                {CAPS_LOCK_GLYPH}
            </Text>
            <Pressable
                style={entry.applyButtonVisible ? undefined : ADW_ROW_HIDDEN_STYLE}
                accessibilityLabel={ENTRY_ROW_APPLY_TOOLTIP}
                onPress={apply}
            >
                <Text>{APPLY_GLYPH}</Text>
            </Pressable>
            <Pressable accessibilityLabel={peek.peekLabel} onPress={togglePeek}>
                <Text>{peek.revealed ? PEEK_GLYPHS.revealed : PEEK_GLYPHS.concealed}</Text>
            </Pressable>
        </View>
    );
}
