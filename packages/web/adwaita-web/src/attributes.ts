// The one reading of an attribute that spells a GObject BOOLEAN property.
//
// An HTML boolean attribute can only spell TRUE by PRESENCE, and every one of these
// properties defaults to TRUE — `GtkWidget:sensitive`, `AdwToggle:enabled`,
// `GtkEditable:editable`. Reading `sensitive` by presence would leave every
// `<adw-toggle-group>` on a page insensitive. So a TRUE-default property is read by VALUE
// (`sensitive="false"` is the only way to say it), and the DEFAULT is passed in at the call
// site rather than assumed, because the two defaults in use here differ and guessing wrong
// inverts a widget: `show-apply-button` is FALSE, the rest are TRUE.
//
// It was a private helper in `elements/adw-entry-row.ts` until a second caller needed it.

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
