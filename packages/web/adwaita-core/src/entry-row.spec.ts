// Entry-row derivation specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME truth table.

import { describe, it, expect } from '@gjsify/unit';

import {
    CAPS_LOCK_ICON_NAME,
    CAPS_LOCK_TOOLTIP,
    EMPTY_ANIMATION_DURATION_MS,
    ENTRY_ROW_MAX_LENGTH_LIMIT,
    ENTRY_ROW_TITLE_SPACING,
    EntryRowState,
    PASSWORD_CONCEAL_ICON_NAME,
    PASSWORD_CONCEAL_LABEL,
    PASSWORD_REVEAL_ICON_NAME,
    PASSWORD_REVEAL_LABEL,
    PasswordEntryRowState,
    clampEntryText,
    entryTextLength,
} from './entry-row.js';
import {
    ENTRY_MAX_LENGTH_VECTORS,
    ENTRY_ROW_ACTIVATION_VECTORS,
    ENTRY_ROW_GUARD_VECTORS,
    ENTRY_ROW_STATE_VECTORS,
    ENTRY_TEXT_LENGTH_VECTORS,
    PASSWORD_ENTRY_ROW_VECTORS,
    PASSWORD_REVEAL_GUARD_VECTORS,
    type EntryRowStep,
    type PasswordEntryRowStep,
} from './conformance/entry-row.js';

/** Replay one vector step against a headless entry row; `null` for the `void` setters. */
function applyStep(state: EntryRowState, step: EntryRowStep): boolean | null {
    switch (step.op) {
        case 'setText':
            return state.setText(step.value);
        case 'setEditing':
            return state.setEditing(step.value);
        case 'setEditable':
            return state.setEditable(step.value);
        case 'setMaxLength':
            return state.setMaxLength(step.value);
        case 'setShowApplyButton':
            return state.setShowApplyButton(step.value);
        case 'setShowIndicator':
            state.setShowIndicator(step.value);
            return null;
        case 'setActivatesDefault':
            return state.setActivatesDefault(step.value);
        case 'apply':
            state.apply();
            return null;
    }
}

/** Replay one password vector step; `entry` steps go to the composed row. */
function applyPasswordStep(password: PasswordEntryRowState, entry: EntryRowState, step: PasswordEntryRowStep): void {
    switch (step.op) {
        case 'setRevealed':
            password.setRevealed(step.value);
            return;
        case 'togglePeek':
            password.togglePeek();
            return;
        case 'setCapsLockOn':
            password.setCapsLockOn(step.value);
            return;
        case 'entry':
            applyStep(entry, step.step);
            return;
    }
}

