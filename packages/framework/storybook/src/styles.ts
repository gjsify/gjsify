// Built-in storybook chrome styles, shipped as a string so the package has no
// CSS asset to resolve in library-build mode. Loaded by StorybookApplication
// into a Gtk.CssProvider; a consumer's own widget stylesheet is layered on top
// via StorybookOptions.css.

export const STORYBOOK_CSS = `
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
