// `GTypeName`: a widget's GType name survives a minifier that mangles `Function.name`.
//
// On the TREES entry: the real widgets and `elementFor` need `@nativescript/core`.

import { describe, expect, it } from '@gjsify/unit';

import { elementFor, registerBarrel } from './builder/index.js';
import { gtypeNameOf } from './widgets/gtype-name.js';
import { AdwBin } from './widgets/adw-bin.js';

/** What a minifier does to `class AdwBin`: the identifier becomes one letter, `name` follows. */
function mangled<T extends object>(ctor: T, to: string): T {
    Object.defineProperty(ctor, 'name', { value: to, configurable: true });
    return ctor;
}

/** The message of the error `run` throws, or a failure when it does not throw. */
function refusal(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error('expected a refusal, the call returned');
}

export const AdwGTypeNameNsTest = async () => {
    await describe('gtypeNameOf', async () => {
        await it('answers the declared GTypeName over a mangled name', () => {
            class t {
                static readonly GTypeName: string = 'AdwProbe';
            }
            expect(gtypeNameOf(mangled(t, 'e'))).toBe('AdwProbe');
        });

        await it('falls back to the class name when none is declared, as GObject does', () => {
            class MyRow {}
            expect(gtypeNameOf(MyRow)).toBe('MyRow');
        });

        await it("does not hand a subclass its parent's GTypeName", () => {
            class Mine extends AdwBin {}
            expect(gtypeNameOf(Mine)).toBe('Mine');
            expect(gtypeNameOf(AdwBin)).toBe('AdwBin');
        });
    });

    await describe('mangled widget class names', async () => {
        await it('keeps the default widget name of a class whose `name` was mangled', () => {
            const original = AdwBin.name;
            try {
                mangled(AdwBin, 't');
                expect(new AdwBin().name).toBe('AdwBin');
            } finally {
                mangled(AdwBin, original);
            }
        });

        await it('resolves a barrel member whose `name` was mangled, by its GTypeName', () => {
            class t {
                static readonly GTypeName: string = 'GtkMangledProbe';
            }
            registerBarrel('gtkmangled', 'GtkMangled', { Probe: mangled(t, 'e') });
            expect(elementFor('GtkMangledProbe').xmlName).toBe('gtkmangled:Probe');
        });

        await it('still refuses a mangled member that declares no GTypeName', () => {
            class t {}
            registerBarrel('gtkmangled2', 'GtkMangled2', { Probe: mangled(t, 'e') });
            const message = refusal(() => elementFor('GtkMangled2Probe'));
            expect(message.includes('resolves to class `e`')).toBe(true);
        });
    });
};
