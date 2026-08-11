// Chrome styles, shipped as a string and injected once on mount (as adwaita-web's own
// stylesheet and the native renderer's STORYBOOK_CSS are). Driven entirely by the
// adwaita-web CSS custom properties, so it follows the active light/dark theme.

export const STORYBOOK_WEB_CSS = `
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

/* Centered, dashed-framed preview stage (mirrors the native .story-stage). */
.story-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-m);
    padding: var(--spacing-l);
    margin-top: var(--spacing-s);
    border: 1px dashed rgba(127, 127, 127, 0.28);
    border-radius: var(--card-radius);
    min-height: 80px;
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
