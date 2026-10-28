// `Adw.ButtonContent` ON A DEVICE (ADR 0105 § 2, route D): `icon-name`, `label` (strings) and
// `use-underline`, `can-shrink` (booleans) are declared properties. The first suite runs in BOTH
// legs, so a difference between the two runs is a defect in whichever engine disagrees; the
// second is real-GObject only. `host-button` is deliberately NOT declared — a NativeScript `View`
// is not a GObject and `Adw.ButtonContent` has no such property — so the first suite also pins it
// as a plain accessor on both legs. See `specs/spinner.ts` for the shape this copies.
import { Adw } from '@gjsify/adwaita-nativescript';
import { StackLayout, View } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const parts = (content: Adw.ButtonContent) =>
    content as unknown as { _label: { text: string; visibility: string }; _icon: { iconName: string } };

export const buttonContentSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    const mixin = Object.getPrototypeOf(Adw.ButtonContent) as Any;

    await describe(`Adw.ButtonContent on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('constructs as a real NativeScript StackLayout', () => {
            const content = new Adw.ButtonContent();
            info(`gtypeName=${mixin.$gtypeName ?? 'none'}`);
            expect(content instanceof StackLayout).toBe(true);
            expect(content instanceof View).toBe(true);
            expect(Object.hasOwn(mixin, '$gtype')).toBe(engine === 'real-gio');
        });

        await it('starts at the C defaults, typed', () => {
            const content = new Adw.ButtonContent();
            expect(content.label).toBe('');
            expect(content.iconName).toBe('');
            expect(content.useUnderline).toBe(false);
            expect(content.canShrink).toBe(false);
            expect(parts(content)._label.visibility).toBe('collapse');
        });

        await it('notifies each property on a change only, and renders from it', () => {
            const content = new Adw.ButtonContent();
            const seen: string[] = [];
            for (const name of ['icon-name', 'label', 'use-underline', 'can-shrink']) {
                content.connect(`notify::${name}`, () => seen.push(name));
            }
            content.label = 'Save';
            content.label = 'Save';
            content.iconName = 'folder-symbolic';
            content.iconName = 'folder-symbolic';
            content.useUnderline = true;
            content.canShrink = true;
            content.canShrink = true;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('label,icon-name,use-underline,can-shrink');
            expect(parts(content)._label.text).toBe('Save');
            expect(parts(content)._label.visibility).toBe('visible');
            expect(parts(content)._icon.iconName).toBe('folder-symbolic');
        });

        await it('coerces XML strings to the declared type and refuses what is neither', () => {
            const content = new Adw.ButtonContent();
            (content as Any).useUnderline = 'true';
            (content as Any).canShrink = 'false';
            expect(content.useUnderline).toBe(true);
            expect(content.canShrink).toBe(false);
            expect(() => {
                (content as Any).useUnderline = 'maybe';
            }).toThrow();
            expect(new Adw.ButtonContent({ label: 'Go', canShrink: 'true' } as Any).canShrink).toBe(true);
        });

        await it('host-button is a plain accessor: identity equality, no notify', () => {
            const content = new Adw.ButtonContent();
            let runs = 0;
            content.connect('notify::host-button', () => runs++);
            const host = new StackLayout();
            content.hostButton = host;
            const stamped = host.className;
            content.hostButton = host;
            expect(host.className).toBe(stamped);
            expect(content.hostButton === host).toBe(true);
            content.hostButton = null;
            expect(runs).toBe(0);
        });
    });

    if (engine !== 'real-gio') return;

    const GObject = requireGi('GObject', '2.0') as Any;
    const Plain = GObject.registerClass(
        {
            GTypeName: 'GjsifyBcPlain',
            Properties: {
                label: GObject.ParamSpec.string('label', '', '', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class Plain extends GObject.Object {},
    );

    await describe('Adw.ButtonContent IS a GObject on the real engine', async () => {
        await it('the widget is a GObject.Object and its GType carries the declared name', () => {
            const content = new Adw.ButtonContent();
            expect(content instanceof GObject.Object).toBe(true);
            expect(mixin.$gtypeName).toBe('AdwButtonContent');
            expect(GObject.type_name(mixin.$gtype)).toBe('AdwButtonContent');
        });

        await it('typed properties survive the native store, and set_property drives the render', () => {
            const content = new Adw.ButtonContent();
            (content as Any).set_property('label', 'Open');
            expect(content.get_property('label')).toBe('Open');
            expect(typeof content.get_property('can-shrink')).toBe('boolean');
            expect(parts(content)._label.text).toBe('Open');
        });

        await it('bind_property binds label to a plain GObject and back', () => {
            const content = new Adw.ButtonContent();
            const plain = new Plain();
            const binding = (content as Any).bind_property('label', plain, 'label', GObject.BindingFlags.BIDIRECTIONAL);
            content.label = 'One';
            expect(plain.label).toBe('One');
            plain.label = 'Two';
            expect(content.label).toBe('Two');
            expect(parts(content)._label.text).toBe('Two');
            binding.unbind();
        });
    });
};

export default buttonContentSpec;
