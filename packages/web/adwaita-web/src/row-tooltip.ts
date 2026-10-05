// `Gtk.Widget:tooltip-text` on a boxed-list row.
//
// A BROWSER'S TOOLTIP IS THE `title` CONTENT ATTRIBUTE, and on a row that attribute is
// already spoken for: `Adw.PreferencesRow:title` is the row's LABEL and is authored as
// `title=`, which is the same attribute `HTMLElement.title` reflects. Writing the tooltip
// to the host would blank the label, so it goes to the row's own parts instead — and the
// browser then finds it FIRST. Firefox resolves a tooltip by walking UP from the hovered
// node until an element carries a non-empty `title` (measured: a child of a titled element
// with no title of its own offers the ancestor's text), so one `title` per part covers
// everything inside it. Two consequences, both wanted:
//
//   - a SLOTTED control that carries a tooltip of its own still wins, which is GTK's
//     precedence too — `gtk_widget_set_tooltip_text` on a child replaces the parent's;
//   - a part the element owns for its OWN tooltip keeps it, which is why the entry row
//     hands over its prefixes / area / suffixes and not its apply button.
//
// The gap is the row's own padding, where no part is hovered and the walk reaches the host
// and finds the LABEL — exactly what the row showed before `tooltip-text` existed. Writing
// to the host instead would blank the label on every row in the package.
//
// Upstream has no stylesheet rule for this: GTK draws the tooltip surface itself
// (`refs/libadwaita/src/stylesheet/widgets/_tooltip.scss`), and `refs/adwaita-web` has no
// `tooltip` anywhere. The browser's own tooltip IS the port.

/**
 * Apply `row`'s `tooltip-text` to `parts`, or clear it when the attribute is absent.
 *
 * `parts` are the row's OWN sections, never a slotted consumer widget — see the header.
 */
export function applyRowTooltip(row: HTMLElement, parts: readonly Element[]): void {
    const tooltip = row.getAttribute('tooltip-text') ?? '';
    for (const part of parts) {
        // Only on a real change: `_render` runs on every unrelated attribute write, and
        // `setAttribute` fires a mutation record even for the value already there.
        if (tooltip) {
            if (part.getAttribute('title') !== tooltip) part.setAttribute('title', tooltip);
        } else {
            part.removeAttribute('title');
        }
    }
}
