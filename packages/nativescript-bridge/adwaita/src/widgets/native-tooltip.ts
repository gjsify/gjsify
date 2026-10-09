// `GtkWidget:tooltip-text` on the one platform that has a tooltip for a touch screen.
//
// Android's `View.setTooltipText` (API 26) shows the text on LONG PRESS and hands it to
// TalkBack as well, which is the closest a phone gets to GTK's hover tooltip. iOS and the
// platform double have no such method on the native view, so the call is skipped there and
// `accessibilityHint` (written by the caller) stays the whole story.
//
// DUCK-TYPED on purpose: the method is looked up on the native view, so the same code is a no-op
// in a Node/GJS spec. Below API 26 the method is still found by name on some runtimes' proxies
// and then throws `NoSuchMethodError`, so the level is read like `popup-menu-surface.android.ts`
// does and checked first. An SDK_INT guard rather than `TooltipCompat`: that class lives in
// androidx.appcompat, which a NativeScript app does not bundle (only androidx.core).

interface TooltipTarget {
    nativeViewProtected?: { setTooltipText?: (text: string | null) => void } | null;
}

/** The slice of the `android` global read here; absent off Android. */
declare const android: { os?: { Build?: { VERSION?: { SDK_INT?: number } } } } | undefined;

/** `Build.VERSION_CODES.O`: the first level with `View.setTooltipText`. */
const TOOLTIP_API = 26;

/** `Build.VERSION.SDK_INT`, or `Infinity` where there is no Android runtime (nothing to gate). */
function androidApiLevel(): number {
    return (typeof android !== 'undefined' && android?.os?.Build?.VERSION?.SDK_INT) || Infinity;
}

/** Push `text` onto the view's native tooltip, if the native view has one. Empty clears it. */
export function applyNativeTooltip(view: object, text: string, apiLevel: number = androidApiLevel()): void {
    if (apiLevel < TOOLTIP_API) return;
    const native = (view as TooltipTarget).nativeViewProtected;
    if (native && typeof native.setTooltipText === 'function') native.setTooltipText(text === '' ? null : text);
}
