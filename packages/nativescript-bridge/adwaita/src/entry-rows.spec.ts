// Entry-row conformance tests for @gjsify/adwaita-nativescript, driven by the
// SAME vectors the browser renderer asserts against
// (`@gjsify/adwaita-core/conformance`).
//
// These run on GJS (and Node), where `@nativescript/core` does not exist, so
// they cannot import `AdwEntryRow` — that module `extends AdwActionRow` →
// `GridLayout`, which evaluates the bare specifier at module-eval. They import
// the REAL code the widget delegates to instead: the headless derivation from
// `@gjsify/adwaita-core` plus `widgets/entry-row-view.ts`, the NS painter, which
// is free of `@nativescript/core` value imports for exactly this reason (the same
// split `icon-path.ts`, `row-press.ts` and `avatar-color.ts` use).
//
// The view objects below are STUBS FOR THE VIEWS, not for the logic: every
// function under test is the one the widget calls. A mock that transcribed the
// painting would by construction never catch the drift it exists to guard —
// which is why the avatar lift deleted the one it found.
import { describe, expect, it } from '@gjsify/unit';

import { EntryRowState, PasswordEntryRowState } from '@gjsify/adwaita-core';
import {
    ENTRY_MAX_LENGTH_VECTORS,
    ENTRY_ROW_ACTIVATION_VECTORS,
    ENTRY_ROW_STATE_VECTORS,
    ENTRY_TEXT_LENGTH_VECTORS,
    PASSWORD_ENTRY_ROW_VECTORS,
    PASSWORD_REVEAL_GUARD_VECTORS,
    type EntryRowStep,
    type PasswordEntryRowStep,
} from '@gjsify/adwaita-core/conformance';
import { viewConcealSymbolic, viewRevealSymbolic } from '@gjsify/adwaita-icons/actions';

import {
    NS_EDIT_ICON_CLASS,
    NS_ENTRY_ROW_CLASS,
    NS_INSENSITIVE_OPACITY,
    NS_PASSWORD_ENTRY_ROW_CLASS,
    applyEntryRowState,
    applyPasswordEntryRowState,
    peekIconSvg,
    type EntryRowViews,
    type PasswordEntryRowViews,
} from './widgets/entry-row-view.js';

/** Stand-ins for the NS views the painter drives — the real painter, fake `Label`s. */
function makeViews(): EntryRowViews {
    return {
        row: { className: '' },
        emptyTitle: { visibility: '' },
        title: { visibility: '' },
        field: { text: '', editable: true },
        editIcon: { visibility: '', className: '', opacity: 1 },
        indicator: { visibility: '' },
        applyButton: { visibility: '' },
    };
}

function makePasswordViews(): PasswordEntryRowViews {
    return { field: { secure: false }, peekButton: { iconName: '' } };
}

/** A row wired exactly like `AdwEntryRow`: state → painter, on every change. */
function makeRow(base = NS_ENTRY_ROW_CLASS): { state: EntryRowState; views: EntryRowViews } {
    const state = new EntryRowState();
    const views = makeViews();
    state.subscribe((snapshot) => applyEntryRowState(views, snapshot, base));
    // The widget paints once in its constructor, before the first change.
    applyEntryRowState(views, state.state, base);
    return { state, views };
}

function applyStep(state: EntryRowState, step: EntryRowStep): void {
    switch (step.op) {
        case 'setText':
            state.setText(step.value);
            return;
        case 'setEditing':
            state.setEditing(step.value);
            return;
        case 'setEditable':
            state.setEditable(step.value);
            return;
        case 'setMaxLength':
            state.setMaxLength(step.value);
            return;
        case 'setShowApplyButton':
            state.setShowApplyButton(step.value);
            return;
        case 'setShowIndicator':
            state.setShowIndicator(step.value);
            return;
        case 'setActivatesDefault':
            state.setActivatesDefault(step.value);
            return;
        case 'apply':
            state.apply();
            return;
    }
}

/** NS `visibility` for a boolean, spelled out so the expectation is not the code under test. */
function visible(shown: boolean): string {
    return shown ? 'visible' : 'collapse';
}

