// Built-in storybook chrome styles, shipped as a string so the package has no
// CSS asset to resolve in library-build mode. Loaded by StorybookApplication
// into a Gtk.CssProvider; a consumer's own widget stylesheet is layered on top
// via StorybookOptions.css.

export const STORYBOOK_CSS = `
/* Appearance dialog — round swatches with a selection ring, the shape GNOME's own
   appearance switcher uses. Adapted from Learn6502's theme-mode-selector.css and
   accent-color-selector.css (JumpLink/easy6502, MIT).

   The inner \`radio\` indicator is switched off because the swatch IS the
   indicator: a check mark drawn on top of a colour reads as two competing
   signals, and the ring already says which one is selected.
   \`background-clip: content-box\` is what keeps the ring outside the fill rather
   than tinting it. */
.storybook-swatch {
    min-width: 24px;
    min-height: 24px;
    padding: 6px;
    border-radius: 9999px;
    background-clip: content-box;
    background-image: none;
    box-shadow: inset 0 0 0 3px transparent;
}
.storybook-swatch:checked {
    box-shadow: inset 0 0 0 3px var(--accent-bg-color);
}
.storybook-swatch radio {
    -gtk-icon-source: none;
    border: none;
    background: none;
    box-shadow: none;
    min-width: 12px;
    min-height: 12px;
    padding: 0;
    transform: none;
}
/* Desaturated rather than merely dimmed: while the accent follows the desktop the
   palette has to read as unavailable, not as nine slightly faded choices. */
.storybook-swatch:disabled {
    filter: saturate(0.4) brightness(1.05);
    opacity: 0.7;
}
/* The scheme swatches are larger — they are the dialog's primary choice. */
.storybook-swatch.storybook-scheme-swatch {
    min-width: 44px;
    min-height: 44px;
}
/* "Follow system" is drawn as the two schemes meeting on a diagonal, so the option
   looks like what it does instead of needing a word for it. */
.storybook-swatch.storybook-scheme-system {
    background-image: linear-gradient(to bottom right, #f6f5f4 49.99%, #241f31 50.01%);
}
.storybook-swatch.storybook-scheme-light {
    background-color: #f6f5f4;
}
.storybook-swatch.storybook-scheme-dark {
    background-color: #241f31;
}
/* Squares the top corners so a swatch card sits flush under the row it belongs to,
   instead of the two reading as separate cards with a seam between them. */
.storybook-card-attached {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
}
/* …and the OTHER half, which squaring only the card cannot do: the row above lives
   in the group's .boxed-list, whose own bottom corners are still round, so the two
   met with a notch at each end. Both sides have to be squared for the join to read
   as one list. The transparent bottom border keeps the boxed-list's height where it
   was, so squaring it does not shift the card up by a pixel.
   Adapted from Learn6502's views/preferences.dialog.css (JumpLink/easy6502, MIT). */
.storybook-attached-group .boxed-list {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom: 1px solid transparent;
}

/* Range-control card in the controls sidebar — keeps the label + description
   from being squashed into a single column when the sidebar is narrow. */
.story-range-row {
    padding: 0;
}
.story-range-row > box {
    border-radius: 12px;
}

/* Controls panel shares the window (story) background; only the left
   navigation sidebar keeps a distinct shade. The overlay-split-view sidebar is
   otherwise drawn on the sidebar shade — flatten it onto the window colour. */
.storybook-controls > .sidebar,
.storybook-controls > .sidebar > * {
    background-color: @window_bg_color;
}

/* Subtle dashed frame around the live preview so the widget's bounds stay
   locatable even when it is transparent or in an empty state (e.g. a collapsed
   bottom sheet, a status page, a bare button). @window_fg_color flips with the
   theme (alpha(currentColor, …) does not resolve in a Gtk.CssProvider). */
.story-stage {
    border: 1px dashed alpha(@window_fg_color, 0.28);
    border-radius: 12px;
    padding: 18px;
}
`;
