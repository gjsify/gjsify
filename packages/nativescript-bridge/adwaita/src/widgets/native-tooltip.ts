// `GtkWidget:tooltip-text` on the one platform that has a tooltip for a touch screen.
//
// Android's `View.setTooltipText` (API 26) shows the text on LONG PRESS and hands it to
// TalkBack as well, which is the closest a phone gets to GTK's hover tooltip. iOS and the
// platform double have no such method on the native view, so the call is skipped there and
// `accessibilityHint` (written by the caller) stays the whole story.
//
// DUCK-TYPED on purpose: no `android.*` global is read, so the same code is a no-op in a
// Node/GJS spec and under a pre-API-26 device, and nothing needs a platform check.

interface TooltipTarget {
    nativeViewProtected?: { setTooltipText?: (text: string | null) => void } | null;
}

/** Push `text` onto the view's native tooltip, if the native view has one. Empty clears it. */
export function applyNativeTooltip(view: object, text: string): void {
    const native = (view as TooltipTarget).nativeViewProtected;
    if (native && typeof native.setTooltipText === 'function') native.setTooltipText(text === '' ? null : text);
}