export default async () => {
    await describe('entryTextLength (Adw.EntryRow:text-length)', async () => {
        for (const { text, length, rule } of ENTRY_TEXT_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} → ${length} — ${rule}`, () => {
                expect(entryTextLength(text)).toBe(length);
            });
        }

        await it('counts characters, not UTF-16 units', () => {
            // The regression this table exists for: `.length` is 3 here.
            expect('🔒é'.length).toBe(3);
            expect(entryTextLength('🔒é')).toBe(2);
        });

        await it('treats a missing value as empty', () => {
            expect(entryTextLength(undefined as unknown as string)).toBe(0);
        });
    });

    await describe('clampEntryText (Adw.EntryRow:max-length)', async () => {
        for (const { text, maxLength, clamped, length, rule } of ENTRY_MAX_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} @ ${maxLength} → ${JSON.stringify(clamped)} — ${rule}`, () => {
                expect(clampEntryText(text, maxLength)).toBe(clamped);

                // …and the same through the state machine, which is where a
                // renderer actually meets it.
                const state = new EntryRowState();
                state.setMaxLength(maxLength);
                state.setText(text);
                expect(state.text).toBe(clamped);
                expect(state.textLength).toBe(length);
            });
        }

        await it('never splits a surrogate pair', () => {
            // A naive slice(0, 2) yields the lone high surrogate '\uD83D'.
            expect(clampEntryText('🔒é🔑', 2)).toBe('🔒é');
            expect([...clampEntryText('🔒é🔑', 1)]).toHaveLength(1);
        });

        await it('clamps the limit itself into the property range', () => {
            const state = new EntryRowState();
            state.setMaxLength(-5);
            expect(state.maxLength).toBe(0);
            state.setMaxLength(1e9);
            expect(state.maxLength).toBe(ENTRY_ROW_MAX_LENGTH_LIMIT);
        });
    });

    await describe('EntryRowState update_empty (libadwaita conformance vectors)', async () => {
        for (const { name, steps, expected, rule } of ENTRY_ROW_STATE_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const state = new EntryRowState();
                for (const step of steps) applyStep(state, step);
                expect(state.state).toStrictEqual(expected);
            });
        }

        await it('pushes the same snapshot to every subscriber', () => {
            const state = new EntryRowState();
            const seen: unknown[] = [];
            state.subscribe((s) => seen.push(s));
            state.subscribe((s) => seen.push(s));
            state.setText('A');
            expect(seen).toHaveLength(2);
            expect(seen[0]).toStrictEqual(state.state);
            expect(seen[1]).toStrictEqual(state.state);
        });

        await it('stops notifying after unsubscribe', () => {
            const state = new EntryRowState();
            let calls = 0;
            const off = state.subscribe(() => calls++);
            state.setText('A');
            off();
            state.setText('B');
            expect(calls).toBe(1);
        });
    });

    await describe('EntryRowState Enter dispatch (text_activated_cb)', async () => {
        for (const { name, steps, activation, textChangedAfter, rule } of ENTRY_ROW_ACTIVATION_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const state = new EntryRowState();
                for (const step of steps) applyStep(state, step);
                expect(state.activate()).toStrictEqual(activation);
                expect(state.textChanged).toBe(textChangedAfter);
            });
        }
    });

    await describe('EntryRowState setter guards', async () => {
        for (const { name, steps, returns, notifications, rule } of ENTRY_ROW_GUARD_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const state = new EntryRowState();
                let calls = 0;
                state.subscribe(() => calls++);
                const actual = steps.map((step) => applyStep(state, step));
                expect(actual).toStrictEqual([...returns]);
                expect(calls).toBe(notifications);
            });
        }

        await it('coerces a truthy non-boolean, as `!!show_apply_button` does', () => {
            // adw-entry-row.c:982 — the coercion is BEFORE the equality guard, so
            // the property settles to `true` instead of holding the number 1.
            const state = new EntryRowState();
            expect(state.setShowApplyButton(1 as unknown as boolean)).toBe(true);
            expect(state.showApplyButton).toBe(true);
            expect(state.setShowApplyButton(true)).toBe(false);
        });

        await it('setActivatesDefault notifies nothing — it feeds no derived output', () => {
            const state = new EntryRowState();
            let calls = 0;
            state.subscribe(() => calls++);
            expect(state.setActivatesDefault(true)).toBe(true);
            expect(state.setActivatesDefault(true)).toBe(false);
            expect(calls).toBe(0);
        });
    });

    await describe('PasswordEntryRowState (libadwaita conformance vectors)', async () => {
        for (const { name, steps, expected, entryIndicatorVisible, rule } of PASSWORD_ENTRY_ROW_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const entry = new EntryRowState();
                const password = new PasswordEntryRowState(entry);
                for (const step of steps) applyPasswordStep(password, entry, step);
                expect(password.state).toStrictEqual(expected);
                expect(entry.state.indicatorVisible).toBe(entryIndicatorVisible);
            });
        }

        for (const { name, steps, notifications, rule } of PASSWORD_REVEAL_GUARD_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const entry = new EntryRowState();
                const password = new PasswordEntryRowState(entry);
                let calls = 0;
                password.subscribe(() => calls++);
                for (const step of steps) applyPasswordStep(password, entry, step);
                expect(calls).toBe(notifications);
            });
        }

        await it("uses the C source spellings, not each port's invention", () => {
            expect(PASSWORD_REVEAL_ICON_NAME).toBe('view-reveal-symbolic');
            expect(PASSWORD_CONCEAL_ICON_NAME).toBe('view-conceal-symbolic');
            expect(PASSWORD_REVEAL_LABEL).toBe('Show Password');
            expect(PASSWORD_CONCEAL_LABEL).toBe('Hide Password');
            expect(CAPS_LOCK_ICON_NAME).toBe('caps-lock-symbolic');
            expect(CAPS_LOCK_TOOLTIP).toBe('Caps Lock is on');
        });

        await it('needs no push from the password row when focus alone changes', () => {
            // adw-password-entry-row.c:83-88 re-runs update_caps_lock on the focus
            // notify; here the entry row's own `editing && show_indicator` gate
            // (adw-entry-row.c:151) covers it, so a focus change re-derives the
            // warning without the password row being involved at all.
            const entry = new EntryRowState();
            const password = new PasswordEntryRowState(entry);
            password.setCapsLockOn(true);
            expect(entry.state.indicatorVisible).toBe(false);
            entry.setEditing(true);
            expect(entry.state.indicatorVisible).toBe(true);
        });
    });

    await describe('entry-row layout constants', async () => {
        await it('carries the C source values so both renderers use one number', () => {
            // adw-entry-row.c:18-19 — web hardcoded `1px`, NS `2`.
            expect(EMPTY_ANIMATION_DURATION_MS).toBe(150);
            expect(ENTRY_ROW_TITLE_SPACING).toBe(3);
        });
    });
};
