// The style-class list a widget carries (ADR 0049), against the property it ports.
//
// The widget classes cannot be imported here — `extends Button` evaluates the bare
// `@nativescript/core` specifier at module-eval — so this suite drives
// `widgets/style-classes.ts`, the SHIPPING pure half both setters call, and asserts the
// `className` those setters produce.
//
// EVERY EXPECTATION HERE WAS MEASURED AGAINST GTK, not derived from the port: gjs 1.88.1 /
// libadwaita 1.9.3, `Gtk.Button.get_css_classes()` after each write.
//
//   fresh button                       []            the CSS name is not in the list
//   set ['a','b','a']                  ['a','b']     de-duplicated
//   set []                             []            a write REPLACES, never accumulates
//   set ['pill','suggested-action']    ['suggested-action','pill']
//
// THE LAST ROW IS WHY ORDER IS NOT ASSERTED AGAINST GTK. GTK holds the list in GQuark
// order — which name was interned first ANYWHERE in the process — so both orders of
// `['zzz-one','aaa-two']` read back `['zzz-one','aaa-two']`. That is an artifact, not a
// contract, so the port keeps the order written and this suite pins THAT.

import { describe, expect, it } from '@gjsify/unit';

import { classNameWith, normalizeStyleClasses } from './widgets/style-classes.js';

/** What `GtkButton`'s setter does, minus the NativeScript base class it cannot import. */
function classNameFor(base: string, value: string | null | undefined): string {
    return classNameWith(base, normalizeStyleClasses(value));
}

export default async () => {
    await describe('normalizeStyleClasses (the XML door: one string, whitespace-separated)', async () => {
        await it('splits on any whitespace, because an attribute can carry a newline', () => {
            expect(normalizeStyleClasses('pill suggested-action')).toStrictEqual(['pill', 'suggested-action']);
            expect(normalizeStyleClasses('pill\tflat\nsuggested-action')).toStrictEqual([
                'pill',
                'flat',
                'suggested-action',
            ]);
        });

        await it('de-duplicates, as gtk_widget_set_css_classes does', () => {
            expect(normalizeStyleClasses('pill pill flat')).toStrictEqual(['pill', 'flat']);
        });

        await it('keeps the order WRITTEN — GTK reads back in GQuark order, which is an artifact', () => {
            expect(normalizeStyleClasses('pill suggested-action')).toStrictEqual(['pill', 'suggested-action']);
            expect(normalizeStyleClasses('suggested-action pill')).toStrictEqual(['suggested-action', 'pill']);
        });

        await it('an empty write is an empty list, and so is no write at all', () => {
            expect(normalizeStyleClasses('')).toStrictEqual([]);
            expect(normalizeStyleClasses('   ')).toStrictEqual([]);
            expect(normalizeStyleClasses(null)).toStrictEqual([]);
            expect(normalizeStyleClasses(undefined)).toStrictEqual([]);
        });

        await it('drops the empties a leading or trailing space produces', () => {
            expect(normalizeStyleClasses('  pill   flat  ')).toStrictEqual(['pill', 'flat']);
        });

        await it('resolves nothing: the names are CLASS names, aliases are the web element’s', () => {
            // `ADW_BUTTON_STYLE_ALIASES` maps `suggested` -> `suggested-action` for
            // `<gtk-button suggested>`. An attribute name is not a class name, and
            // `gtk_widget_set_css_classes` takes any name — unknown ones match no rule.
            expect(normalizeStyleClasses('suggested')).toStrictEqual(['suggested']);
            expect(normalizeStyleClasses('not-a-class')).toStrictEqual(['not-a-class']);
        });
    });

    await describe('classNameWith (the base class is NOT in the list)', async () => {
        await it('a widget with no style classes carries only the class that makes it one', () => {
            expect(classNameFor('adw-button', null)).toBe('adw-button');
            expect(classNameFor('adw-button', '')).toBe('adw-button');
            expect(classNameFor('adw-header-bar', undefined)).toBe('adw-header-bar');
        });

        await it('a look lands BESIDE the base, which is what the compound selectors need', () => {
            // `.adw-button.suggested-action` and `.adw-header-bar.flat` in theme/adwaita.css.
            expect(classNameFor('adw-button', 'suggested-action')).toBe('adw-button suggested-action');
            expect(classNameFor('adw-header-bar', 'flat')).toBe('adw-header-bar flat');
        });

        await it('composes, which the enum could not: `.pill.suggested-action` is an ordinary button', () => {
            expect(classNameFor('adw-button', 'pill suggested-action')).toBe('adw-button pill suggested-action');
        });

        await it('a second write REPLACES the list — gtk_widget_set_css_classes, not add_css_class', () => {
            expect(classNameFor('adw-button', 'pill suggested-action')).toBe('adw-button pill suggested-action');
            expect(classNameFor('adw-button', 'flat')).toBe('adw-button flat');
            expect(classNameFor('adw-button', '')).toBe('adw-button');
        });
    });
};
