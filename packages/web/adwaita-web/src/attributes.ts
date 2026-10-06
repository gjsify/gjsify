// The one reading of an attribute that spells a GObject BOOLEAN property.
//
// An HTML boolean attribute can only spell TRUE by PRESENCE, and many GTK properties
// default to TRUE — `GtkWidget:sensitive`, `AdwToggle:enabled`, `GtkEditable:editable`.
// Reading `sensitive` by presence would leave every `<adw-toggle-group>` on a page
// insensitive. So a TRUE-default property is read by VALUE (`sensitive="false"` is the
// only way to say it), and the DEFAULT is passed in at the call site rather than assumed.
// The default varies by widget and property: `show-apply-button` defaults FALSE,
// `AdwBanner:revealed` defaults FALSE, but `GtkActionBar:revealed` defaults TRUE.
// The per-widget map in `@gjsify/adwaita-core/tags` ({@link isValueBasedBooleanAttr})
// records which (widget, property) pairs are value-based.
//
// TWO CATEGORIES, NOT THREE CONVENTIONS (ADR 0049, ADR 0034):
// - STYLE CLASS → presence-based: `flat`, `round`, `compact` — the attribute's PRESENCE
//   toggles the CSS class. `booleanAttribute` is NOT used for these.
// - GTK PROPERTY → value-based per (widget, property): the attribute's VALUE
//   (`"false"` vs anything else) sets the property. `booleanAttribute` IS used for these.
//   A declarative `false` MUST write `attr="false"`, not remove the attribute.
//
// It was a private helper in `elements/adw-entry-row.ts` until a second caller needed it.

import { VALUE_BASED_BOOLEAN_ATTRS } from '@gjsify/adwaita-core/tags';

/** Re-export for consumers that need the list (e.g. `shared-tree-builder.ts`). */
export { VALUE_BASED_BOOLEAN_ATTRS };

/**
 * Whether an attribute spells a boolean property, defaulting to `whenAbsent`.
 *
 * Absent is the property's default; present, the literal `"false"` is FALSE and anything
 * else is TRUE.
 */
export function booleanAttribute(value: string | null, whenAbsent: boolean): boolean {
    if (value === null) return whenAbsent;
    return value !== 'false';
}

/**
 * Write a value-based boolean attribute (GTK property defaulting to TRUE).
 *
 * `true`  → sets `attr="true"` (present, not "false", reads as true)
 * `false` → sets `attr="false"` (present, reads as false)
 * This avoids `toggleAttribute` which removes the attribute for `false`,
 * causing value-based readers to fall back to the default (true).
 */
export function writeBooleanAttribute(el: HTMLElement, attr: string, value: boolean): void {
    if (value) {
        el.setAttribute(attr, 'true');
    } else {
        el.setAttribute(attr, 'false');
    }
}
