// `Gtk.Widget:tooltip-text` on a boxed-list row.
//
// A BROWSER'S TOOLTIP IS THE `title` CONTENT ATTRIBUTE, and on a row that attribute is
// already spoken for: `Adw.PreferencesRow:title` is the row's LABEL and is authored as
// `title=`, which is the same attribute `HTMLElement.title` reflects. Writing the tooltip
// to the host would blank the label, so it goes to the row's own parts instead — and the
// browser then finds it FIRST. Firefox resolves a tooltip by walking UP from the hovered
// node until an element carries a non-empty `title`, so one `title` per part covers
// everything inside it. Two consequences, both wanted:
//
//   - a SLOTTED control that carries a tooltip of its own still wins, which is GTK's
//     precedence too — `gtk_widget_set_tooltip_text` on a child replaces the parent's;
//   - a part the element owns for its OWN tooltip keeps it, which is why the entry row
//     hands over its prefixes / area / suffixes and not its apply button.
//
// A PART ONLY COUNTS IF IT COVERS THE ROW. Measured on the shipped row before the
// `data-row-tooltip` marker existed: a 884x54 `adw-action-row` offered the LABEL over 36 of
// its 54 rows of pixels and across its 24px of inline padding, and the tooltip only over the
// 18px the label text happens to occupy — the label column is content-height in a 54px row,
// so two thirds of the widget's own hit area fell through to the host and found the label.
// The tooltip has to reach the whole widget the way GTK's does, so the marked part STRETCHES
// (`scss/_row.scss`) and the row's inline padding is what is left; `row-tooltip.spec.ts`
// measures the covered region against the row's box so this cannot come back.
//
// Upstream has no stylesheet rule for this: GTK draws the tooltip surface itself
// (`refs/libadwaita/src/stylesheet/widgets/_tooltip.scss`), and `refs/adwaita-web` has no
// `tooltip` anywhere. The browser's own tooltip IS the port.

/**
 * Apply `row`'s `tooltip-text` to `parts`, or clear it when the attribute is absent.
 *
 * `parts` are the row's OWN sections, never a slotted consumer widget — see the header.
 * Each one is marked `data-row-tooltip`, which is the hook `scss/_row.scss` stretches so
 * the tooltip covers the row rather than the label text inside it.
 */
export function applyRowTooltip(row: HTMLElement, parts: readonly Element[]): void {
    const tooltip = row.getAttribute('tooltip-text') ?? '';
    for (const part of parts) {
        if (tooltip) {
            // Only on a real change: `_render` runs on every unrelated attribute write, and
            // `setAttribute` fires a mutation record even for the value already there.
            if (part.getAttribute('title') !== tooltip) part.setAttribute('title', tooltip);
            if (!part.hasAttribute(TOOLTIP_PART_ATTR)) part.setAttribute(TOOLTIP_PART_ATTR, '');
        } else {
            part.removeAttribute('title');
            part.removeAttribute(TOOLTIP_PART_ATTR);
        }
    }
}

/** The hook `applyRowTooltip` marks its parts with, and `scss/_row.scss` selects on. */
const TOOLTIP_PART_ATTR = 'data-row-tooltip';
