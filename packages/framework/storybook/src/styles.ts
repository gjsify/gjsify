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

/* Subtle dashed frame around the live preview so the widget's bounds stay
   locatable even when it is transparent or in an empty state (e.g. a collapsed
   bottom sheet, a status page, a bare button). currentColor adapts to light/dark. */
.story-stage {
    border: 1px dashed alpha(currentColor, 0.25);
    border-radius: 12px;
    padding: 18px;
}
`;