export const AdwEntryRowsNsTest = async () => {
    await describe('AdwEntryRow painting (libadwaita conformance vectors)', async () => {
        for (const { name, steps, expected, rule } of ENTRY_ROW_STATE_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const { state, views } = makeRow();
                for (const step of steps) applyStep(state, step);

                expect(views.field.text).toBe(expected.text);
                expect(views.field.editable).toBe(expected.editable);
                // The two titles are the endpoints of libadwaita's cross-fade;
                // the NS CSS subset swaps instead of lerping.
                expect(views.emptyTitle.visibility).toBe(visible(expected.emptyTarget === 0));
                expect(views.title.visibility).toBe(visible(expected.emptyTarget === 1));
                expect(views.editIcon.visibility).toBe(visible(expected.editIconVisible));
                // No insensitive widget state in NS — the C's set_sensitive is an opacity.
                expect(views.editIcon.opacity).toBe(expected.editIconSensitive ? 1 : NS_INSENSITIVE_OPACITY);
                expect(views.editIcon.className.split(' ').includes('adw-insensitive')).toBe(
                    !expected.editIconSensitive,
                );
                expect(views.indicator.visibility).toBe(visible(expected.indicatorVisible));
                expect(views.applyButton.visibility).toBe(visible(expected.applyButtonVisible));

                // `focused` is libadwaita's own class name (C:183-186); `empty`
                // is the only route to that state on a port whose CSS subset
                // cannot express `:focus-within`.
                const classes = views.row.className.split(' ');
                expect(views.row.className.startsWith(NS_ENTRY_ROW_CLASS)).toBe(true);
                expect(classes.includes('focused')).toBe(expected.editing);
                expect(classes.includes('empty')).toBe(expected.empty);
            });
        }

        await it('keeps the pencil class list intact while it is sensitive', () => {
            const { views } = makeRow();
            expect(views.editIcon.className).toBe(NS_EDIT_ICON_CLASS);
        });

        await it('dims the disabled pencil by $strong_disabled_opacity, not --disabled-opacity', () => {
            // The vector loop above compares the painted opacity against this
            // same constant, so it agrees with whatever the constant says and
            // cannot see a wrong VALUE. The number is written out here, from
            // `> .edit-icon:disabled { opacity: $strong_disabled_opacity }`
            // (_lists.scss:205-207) with `$strong_disabled_opacity: 30%`
            // (_colors.scss:311). It was 0.4 — the GENERAL disabled opacity,
            // applied to the one icon libadwaita gives a stronger dim.
            expect(NS_INSENSITIVE_OPACITY).toBe(0.3);
        });

        await it('paints CHARACTER-counted text into the field', () => {
            const { state, views } = makeRow();
            for (const { text, length } of ENTRY_TEXT_LENGTH_VECTORS) {
                state.setText(text);
                expect(views.field.text).toBe(text);
                expect(state.textLength).toBe(length);
            }
        });

        await it('paints max-length-truncated text into the field', () => {
            for (const { text, maxLength, clamped } of ENTRY_MAX_LENGTH_VECTORS) {
                const { state, views } = makeRow();
                state.setMaxLength(maxLength);
                state.setText(text);
                expect(views.field.text).toBe(clamped);
            }
        });
    });

    await describe('AdwEntryRow return key (text_activated_cb)', async () => {
        for (const { name, steps, activation, textChangedAfter, rule } of ENTRY_ROW_ACTIVATION_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const { state, views } = makeRow();
                for (const step of steps) applyStep(state, step);

                const resolved = state.activate();
                expect(resolved.signal).toBe(activation.signal);
                if (resolved.signal === 'entry-activated' && activation.signal === 'entry-activated') {
                    // NS has no default-widget concept, so this flag rides on the
                    // `entry-activated` payload for the host to honour first.
                    expect(resolved.activateDefault).toBe(activation.activateDefault);
                }
                expect(state.textChanged).toBe(textChangedAfter);
                // …and the paint follows: an applied row puts its button away.
                expect(views.applyButton.visibility).toBe(visible(false));
            });
        }
    });

    await describe('AdwPasswordEntryRow painting (libadwaita conformance vectors)', async () => {
        function makePasswordRow() {
            const { state, views } = makeRow(NS_PASSWORD_ENTRY_ROW_CLASS);
            const password = new PasswordEntryRowState(state);
            const passwordViews = makePasswordViews();
            password.subscribe((snapshot) => applyPasswordEntryRowState(passwordViews, snapshot));
            applyPasswordEntryRowState(passwordViews, password.state);
            return { state, views, password, passwordViews };
        }

        function applyPasswordStep(
            password: PasswordEntryRowState,
            state: EntryRowState,
            step: PasswordEntryRowStep,
        ): void {
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
                    applyStep(state, step.step);
                    return;
            }
        }

        for (const { name, steps, expected, entryIndicatorVisible, rule } of PASSWORD_ENTRY_ROW_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const { state, views, password, passwordViews } = makePasswordRow();
                for (const step of steps) applyPasswordStep(password, state, step);

                expect(passwordViews.field.secure).toBe(!expected.revealed);
                expect(passwordViews.peekButton.iconName).toBe(
                    expected.peekIconName === 'view-conceal-symbolic' ? viewConcealSymbolic : viewRevealSymbolic,
                );
                // The caps-lock warning lives on the PARENT row — the password
                // row only pushes `show_indicator` into it (C:57-59).
                expect(views.indicator.visibility).toBe(visible(entryIndicatorVisible));
                expect(views.row.className.startsWith(NS_PASSWORD_ENTRY_ROW_CLASS)).toBe(true);
            });
        }

        for (const { name, steps, notifications, rule } of PASSWORD_REVEAL_GUARD_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const { state, password } = makePasswordRow();
                let calls = 0;
                password.subscribe(() => calls++);
                for (const step of steps) applyPasswordStep(password, state, step);
                expect(calls).toBe(notifications);
            });
        }

        await it('maps the canonical icon names onto the vendored symbolics', () => {
            // The core names the icon the way the C does; this is the one place
            // that turns a name into an asset — the mapping used to exist three
            // and a half times across the two ports.
            expect(peekIconSvg('view-reveal-symbolic')).toBe(viewRevealSymbolic);
            expect(peekIconSvg('view-conceal-symbolic')).toBe(viewConcealSymbolic);
        });
    });
};

export default AdwEntryRowsNsTest;
