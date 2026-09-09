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

import { classNameWith, normalizeStyleClasses, withCssClass, withoutCssClass } from './widgets/style-classes.js';

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

    await describe('classNameWith with NO base — the two widgets that have no class of their own', async () => {
        await it('a bare `Gtk.Box` or `Gtk.Label` carries nothing at all', () => {
            // GTK's `box` and `label` are CSS NAMES, never members of `css-classes`, and
            // neither has an Adwaita fill or typography of its own to carry.
            expect(classNameWith('', [])).toBe('');
        });

        await it('carries only the caller\u2019s classes, with no leading space', () => {
            // A leading space is not cosmetic: NativeScript splits `className` on
            // whitespace into the live `cssClasses` Set, so `' title-1'` adds an EMPTY
            // class name beside the real one.
            expect(classNameWith('', ['title-1'])).toBe('title-1');
            expect(classNameWith('', ['card', 'accent'])).toBe('card accent');
            expect(classNameWith('', ['title-1']).startsWith(' ')).toBe(false);
        });
    });

    await describe('withCssClass / withoutCssClass — GTK\u2019s own methods, over the same list', async () => {
        // Measured under gjs 1.88.1 on a `Gtk.Button`, `get_css_classes()` after each call:
        //   add a, add b, add a      ['a','b']    a second add does not move the class
        //   remove b                 ['a']
        //   remove b again           ['a']        absent is a no-op, not an error
        await it('appends at the end', () => {
            expect(withCssClass([], 'pill')).toStrictEqual(['pill']);
            expect(withCssClass(['pill'], 'suggested-action')).toStrictEqual(['pill', 'suggested-action']);
        });

        await it('a second add of a class already held is a no-op and does NOT move it', () => {
            expect(withCssClass(['a', 'b'], 'a')).toStrictEqual(['a', 'b']);
        });

        await it('removes a class it holds, and shrugs at one it does not', () => {
            expect(withoutCssClass(['pill', 'flat'], 'flat')).toStrictEqual(['pill']);
            expect(withoutCssClass(['pill'], 'flat')).toStrictEqual(['pill']);
            expect(withoutCssClass([], 'flat')).toStrictEqual([]);
        });

        await it('trims, because the string door already means \u201Ca list\u201D', () => {
            expect(withCssClass([], '  pill  ')).toStrictEqual(['pill']);
            expect(withoutCssClass(['pill'], '  pill  ')).toStrictEqual([]);
        });

        await it('drops an empty name rather than adding a class nothing can be', () => {
            expect(withCssClass([], '')).toStrictEqual([]);
            expect(withCssClass([], '   ')).toStrictEqual([]);
        });

        await it('never mutates the list it is given — the widget holds one and rewrites className', () => {
            const held = ['pill'];
            withCssClass(held, 'flat');
            withoutCssClass(held, 'pill');
            expect(held).toStrictEqual(['pill']);
        });
    });
};
