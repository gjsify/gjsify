// `cssType`: a port widget answers the type selector its GTK css-name spells, so a stylesheet
// written for GTK (`#main-button revealer { … }`) finds it.
//
// On the TREES entry: the real widget classes need `@nativescript/core` (the platform double).

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { GTK_CSS_NAMES, cssTypeOf, nsTypeSelector } from './widgets/css-names.js';

type Ctor = (new () => object) & { GTypeName?: string };

/** Every exported widget class, by the GType name it declares. */
function classesByGType(): Map<string, Ctor> {
    const found = new Map<string, Ctor>();
    for (const namespace of [Adw, Gtk] as Record<string, unknown>[]) {
        for (const value of Object.values(namespace)) {
            if (typeof value !== 'function' || !Object.hasOwn(value, 'GTypeName')) continue;
            found.set((value as Ctor).GTypeName as string, value as Ctor);
        }
    }
    return found;
}

/** `cssType` as an instance reads it, without constructing one (a window needs a display). */
const cssTypeOfInstance = (ctor: Ctor): unknown => (Object.create(ctor.prototype) as { cssType?: string }).cssType;

export const AdwCssNamesNsTest = async () => {
    const classes = classesByGType();

    await describe('cssType: one spec per widget', async () => {
        for (const [gtype, cssName] of Object.entries(GTK_CSS_NAMES)) {
            await it(`${gtype} answers its GTK css-name '${cssName}'`, () => {
                const ctor = classes.get(gtype);
                expect(ctor === undefined).toBe(false);
                expect(cssTypeOfInstance(ctor as Ctor)).toBe(nsTypeSelector(cssName));
            });
        }
    });

    await describe('cssType: the names the incident needs', async () => {
        await it('is spelled the way NativeScript parses a type selector', () => {
            expect(cssTypeOfInstance(classes.get('GtkRevealer') as Ctor)).toBe('revealer');
            expect(cssTypeOfInstance(classes.get('GtkButton') as Ctor)).toBe('button');
            expect(cssTypeOfInstance(classes.get('AdwHeaderBar') as Ctor)).toBe('headerbar');
            expect(cssTypeOfInstance(classes.get('AdwToggleGroup') as Ctor)).toBe('togglegroup');
        });

        await it('drops only the first hyphen, like the selector parser', () => {
            expect(nsTypeSelector('navigation-view-page')).toBe('navigationview-page');
            expect(nsTypeSelector('Button')).toBe('button');
        });

        await it('lets an application subclass inherit its parent css-name', () => {
            const Box = classes.get('GtkBox') as Ctor;
            class Mine extends Box {}
            expect(cssTypeOf(Mine)).toBe('box');
            expect(cssTypeOfInstance(Mine)).toBe('box');
        });

        await it('answers undefined for a class outside the table', () => {
            class Stranger {}
            expect(cssTypeOf(Stranger)).toBe(undefined);
        });
    });
};
