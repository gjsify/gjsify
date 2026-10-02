// Pango's justification switch, as a CSS `text-align` — the one place this package spells
// it, because TWO widgets show justified text: `<gtk-label>` (through `Gtk.Label:justify`)
// and `<gtk-text-view>` (through `Gtk.TextView:justification`). The enum is Pango's, not
// either widget's: `gtk_text_view_set_justification` writes the same
// `layout->default_style->justification` (gtktextview.c:3560-3573) that `gtk_label_set_justify`
// writes, so the two properties take the same four nicks through the same layout field.
//
// LEFT and RIGHT are START and END of the TEXT DIRECTION, which is what the C means: a
// justified label reads `Gtk.Justification.LEFT` in either direction and lands on the leading
// edge. FILL is start-aligned lines with the spaces between words stretched, which is CSS
// `justify`.
//
// `normalizeLabelJustify` (`@gjsify/adwaita-core`) is the reader of the nick, and it reads it
// the same way for both widgets — which is what makes a shared table the right shape here
// rather than a second switch.

import type { LabelJustification } from '@gjsify/adwaita-core';

export const JUSTIFY_TEXT_ALIGN: Record<LabelJustification, string> = {
    left: 'start',
    right: 'end',
    center: 'center',
    fill: 'justify',
};
