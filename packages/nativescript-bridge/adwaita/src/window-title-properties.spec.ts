// THE FIRST MIGRATED WIDGET, MEASURED ON THE PURE-JS LEG (ADR 0105 § 2, route D).
//
// `AdwWindowTitle` no longer writes `get title()` / `set title()`: `title` and `subtitle` are
// DECLARED at its `extends` and built by `widgets/signals.ts`. On Android that seam registers a
// GType over `StackLayout` and the properties are a real GObject's; everywhere else — the
// browser, iOS (ADR 0105 § 6), and every off-device test including this one — it installs its own
// accessors instead. `signals-gobject.spec.ts` drives both legs of the SEAM against a stub
// engine; this file drives the WIDGET, so that the leg iOS ships on is held to the same
// properties, the same notifies and the same labels the twin produced.
//
// WHICH LEG THIS IS, asserted first and not as ceremony: `engine-target.ts` says
// `realGObjectIsDefault: false`, so an empty engine slot resolves to the subset here. If a
// future change ever made the real engine reachable off-device, every assertion below would be
// measuring the other leg while still passing.
//
// This lives on the TREES entry (`src/test.trees.mts`) rather than the pure one, because it
// builds a real widget class and `extends StackLayout` evaluates `@nativescript/core` at module
// scope — reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import { NOTIFY_SUBTITLE, NOTIFY_TITLE } from './widgets/adw-window-title.js';

/** The two `Label`s the widget keeps, which `_apply()` is the only writer of. */
interface Labels {
    _titleLabel: { text: string; visibility: string };
    _subtitleLabel: { text: string; visibility: string };
}

function labelsOf(widget: Adw.WindowTitle): Labels {
    return widget as unknown as Labels;
}

/** Every spelling GObject answers a property in, as the seam installs them. */
function spellings(widget: Adw.WindowTitle): Record<string, unknown> {
    return widget as unknown as Record<string, unknown>;
}

export const AdwWindowTitlePropertiesNsTest = async () => {
    await describe('Adw.WindowTitle properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            // The seam registers on the MIXIN class, so that is where a GType would land.
            const mixin = Object.getPrototypeOf(Adw.WindowTitle) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
            expect(Object.hasOwn(mixin, '$gtypeName')).toBe(false);
        });

        await it('starts with both properties empty and both labels collapsed', () => {
            const widget = new Adw.WindowTitle();
            expect(widget.title).toBe('');
            expect(widget.subtitle).toBe('');
            expect(labelsOf(widget)._titleLabel.visibility).toBe('collapse');
            expect(labelsOf(widget)._subtitleLabel.visibility).toBe('collapse');
        });

        await it('answers each property in all three GObject spellings', () => {
            const widget = new Adw.WindowTitle();
            widget.title = 'Inbox';
            expect(spellings(widget).title).toBe('Inbox');
            expect(spellings(widget).subtitle).toBe('');
        });

        await it('pushes a title onto its label, through notify:: and not a setter', () => {
            const widget = new Adw.WindowTitle();
            widget.title = 'Inbox';
            expect(labelsOf(widget)._titleLabel.text).toBe('Inbox');
            expect(labelsOf(widget)._titleLabel.visibility).toBe('visible');
            // The title hides when empty (adw-window-title.c:207-208) — the rule the twin
            // only ever applied to the subtitle.
            widget.title = '';
            expect(labelsOf(widget)._titleLabel.visibility).toBe('collapse');
        });

        await it('pushes a subtitle onto its label the same way', () => {
            const widget = new Adw.WindowTitle();
            widget.subtitle = '12 unread';
            expect(labelsOf(widget)._subtitleLabel.text).toBe('12 unread');
            expect(labelsOf(widget)._subtitleLabel.visibility).toBe('visible');
        });

        await it('notifies on a real change and stays silent on an equal write', () => {
            const widget = new Adw.WindowTitle();
            const seen: string[] = [];
            widget.connect(NOTIFY_TITLE, (self) => seen.push(self.title));
            widget.title = 'Inbox';
            widget.title = 'Inbox';
            widget.title = 'Drafts';
            // Also the early return of adw-window-title.c:203-204 — one write, no notify.
            expect(seen).toStrictEqual(['Inbox', 'Drafts']);
        });

        await it('notifies the subtitle under its own detail only', () => {
            const widget = new Adw.WindowTitle();
            const seen: string[] = [];
            widget.connect(NOTIFY_SUBTITLE, (self) => seen.push(self.subtitle));
            widget.connect(NOTIFY_TITLE, () => seen.push('title'));
            widget.subtitle = '12 unread';
            expect(seen).toStrictEqual(['12 unread']);
        });

        await it('takes the id back from connect and stops on disconnect', () => {
            const widget = new Adw.WindowTitle();
            const seen: string[] = [];
            const id = widget.connect(NOTIFY_TITLE, (self) => seen.push(self.title));
            widget.title = 'Inbox';
            widget.disconnect(id);
            widget.title = 'Drafts';
            expect(seen).toStrictEqual(['Inbox']);
            expect(() => widget.disconnect(id)).toThrow();
        });

        await it("emits notify::title from GJS's notify('title')", () => {
            const widget = new Adw.WindowTitle();
            const seen: number[] = [];
            widget.connect(NOTIFY_TITLE, () => seen.push(1));
            widget.notify('title');
            expect(seen.length).toBe(1);
            expect(() => widget.notify('nope')).toThrow();
        });

        await it('still answers the port one-argument property door', () => {
            const widget = new Adw.WindowTitle();
            widget.set_property('title', 'Inbox');
            expect(widget.get_property('title')).toBe('Inbox');
            expect(labelsOf(widget)._titleLabel.text).toBe('Inbox');
        });

        await it('takes both properties as construct props', () => {
            const widget = new Adw.WindowTitle({ title: 'Inbox', subtitle: '12 unread' });
            expect(widget.title).toBe('Inbox');
            expect(widget.subtitle).toBe('12 unread');
            expect(labelsOf(widget)._titleLabel.text).toBe('Inbox');
            expect(labelsOf(widget)._subtitleLabel.text).toBe('12 unread');
        });

        await it('declares both notifies in emittedSignals, from the seam', () => {
            const emitted = (Adw.WindowTitle as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            expect(emitted.includes(NOTIFY_TITLE)).toBe(true);
            expect(emitted.includes(NOTIFY_SUBTITLE)).toBe(true);
        });
    });
};

export default AdwWindowTitlePropertiesNsTest;
