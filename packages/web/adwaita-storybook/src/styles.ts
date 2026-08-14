// Chrome styles, shipped as a string and injected once on mount (as adwaita-web's own
// stylesheet and the native renderer's STORYBOOK_CSS are). Driven entirely by the
// adwaita-web CSS custom properties, so it follows the active light/dark theme.

export const STORYBOOK_WEB_CSS = `
/* Appearance dialog — round swatches with a selection ring. The web twin of the GTK
   renderer's rules, themselves adapted from Learn6502.

   The CARD is not decoration: in the dark scheme the "dark" swatch is a near-black
   circle on a near-black dialog and is invisible without a lighter surface behind
   it. Centring happens INSIDE the full-width card, so the row does not read as
   left-aligned under the group title. */
.sb-swatch-card {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    padding: 12px;
}
/* Squaring the card's top alone leaves a notch: the row above lives in the group's
   own rounded list, so BOTH sides have to be squared for the join to read as one
   list. The attached card and the group rule below are the two halves of that. */
.sb-swatch-card--attached {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
}
.sb-attached-group .boxed-list {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}
/* Desaturated rather than merely dimmed: while the accent follows the desktop the
   palette must read as unavailable, not as nine slightly faded choices. */
.sb-swatch-card--disabled {
    filter: saturate(0.4) brightness(1.05);
    opacity: 0.7;
}
/* A radio input, so grouping and arrow-key navigation are the platform's. Its own
   glyph is switched off because the swatch IS the indicator — a dot drawn on a
   colour competes with the ring that already says which one is selected. */
.sb-swatch {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 24px;
    height: 24px;
    border-radius: 9999px;
    box-shadow: 0 0 0 3px transparent;
    cursor: pointer;
    /* A hairline on the fill itself. Without it the LIGHT scheme swatch is a
       near-white circle on a near-white card and vanishes — the exact mirror of the
       dark swatch on a dark dialog, and a card alone only fixes one direction.
       --border-color is a currentColor mix, so it holds in both schemes. */
    border: 1px solid var(--border-color);
}
.sb-swatch:checked {
    box-shadow: 0 0 0 3px var(--accent-bg-color);
}
.sb-swatch:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 3px;
}
.sb-swatch:disabled {
    cursor: default;
}
/* The scheme swatches are larger — they are the dialog's primary choice. */
.sb-swatch--scheme {
    width: 44px;
    height: 44px;
}
/* "Follow system" is the two schemes meeting on a diagonal, so the option looks like
   what it does instead of needing a word for it. */
/* light_2 / dark_4 from libadwaita's palette (_palette.scss:37,44), which is what
   Learn6502's selector uses. NOT light_1 (#ffffff): pure white is invisible against
   a light card even with the hairline, and light_2 is the shade the palette offers
   for exactly this. */
.sb-swatch--scheme-system {
    background: linear-gradient(to bottom right, #f6f5f4 49.99%, #241f31 50.01%);
}
.sb-swatch--scheme-light {
    background-color: #f6f5f4;
}
.sb-swatch--scheme-dark {
    background-color: #241f31;
}

.sb-window {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}

/* Each pane in the outer split view is a flex column that fills its height. */
.sb-sidebar-pane,
.sb-content-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    flex: 1 1 auto;
}

/* The toolbar-view content holds either a scroller (sidebar) or the split view
   (content); the inner panes own the scrolling, so this level never scrolls. */
.sb-sidebar-pane adw-toolbar-view > .adw-toolbar-view-content,
.sb-content-pane adw-toolbar-view > .adw-toolbar-view-content {
    overflow: hidden;
}

/* Background scheme: the content header + preview + controls all sit on the
   window (story) background as one surface; only the left story-list column
   (its header + list) keeps the distinct sidebar shade. Matches the native
   renderer. The default adw-header-bar background is its own headerbar shade,
   so override it per pane here. */
.sb-content-pane adw-header-bar {
    background-color: var(--window-bg-color);
}
.sb-sidebar-pane adw-header-bar {
    background-color: var(--sidebar-bg-color);
}

.sb-sidebar-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    background-color: var(--sidebar-bg-color);
}

/* --- Story list (mirrors GTK .navigation-sidebar) --- */
.sb-sidebar-list {
    padding: var(--spacing-xs);
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.sb-category {
    font-size: var(--font-size-small);
    font-weight: 700;
    opacity: var(--dim-opacity);
    padding: 10px var(--spacing-m) 4px;
}

.sb-story-row {
    padding: var(--spacing-xs) var(--spacing-m);
    margin: 0 var(--spacing-xs);
    border-radius: var(--button-radius);
    cursor: pointer;
    color: var(--window-fg-color);
    font-size: var(--font-size-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sb-story-row:hover {
    background-color: var(--button-bg-color);
}

.sb-story-row.selected {
    background-color: var(--accent-bg-color);
    color: var(--accent-fg-color);
}

/* --- Preview area --- */

/* The slotted content pane has to PASS ITS BOUND DOWN, or the scroller below it has
   nothing to scroll against.

   Measured before this rule existed: .adw-osv-content bounded itself correctly at
   697px while its content wanted 1008px, but this div — display: block,
   min-height: auto, flex: 0 1 auto — ignored that and grew to 1008. So
   .sb-preview-scroll inherited clientHeight === scrollHeight, had nothing to scroll,
   and everything past the fold was clipped by the toolbar view's overflow: hidden:
   a tall story just ended mid-page.

   The sidebar never had this. Its scroller sits directly inside the toolbar view's own
   flex content wrapper, so nothing breaks the chain there; this pane is the one place
   a plain div sits between the bound and the scroller.

   NOTE: no backticks in this file's comments — the whole stylesheet is a JS template
   literal, so a backtick ends it and the parse error lands nine lines away. */
.sb-preview-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
}

.sb-preview-scroll {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    background-color: var(--window-bg-color);
}

.sb-story-page {
    display: flex;
    justify-content: center;
    padding: var(--spacing-xl) var(--spacing-m);
    min-height: 100%;
    box-sizing: border-box;
}

.sb-story-clamp {
    width: 100%;
    max-width: 600px;
}

.sb-story-group-header {
    padding: var(--spacing-xs) 2px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.sb-story-group-title {
    font-size: var(--font-size-heading);
    font-weight: 700;
    color: var(--window-fg-color);
}

.sb-story-group-description {
    font-size: var(--font-size-base);
    opacity: var(--dim-opacity);
    color: var(--window-fg-color);
}

/* Centered, tinted preview stage (mirrors the native .story-stage).

   The stage has to stay LOCATABLE when the widget on it is transparent or empty
   — that is why it was framed at all. Two corner tints do that with a surface
   instead of a dashed outline, matching the widget gallery on the website.

   BOTH SCHEMES, WITHOUT BRANCHING: --accent-color is the STANDALONE accent
   (#1c71d8 light, #78aeed dark — _variables.scss:55, _theme.scss:33), already
   flipped by the same media query and .theme-dark/.theme-light classes that
   theme everything else here, so this rule needs no scheme of its own. It also
   follows a runtime accent. The purple counter-tint is decoration rather than a
   role and stays a literal, as it is on the website, where it is the same hue in
   both schemes. */
.story-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-m);
    padding: var(--spacing-l);
    margin-top: var(--spacing-s);
    border-radius: var(--card-radius);
    min-height: 80px;
    background-image:
        radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--accent-color) 7%, transparent), transparent 45%),
        radial-gradient(circle at 100% 100%, color-mix(in srgb, #926ee4 6%, transparent), transparent 45%);
}

/* --- Controls panel --- */
.sb-controls-scroll {
    height: 100%;
    overflow-y: auto;
    background-color: var(--window-bg-color);
}

.sb-controls-page {
    padding: var(--spacing-l);
}

/* Range-control card (mirrors the native .story-range-row). */
.sb-range-row {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    padding: var(--spacing-m);
    border-bottom: 1px solid var(--card-shade-color);
}

.sb-range-row:last-child {
    border-bottom: none;
}

.sb-range-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--spacing-m);
}

.sb-range-title {
    font-size: var(--font-size-base);
    font-weight: 700;
    color: var(--card-fg-color);
}

.sb-range-value {
    font-size: var(--font-size-base);
    font-variant-numeric: tabular-nums;
    opacity: var(--dim-opacity);
}

.sb-range-description {
    font-size: var(--font-size-small);
    opacity: var(--dim-opacity);
}

.sb-range-input {
    width: 100%;
    accent-color: var(--accent-bg-color);
}

.sb-color-input {
    width: 42px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--card-shade-color);
    border-radius: var(--button-radius);
    background: none;
    cursor: pointer;
}
`;

let injected = false;

/** Inject the chrome stylesheet once (idempotent, browser-only). */
export function injectStorybookStyles(): void {
    if (injected || typeof document === 'undefined') return;
    if (document.getElementById('adwaita-storybook-style')) {
        injected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = 'adwaita-storybook-style';
    style.textContent = STORYBOOK_WEB_CSS;
    document.head.appendChild(style);
    injected = true;
}
