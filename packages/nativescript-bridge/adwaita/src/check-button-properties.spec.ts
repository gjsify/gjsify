// `Gtk.CheckButton`'S FOUR DECLARED PROPERTIES AND TWO SIGNALS, measured on the pure-JS leg
// (ADR 0105 § 2, route D).
//
// `active`, `inconsistent`, `label` and `use-underline` were hand-written accessors over class
// fields; they are declared on the seam now (`withProperties` over the meta-less
// `AdwStyledLayoutBase`), and `toggled` / `activate` are declared signals. Every expectation
// below is what GJS (GTK 4.22) measured, and the header of `widgets/gtk-check-button.ts` lists
// the measurements. The real-GI twin of this file is `check-button-route-d.node-gi.spec.ts`.
//
// It also pins what the migration CHANGED for a consumer: a tap no longer emits `activate` or
// clears `inconsistent`, `notify::active` now leads `toggled`, `label` notifies on every write,
// and a declared name can no longer be dispatched through `notify({ eventName })`.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends GridLayout` reaches
// `@nativescript/core` at module scope, resolvable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';
import { emittedSignalsOf } from './widgets/signals.js';
import {
    GTK_CHECK_BUTTON_ACTIVATE,
    GTK_CHECK_BUTTON_TOGGLED,
    NOTIFY_CHECK_ACTIVE,
    NOTIFY_CHECK_INCONSISTENT,
    NOTIFY_CHECK_LABEL,
    NOTIFY_CHECK_USE_UNDERLINE,
} from './widgets/gtk-check-button.js';

const EMISSIONS = [
    GTK_CHECK_BUTTON_TOGGLED,
    GTK_CHECK_BUTTON_ACTIVATE,
    NOTIFY_CHECK_ACTIVE,
    NOTIFY_CHECK_INCONSISTENT,
    NOTIFY_CHECK_LABEL,
    NOTIFY_CHECK_USE_UNDERLINE,
] as const;

const loose = (check: Gtk.CheckButton): Record<string, unknown> => check as unknown as Record<string, unknown>;

const tap = (view: object): void => (view as Gtk.CheckButton).notify({ eventName: 'tap', object: view as never });

/** Record every signal and `notify::` the button emits, in order. */
function watch(check: Gtk.CheckButton): string[] {
    const seen: string[] = [];
    for (const name of EMISSIONS) check.connect(name, () => seen.push(name));
    return seen;
}

