// The UI-font-size DECISION — pure TypeScript, so it runs with no display, no Gtk.Settings and no
// GI at all. Same split as `font-dir.spec.ts`: the part that needs a real toolkit is the part with
// nothing left to decide.
//
// THE DISCRIMINATOR IS THE MEASURED HOST. Every case below uses a value a real host actually
// reported — `Segoe UI 9` from Windows 11 / GTK 4.22.4, `Cantarell 11` and `Adwaita Sans 11` from
// GNOME — rather than invented strings, because the failure this guards is "GTK took the shell's
// point size and Adwaita is drawn 16 % small", and that is a statement about those values.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADWAITA_UI_FONT_FAMILY,
    GNOME_UI_FONT_POINT_SIZE,
    UI_FONT_POLICIES,
    planUiFont,
    planUiFontPolicy,
} from './ui-font.js';

export default async () => {
    await describe('planUiFont', async () => {
        await it("raises Windows' 9 pt shell font to GNOME's 11, keeping the family", async () => {
            // The measured defect, in one line: Windows 11 hands GTK `Segoe UI 9`, Adwaita is
            // designed for 11 — measured as ascent+descent, 16.0 px against GNOME's 19.0.
            const plan = planUiFont('Segoe UI 9');
            expect(plan.kind).toBe('raised');
            expect(plan.next).toBe('Segoe UI 11');
            // The FAMILY is deliberately untouched — a Windows user's shell font is a legitimate
            // preference; its point size is not a preference about Adwaita's metrics.
            expect(plan.family).toBe('Segoe UI');
            expect(plan.size).toBe(GNOME_UI_FONT_POINT_SIZE);
        });

        await it('leaves macOS alone, which is the measured case for raise-only', async () => {
            // Not a hypothetical: macOS asks for `.AppleSystemUIFont 12` and measures 18.8 px
            // against GNOME's 19.0 — the same size to within a rounding error. Raise-only is
            // what leaves it that way; a policy that set 11 unconditionally would make the one
            // platform with no size problem slightly worse.
            const plan = planUiFont('.AppleSystemUIFont 12');
            expect(plan.kind).toBe('kept');
            expect(plan.next).toBeUndefined();
            expect(planUiFontPolicy({ policy: 'size', current: '.AppleSystemUIFont 12' }).kind).toBe('kept');
        });

        await it('leaves a host that is already at or above GNOME size alone', async () => {
            // RAISE ONLY. A user who enlarged their system text must not have it shrunk back to
            // GNOME's default by a toolkit, so the plan is `kept` and `next` is undefined —
            // nothing is written at all, rather than the same value written again.
            for (const current of ['Cantarell 11', 'Adwaita Sans 11', 'Segoe UI 14']) {
                const plan = planUiFont(current);
                expect(plan.kind).toBe('kept');
                expect(plan.next).toBeUndefined();
            }
        });

        await it('reads a multi-word family and style words as the family', async () => {
            // `gtk-font-name` carries style words between the family and the size, and treating
            // one as part of the number would produce an unparsable value written back to the
            // setting.
            const plan = planUiFont('Cantarell Bold 9');
            expect(plan.next).toBe('Cantarell Bold 11');
        });

        await it('keeps a fractional size fractional', async () => {
            // Pango's own `to_string` emits these, so a host can legitimately be at 10.5.
            expect(planUiFont('Segoe UI 10.5').next).toBe('Segoe UI 11');
            expect(planUiFont('Segoe UI 11.5').kind).toBe('kept');
        });

        await it('refuses to rewrite a value it cannot read', async () => {
            // THE ARM THAT MATTERS MOST, and the reason this does not use
            // `Pango.FontDescription.from_string`: that parser never fails — it folds an
            // unparsable tail into the family — so a malformed setting would come back as size 0
            // and get "corrected" to 11, silently replacing a value nobody here understood.
            for (const current of ['Segoe UI', '', undefined]) {
                const plan = planUiFont(current);
                expect(plan.kind).toBe('unparsed');
                expect(plan.next).toBeUndefined();
            }
        });

        await it('applies a family only when one is asked for', async () => {
            // The alternative policy, available and not the default: an application that wants a
            // GNOME face regardless of the host says so, and gets both halves at once.
            const plan = planUiFont('Segoe UI 9', { family: 'Adwaita Sans' });
            expect(plan.kind).toBe('family');
            expect(plan.next).toBe('Adwaita Sans 11');
        });

        await it('honours an explicit target size in both directions', async () => {
            expect(planUiFont('Segoe UI 9', { size: 10 }).next).toBe('Segoe UI 10');
            // Still raise-only against the caller's own target.
            expect(planUiFont('Segoe UI 12', { size: 10 }).kind).toBe('kept');
        });
    });

    await describe('planUiFontPolicy — the three states a consumer picks from', async () => {
        // The measured Windows host: GTK took the shell's `Segoe UI 9`.
        const WINDOWS = 'Segoe UI 9';

        await it('offers exactly three states, in the order a dialog shows them', async () => {
            // Exported so a preferences dialog enumerates them instead of hard-coding three
            // strings that then drift from the type — only one of those two copies is checked.
            expect([...UI_FONT_POLICIES]).toStrictEqual(['system', 'size', 'adwaita']);
        });

        await it('system LEAVES THE HOST ALONE, size included', async () => {
            // The state that did not exist before: `size` was hard-wired, so somebody who
            // deliberately set 9 pt got 11 anyway. Nothing is written at all here.
            const plan = planUiFontPolicy({ policy: 'system', current: WINDOWS, baseline: WINDOWS });
            expect(plan.kind).toBe('kept');
            expect(plan.next).toBeUndefined();
        });

        await it('size keeps the family and raises only', async () => {
            expect(planUiFontPolicy({ policy: 'size', current: WINDOWS }).next).toBe('Segoe UI 11');
            expect(planUiFontPolicy({ policy: 'size', current: 'Segoe UI 14' }).kind).toBe('kept');
        });

        await it('adwaita forces the GNOME face at GNOME size, on every platform', async () => {
            const plan = planUiFontPolicy({ policy: 'adwaita', current: WINDOWS });
            expect(plan.kind).toBe('family');
            expect(plan.next).toBe(`${ADWAITA_UI_FONT_FAMILY} ${GNOME_UI_FONT_POINT_SIZE}`);
        });

        await it('adwaita is NOT raise-only — that is the point of the state', async () => {
            // `size` preserves a larger host size; `adwaita` is an explicit "look the same
            // everywhere", so a host at 14 pt comes DOWN to 11. A consumer that wants the GNOME
            // face at the host's size passes `size` itself.
            expect(planUiFontPolicy({ policy: 'adwaita', current: 'Segoe UI 14' }).next).toBe('Adwaita Sans 11');
            expect(planUiFontPolicy({ policy: 'adwaita', current: WINDOWS, size: 9 }).next).toBe('Adwaita Sans 9');
        });

        await it('adwaita still works from a value nothing can parse', async () => {
            // `size` correctly refuses to act on an unreadable setting because it has to PRESERVE
            // half of it. `adwaita` preserves nothing, so there is nothing a malformed value can
            // spoil — and refusing there would strand a host on a broken setting.
            expect(planUiFontPolicy({ policy: 'size', current: 'Segoe UI' }).kind).toBe('unparsed');
            expect(planUiFontPolicy({ policy: 'adwaita', current: 'Segoe UI' }).next).toBe('Adwaita Sans 11');
        });

        await it("THE WAY BACK: adwaita -> system restores the host's own value verbatim", async () => {
            // The case that is forgotten on the first attempt, and the reason the baseline is
            // captured before the first write: after `adwaita` the host's `Segoe UI 9` is not
            // reconstructible from GTK, from the display, or from any schema.
            const forced = planUiFontPolicy({ policy: 'adwaita', current: WINDOWS });
            expect(forced.next).toBe('Adwaita Sans 11');

            const back = planUiFontPolicy({ policy: 'system', current: forced.next, baseline: WINDOWS });
            expect(back.kind).toBe('restored');
            expect(back.next).toBe(WINDOWS);
            // And the SIZE comes back with it — restoring the family alone would be the same
            // half-measure that made `size` the unclear middle.
            expect(back.size).toBe(9);
            expect(back.family).toBe('Segoe UI');
        });

        await it('the way back works from `size` too, and is idempotent', async () => {
            const raised = planUiFontPolicy({ policy: 'size', current: WINDOWS });
            expect(raised.next).toBe('Segoe UI 11');
            const back = planUiFontPolicy({ policy: 'system', current: raised.next, baseline: WINDOWS });
            expect(back.next).toBe(WINDOWS);
            // Applying `system` twice writes once: the second call has nothing left to restore.
            expect(planUiFontPolicy({ policy: 'system', current: WINDOWS, baseline: WINDOWS }).kind).toBe('kept');
        });

        await it('system restores a baseline this cannot parse, rather than refusing', async () => {
            // Asymmetric on purpose: the baseline is a string GTK itself produced and this read
            // off the host, so it goes back verbatim. Parsing it would invent a second opinion
            // about a value whose only job is to be put back.
            const back = planUiFontPolicy({ policy: 'system', current: 'Adwaita Sans 11', baseline: 'Segoe UI' });
            expect(back.kind).toBe('restored');
            expect(back.next).toBe('Segoe UI');
        });

        await it('system with no baseline leaves the setting alone', async () => {
            // A host whose `gtk-font-name` was never captured, or genuinely unset. "Leave it
            // alone" is the correct answer for `system` in both cases — it must not invent one.
            const plan = planUiFontPolicy({ policy: 'system', current: 'Adwaita Sans 11', baseline: undefined });
            expect(plan.kind).toBe('kept');
            expect(plan.next).toBeUndefined();
        });

        await it('every state is a no-op when the setting already says what it wants', async () => {
            // No write means no `gtk-font-name` notify, so a consumer can apply its stored policy
            // on every startup without churning the setting.
            expect(planUiFontPolicy({ policy: 'adwaita', current: 'Adwaita Sans 11' }).kind).toBe('kept');
            expect(planUiFontPolicy({ policy: 'size', current: 'Segoe UI 11' }).kind).toBe('kept');
            expect(planUiFontPolicy({ policy: 'system', current: WINDOWS, baseline: WINDOWS }).kind).toBe('kept');
        });
    });
};
