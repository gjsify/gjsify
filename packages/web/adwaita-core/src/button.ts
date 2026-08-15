// Adw/Gtk button style classes — the SET, headless.
//
// WHY THIS MODULE EXISTS. A plain button has almost no behaviour, which is exactly
// ADR 0004's "a widget with genuinely trivial behaviour does not need a core class".
// What it does have is a TABLE, and the two renderers each wrote their own — with
// different membership. Measured before this module:
//
//   browser  flat · suggested-action · destructive-action · circular · pill
//   NS       flat · suggested-action · destructive-action ·            pill
//
// `circular` existed on one renderer and not the other, and nothing said so: both
// tables looked complete from inside their own file. The same shape of divergence
// the storybook's own gate now catches for widgets, one level down at the class list.
//
// The COMPOSITION rule stays with the renderers, deliberately. GTK style classes are
// a set (`gtk_widget_add_css_class` — `.pill.suggested-action` is a real button), and
// the browser element composes them that way from independent attributes, while the
// NativeScript widget exposes ONE `variant` because its markup surface is a single
// property. That is a genuine surface difference, not a drifted rule; what must not
// differ is which classes exist and how they are spelled.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Reference: refs/libadwaita/doc/style-classes.md
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** Every documented button style class, in stylesheet order. */
export const ADW_BUTTON_STYLE_CLASSES = ['flat', 'suggested-action', 'destructive-action', 'circular', 'pill'] as const;

/** One of {@link ADW_BUTTON_STYLE_CLASSES}. */
export type AdwButtonStyleClass = (typeof ADW_BUTTON_STYLE_CLASSES)[number];

/**
 * The short names a renderer's own surface uses → the class.
 *
 * The browser element spells them as attributes (`suggested`), the NativeScript one
 * as variants (`suggested-action`). Both spellings resolve here, so neither has to
 * keep a private table to translate.
 */
export const ADW_BUTTON_STYLE_ALIASES: Readonly<Record<string, AdwButtonStyleClass>> = {
    flat: 'flat',
    suggested: 'suggested-action',
    'suggested-action': 'suggested-action',
    destructive: 'destructive-action',
    'destructive-action': 'destructive-action',
    circular: 'circular',
    pill: 'pill',
};

/** The class for one short name, or `null` when the name is not a button style. */
export function buttonStyleClass(name: string | null | undefined): AdwButtonStyleClass | null {
    if (!name) return null;
    return ADW_BUTTON_STYLE_ALIASES[name] ?? null;
}

/**
 * The classes for a set of short names, deduplicated, in {@link ADW_BUTTON_STYLE_CLASSES}
 * order — so two buttons carrying the same styles carry them in the same order, whatever
 * order the caller asked in. Unknown names are dropped rather than passed through: the
 * input is author-written markup, and a typo must not become a class.
 */
export function buttonStyleClasses(names: Iterable<string | null | undefined>): AdwButtonStyleClass[] {
    const wanted = new Set<AdwButtonStyleClass>();
    for (const name of names) {
        const resolved = buttonStyleClass(name);
        if (resolved) wanted.add(resolved);
    }
    return ADW_BUTTON_STYLE_CLASSES.filter((cls) => wanted.has(cls));
}