export const GtkCheckButtonPropertiesNsTest = async () => {
    await describe('Gtk.CheckButton: four declared properties, two declared signals', async () => {
        await it("starts at gtk_check_button_init's defaults, having emitted nothing", () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            expect(check.active).toBe(false);
            expect(check.inconsistent).toBe(false);
            expect(check.label).toBe(null);
            expect(check.useUnderline).toBe(false);
            expect(seen.length).toBe(0);
        });

        await it('declares what it emits: widget signals, then its signals, then one notify each', () => {
            expect(emittedSignalsOf(Gtk.CheckButton).join()).toBe(
                'map,unmap,toggled,activate,notify::active,notify::inconsistent,notify::label,notify::use-underline',
            );
        });

        await it('answers each property in all three GObject spellings', () => {
            const check = new Gtk.CheckButton();
            check.useUnderline = true;
            const props = loose(check);
            expect(props.useUnderline).toBe(true);
            expect(props['use-underline']).toBe(true);
            expect(props.use_underline).toBe(true);
        });

        await it('is GObject-only: notify() refuses the declared names by payload', () => {
            const check = new Gtk.CheckButton();
            for (const name of EMISSIONS.filter((emission) => emission.startsWith('notify::'))) {
                expect(() => check.notify({ eventName: name, object: check as never })).toThrow();
            }
        });
    });

    await describe('Gtk.CheckButton active (measured on GTK 4.22)', async () => {
        await it('emits notify::active and THEN toggled, once per real change', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.active = true;
            check.active = true;
            check.active = false;
            expect(seen).toStrictEqual([
                NOTIFY_CHECK_ACTIVE,
                GTK_CHECK_BUTTON_TOGGLED,
                NOTIFY_CHECK_ACTIVE,
                GTK_CHECK_BUTTON_TOGGLED,
            ]);
        });

        await it('reads a value the way GJS does: null → false, 1 → true, and a template string', () => {
            const check = new Gtk.CheckButton();
            loose(check).active = 1;
            expect(check.active).toBe(true);
            loose(check).active = null;
            expect(check.active).toBe(false);
            loose(check).active = 'true';
            expect(check.active).toBe(true);
            expect(() => (loose(check).active = 'maybe')).toThrow();
        });

        await it('says nothing for a null written to an inactive button', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            loose(check).active = null;
            expect(seen.length).toBe(0);
        });

        await it('repaints the `checked` class before announcing', () => {
            const check = new Gtk.CheckButton();
            let classNameAtToggled = '';
            check.connect(GTK_CHECK_BUTTON_TOGGLED, () => void (classNameAtToggled = check.className));
            check.active = true;
            expect(classNameAtToggled).toBe('adw-check-button checked');
        });
    });

    await describe('Gtk.CheckButton activation', async () => {
        await it('a tap is set_active(!active) alone: it emits no `activate`', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            tap(check);
            expect(seen).toStrictEqual([NOTIFY_CHECK_ACTIVE, GTK_CHECK_BUTTON_TOGGLED]);
        });

        await it('emit("activate") toggles, and `activate` comes last', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.emit(GTK_CHECK_BUTTON_ACTIVATE);
            expect(check.active).toBe(true);
            expect(seen).toStrictEqual([NOTIFY_CHECK_ACTIVE, GTK_CHECK_BUTTON_TOGGLED, GTK_CHECK_BUTTON_ACTIVATE]);
        });

        await it('does not clear `inconsistent` when activated', () => {
            const check = new Gtk.CheckButton({ inconsistent: true });
            check.emit(GTK_CHECK_BUTTON_ACTIVATE);
            tap(check);
            expect(check.inconsistent).toBe(true);
        });

        await it('emit("activate") on the ACTIVE member of a group emits `activate` alone', () => {
            const [a, b] = [new Gtk.CheckButton(), new Gtk.CheckButton()];
            b.set_group(a);
            a.active = true;
            const seen = watch(a);
            a.emit(GTK_CHECK_BUTTON_ACTIVATE);
            expect(a.active).toBe(true);
            expect(seen).toStrictEqual([GTK_CHECK_BUTTON_ACTIVATE]);
        });
    });

    await describe('Gtk.CheckButton group', async () => {
        await it('set_group emits nothing and keeps the active states', () => {
            const [a, b] = [new Gtk.CheckButton({ active: true }), new Gtk.CheckButton({ active: true })];
            const seen = [...watch(a), ...watch(b)];
            b.set_group(a);
            expect(seen.length).toBe(0);
            expect([a.active, b.active]).toStrictEqual([true, true]);
        });

        await it('activating one member deactivates the other BEFORE the first one notifies', () => {
            const [a, b] = [new Gtk.CheckButton(), new Gtk.CheckButton()];
            b.set_group(a);
            a.active = true;
            const log: string[] = [];
            a.connect(NOTIFY_CHECK_ACTIVE, () => log.push(`a:${a.active}/b:${b.active}`));
            b.connect(NOTIFY_CHECK_ACTIVE, () => log.push(`b:${b.active}/a:${a.active}`));
            b.active = true;
            // `a` went false first, and `b` still read false when it did.
            expect(log).toStrictEqual(['a:false/b:false', 'b:true/a:false']);
        });
    });

    await describe('Gtk.CheckButton inconsistent, label, use-underline', async () => {
        await it('notifies `inconsistent` on change only, and repaints', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.inconsistent = true;
            check.inconsistent = true;
            expect(seen).toStrictEqual([NOTIFY_CHECK_INCONSISTENT]);
            expect(check.className).toBe('adw-check-button inconsistent');
        });

        await it('notifies `label` on EVERY write, equal and null → null included', () => {
            const check = new Gtk.CheckButton();
            const seen = watch(check);
            check.label = null;
            check.label = 'Blue';
            check.label = 'Blue';
            expect(seen).toStrictEqual([NOTIFY_CHECK_LABEL, NOTIFY_CHECK_LABEL, NOTIFY_CHECK_LABEL]);
        });

        await it("reads '' back as null", () => {
            const check = new Gtk.CheckButton({ label: 'Blue' });
            check.label = '';
            expect(check.label).toBe(null);
        });

        await it('notifies `use-underline` on change only', () => {
            const check = new Gtk.CheckButton({ label: '_Blue' });
            const seen = watch(check);
            check.useUnderline = true;
            check.useUnderline = true;
            expect(seen).toStrictEqual([NOTIFY_CHECK_USE_UNDERLINE]);
        });
    });
};
