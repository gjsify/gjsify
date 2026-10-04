// `visible`, `sensitive`, `name`, `width-request`, `height-request` — the five `GtkWidget` base
// properties every class behind `withSignals` answers to (ADR 0034 § Amendment 22).
//
// On the TREES entry because the accessors are measured on REAL widget classes, against the
// platform double: what a write does to `visibility` / `isEnabled` / `id` / `minWidth`, what
// the XML door's strings do to the setters, and what the classes that are not views answer.
// The double starts `minWidth` as the `{ value, unit }` object a device answers, so the
// "unrequested" read is held against the real shape rather than a convenient `0`.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import type { View } from './testing/ns-core.mjs';

/** A widget's base properties, read through the one shape every class shares. */
interface Base {
    visible: boolean | string;
    sensitive: boolean | string;
    name: string | null;
    widthRequest: number | string;
    heightRequest: number | string;
}

const asBase = (value: unknown): Base => value as Base;

export const AdwWidgetBaseNsTest = async () => {
    await describe('GtkWidget base properties: visible', async () => {
        await it('is true on a fresh widget and writes `visibility`', () => {
            const label = new Gtk.Label();
            expect(label.visible).toBe(true);
            label.visible = false;
            expect((label as unknown as View).visibility).toBe('collapse');
            expect(label.visible).toBe(false);
            label.visible = true;
            expect((label as unknown as View).visibility).toBe('visible');
        });

        await it("reads NativeScript's `hidden` as not visible", () => {
            const label = new Gtk.Label();
            (label as unknown as View).visibility = 'hidden';
            expect(label.visible).toBe(false);
        });

        await it('takes the XML strings, and keeps the value for one it cannot read', () => {
            const label = new Gtk.Label();
            asBase(label).visible = 'false';
            expect(label.visible).toBe(false);
            asBase(label).visible = 'banana';
            expect(label.visible).toBe(false);
            asBase(label).visible = 'true';
            expect(label.visible).toBe(true);
        });

        await it('is not shadowed by the toast overlay, which reports its strip as `toastShowing`', () => {
            const overlay = new Adw.ToastOverlay();
            expect(overlay.toastShowing).toBe(false);
            overlay.visible = false;
            expect(overlay.visible).toBe(false);
        });
    });

    await describe('GtkWidget base properties: sensitive', async () => {
        await it('is true on a fresh widget and writes `isEnabled`', () => {
            const box = new Gtk.Box();
            expect(box.sensitive).toBe(true);
            box.sensitive = false;
            expect((box as unknown as View).isEnabled).toBe(false);
            expect(box.sensitive).toBe(false);
        });

        await it('takes the XML strings', () => {
            const box = new Gtk.Box();
            asBase(box).sensitive = 'false';
            expect(box.sensitive).toBe(false);
            asBase(box).sensitive = 'true';
            expect(box.sensitive).toBe(true);
        });

        await it("leaves `Adw.SplitButton`'s own `sensitive` (a dimmed control, not `isEnabled`) alone", () => {
            const split = new Adw.SplitButton();
            split.sensitive = false;
            expect(split.sensitive).toBe(false);
            expect((split as unknown as View).isEnabled).toBe(true);
        });
    });

    await describe('GtkWidget base properties: name', async () => {
        await it('answers the class name until named, as gtk_widget_get_name answers the GType name', () => {
            expect(new Gtk.Button().name).toBe('GtkButton');
            expect(new Adw.Clamp().name).toBe('AdwClamp');
        });

        await it('writes through to `id` when the view has none, so `#name` and getViewById find it', () => {
            const button = new Gtk.Button();
            button.name = 'save';
            expect(button.name).toBe('save');
            expect((button as unknown as View).id).toBe('save');
        });

        await it('does not take over an `id` a template already declared, in either order', () => {
            const first = new Gtk.Button();
            (first as unknown as View).id = 'fromBlp';
            first.name = 'save';
            expect((first as unknown as View).id).toBe('fromBlp');
            expect(first.name).toBe('save');

            const second = new Gtk.Button();
            second.name = 'save';
            (second as unknown as View).id = 'fromBlp';
            expect((second as unknown as View).id).toBe('fromBlp');
            expect(second.name).toBe('save');
        });

        await it('renaming moves the id it set, and clearing releases it', () => {
            const button = new Gtk.Button();
            button.name = 'one';
            button.name = 'two';
            expect((button as unknown as View).id).toBe('two');
            asBase(button).name = null;
            expect((button as unknown as View).id).toBe(undefined);
            expect(button.name).toBe('GtkButton');
        });

        await it('leaves `Adw.PreferencesPage:name` (the stack child name) to the page', () => {
            const page = new Adw.PreferencesPage();
            page.name = 'general';
            expect(page.name).toBe('general');
        });
    });

    await describe('GtkWidget base properties: width-request / height-request', async () => {
        await it('reads -1 for an unrequested size, though minWidth answers an object', () => {
            const label = new Gtk.Label();
            expect(typeof (label as unknown as View).minWidth).toBe('object');
            expect(label.widthRequest).toBe(-1);
            expect(label.heightRequest).toBe(-1);
        });

        await it('writes the NativeScript minimum and reads it back', () => {
            const label = new Gtk.Label();
            label.widthRequest = 120;
            label.heightRequest = 48;
            expect((label as unknown as View).minWidth).toBe(120);
            expect((label as unknown as View).minHeight).toBe(48);
            expect(label.widthRequest).toBe(120);
            expect(label.heightRequest).toBe(48);
        });

        await it('is never `width`, which NativeScript takes as an exact size', () => {
            const label = new Gtk.Label();
            label.widthRequest = 120;
            expect((label as unknown as View).width).toBe('auto');
        });

        await it('takes -1 and 0 as the same "no request", and a numeric string', () => {
            const label = new Gtk.Label();
            label.widthRequest = 200;
            label.widthRequest = -1;
            expect(label.widthRequest).toBe(-1);
            asBase(label).widthRequest = '64';
            expect(label.widthRequest).toBe(64);
            asBase(label).widthRequest = '0';
            expect(label.widthRequest).toBe(-1);
        });

        await it('refuses a value GTK would, by name', () => {
            const label = new Gtk.Label();
            expect(() => (label.widthRequest = -2)).toThrow("'-2' is not a size request");
            expect(() => (label.heightRequest = 1.5)).toThrow('is not a size request');
            expect(() => (asBase(label).widthRequest = 'wide')).toThrow("'wide' is not a size request");
        });

        await it('reads a length string a consumer wrote through the platform name', () => {
            const label = new Gtk.Label();
            (label as unknown as View).minWidth = '80px';
            expect(label.widthRequest).toBe(80);
            (label as unknown as View).minWidth = { value: 40, unit: 'dip' };
            expect(label.widthRequest).toBe(40);
        });
    });

    await describe('GtkWidget base properties: the classes that are not views', async () => {
        await it('answer the GTK defaults on a read and refuse a write by name', () => {
            const dialog = new Adw.AlertDialog();
            expect(dialog.visible).toBe(true);
            expect(dialog.sensitive).toBe(true);
            expect(dialog.widthRequest).toBe(-1);
            expect(() => (dialog.visible = false)).toThrow('is not laid out by a parent');
            expect(() => (dialog.widthRequest = 10)).toThrow("has no 'widthRequest'");
        });
    });

    await describe('GtkWidget base properties: the shared-tree door', async () => {
        await it('a projected .blp spelling reaches every one of the five', () => {
            const button = build({
                tag: 'GtkButton',
                props: {
                    visible: false,
                    sensitive: false,
                    name: 'go',
                    'width-request': 96,
                    'height-request': 40,
                },
            }) as unknown as Gtk.Button;
            expect(button.visible).toBe(false);
            expect(button.sensitive).toBe(false);
            expect(button.name).toBe('go');
            expect(button.widthRequest).toBe(96);
            expect(button.heightRequest).toBe(40);
        });

        await it('an authored id keeps being the id when a name is authored beside it', () => {
            const box = build({ tag: 'GtkBox', id: 'root', props: { name: 'sheet' } }) as unknown as Gtk.Box;
            expect((box as unknown as View).id).toBe('root');
            expect(box.name).toBe('sheet');
        });
    });
};
