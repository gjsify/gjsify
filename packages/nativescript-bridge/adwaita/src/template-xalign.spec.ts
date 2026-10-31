// WHERE A LABEL'S TEXT SITS, READ AGAINST THE `.ui` FILE THAT DECIDES IT.
//
// `Gtk.Label:xalign` defaults to 0.5 — a label nobody aligned CENTRES its text — and this suite
// is the measurement of that, because the port read 0 for a while and declared the difference
// instead of fixing it. The declared divergence was the bug: Blueprint written against real GTK
// (a centred bottom-bar label in Learn6502) drew left on Android and nowhere else.
//
// THE SECOND HALF IS WHY THAT DEFAULT IS SAFE: libadwaita's rows are left-aligned because their
// OWN templates say so, not because the default is 0. Each assertion below names the `.ui` file
// it comes from, so the port can be read against its specification:
//
//   `xalign 0`   adw-action-row.ui (title, subtitle) · adw-entry-row.ui (empty_title, title)
//                adw-preferences-group.ui (title, description) · adw-about-dialog.ui
//                (comments_label)
//   `xalign 0.5` adw-button-row.ui (title) — the one row template that centres
//
// Widgets whose upstream template states NO xalign (status page, banner, toast, window title,
// combo row, expander row) are absent on purpose: there is nothing to state there.
//
// This lives on the TREES entry (`src/test.trees.mts`) — it builds real widgets, and
// `extends GridLayout` evaluates `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

/** The internal template labels, reached the way the widgets' own render code reaches them. */
function alignmentOf(widget: object, field: string): string {
    const label = (widget as unknown as Record<string, { textAlignment: string }>)[field];
    return label.textAlignment;
}

export const AdwTemplateXalignNsTest = async () => {
    await describe('Gtk.Label xalign default', async () => {
        await it('is 0.5, as the pspec says, and is DRAWN rather than left to the platform', () => {
            const label = new Gtk.Label();
            expect(label.xalign).toBe(0.5);
            expect(label.textAlignment).toBe('center');
        });

        await it('centres a label built from a construct bag that says nothing about alignment', () => {
            const label = new Gtk.Label({ label: 'Hilfe' });
            expect(label.textAlignment).toBe('center');
        });

        await it('still takes an explicit 0 to the start edge, and back', () => {
            const label = new Gtk.Label({ label: 'Hilfe' });
            label.xalign = 0;
            expect(label.textAlignment).toBe('left');
            label.xalign = 0.5;
            expect(label.textAlignment).toBe('center');
        });

        await it('mirrors an explicit 0 in RTL, because GTK 0 is the START edge', () => {
            const label = new Gtk.Label({ label: 'Hilfe' });
            (label.style as { direction: string | null }).direction = 'rtl';
            label.xalign = 0;
            expect(label.textAlignment).toBe('right');
        });

        await it('lets a written justify win over the default nobody wrote, instead of throwing', () => {
            // The refusal exists for two alignments that were both ASKED for. A default is not
            // an argument, so `justify` carries the multi-line label on its own.
            const label = new Gtk.Label({ label: 'two\nlines', wrap: true });
            label.justify = 'right';
            expect(label.textAlignment).toBe('right');
            expect(label.xalign).toBe(0.5);
        });
    });

    await describe('Adw template labels state their own xalign', async () => {
        await it('left-aligns ActionRow title and subtitle, as adw-action-row.ui does', () => {
            const row = new Adw.ActionRow({ title: 'Dunkles Design', subtitle: 'Folgt dem System' });
            expect(alignmentOf(row, '_titleLabel')).toBe('initial');
            expect(alignmentOf(row, '_subtitleLabel')).toBe('initial');
        });

        await it('keeps them left after the labels have been written through the properties', () => {
            // `_applyLabels()` is the only writer of the two label views, and it must not
            // re-decide the alignment the template fixed.
            const row = new Adw.ActionRow();
            row.title = 'Tastenkürzel';
            row.subtitle = 'Alle Befehle';
            expect(alignmentOf(row, '_titleLabel')).toBe('initial');
            expect(alignmentOf(row, '_subtitleLabel')).toBe('initial');
        });

        await it('left-aligns both EntryRow titles, as adw-entry-row.ui does', () => {
            const row = new Adw.EntryRow({ title: 'Name' });
            expect(alignmentOf(row, '_titleLabel')).toBe('initial');
            expect(alignmentOf(row, '_emptyTitle')).toBe('initial');
        });

        await it('CENTRES the ButtonRow title, as adw-button-row.ui does, over the inherited 0', () => {
            const row = new Adw.ButtonRow({ title: 'Zurücksetzen' });
            expect(alignmentOf(row, '_titleLabel')).toBe('center');
        });

        await it('left-aligns PreferencesGroup title and description, as its .ui does', () => {
            const group = new Adw.PreferencesGroup({ title: 'Darstellung', description: 'Design und Schrift' });
            expect(alignmentOf(group, '_titleLabel')).toBe('initial');
            expect(alignmentOf(group, '_descriptionLabel')).toBe('initial');
        });

        await it('left-aligns the AboutDialog comments label, as adw-about-dialog.ui does', () => {
            const dialog = new Adw.AboutDialog({ comments: 'Lerne 6502-Assembler' });
            expect(alignmentOf(dialog, '_commentsLabel')).toBe('initial');
        });
    });
};

export default AdwTemplateXalignNsTest;
