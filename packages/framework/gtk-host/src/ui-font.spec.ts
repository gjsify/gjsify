// The UI-font-size DECISION — pure TypeScript, so it runs with no display, no Gtk.Settings and no
// GI at all. Same split as `font-dir.spec.ts`: the part that needs a real toolkit is the part with
// nothing left to decide.
//
// THE DISCRIMINATOR IS THE MEASURED HOST. Every case below uses a value a real host actually
// reported — `Segoe UI 9` from Windows 11 / GTK 4.22.4, `Cantarell 11` and `Adwaita Sans 11` from
// GNOME — rather than invented strings, because the failure this guards is "GTK took the shell's
// point size and Adwaita is drawn 20 % small", and that is a statement about those values.

import { describe, expect, it } from '@gjsify/unit';

import { GNOME_UI_FONT_POINT_SIZE, planUiFont } from './ui-font.js';

export default async () => {
    await describe('planUiFont', async () => {
        await it("raises Windows' 9 pt shell font to GNOME's 11, keeping the family", async () => {
            // The measured defect, in one line: Windows 11 hands GTK `Segoe UI 9`, Adwaita is
            // designed for 11, and at 96 dpi that is 12 px against ~14.7 px.
            const plan = planUiFont('Segoe UI 9');
            expect(plan.kind).toBe('raised');
            expect(plan.next).toBe('Segoe UI 11');
            // The FAMILY is deliberately untouched — a Windows user's shell font is a legitimate
            // preference; its point size is not a preference about Adwaita's metrics.
            expect(plan.family).toBe('Segoe UI');
            expect(plan.size).toBe(GNOME_UI_FONT_POINT_SIZE);
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
};
