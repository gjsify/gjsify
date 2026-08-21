// "Hidden while it has no children" — the ONE derivation, kept live.
//
// THE INCIDENT
//
// Eight sections across five elements derived `hidden = childElementCount === 0`
// exactly once — inside the `_initialized` guard, or inside a `_render()` only
// `attributeChangedCallback` can reach. Neither hears a childList change. Six of them
// document themselves as imperative append points (`<adw-toolbar-view>.topBar`/
// `.bottomBar`, `<adw-action-row>` and `<adw-expander-row>`'s `prefixSection`/
// `.suffixSection`), and the other two are the child slots of `<adw-alert-dialog>` and
// `<adw-status-page>`. So a header bar appended AFTER connect sat in the DOM with the
// right classes at offsetHeight 0, while the identical DECLARED bar rendered at 48px:
// the compiled sheet ends with a global `[hidden] { display: none !important }`, which
// the widget's own `display: flex` cannot beat. Measured the same in Firefox and
// Chromium.
//
// `<adw-clamp>` had already paid for the same "evaluated once at connect time" shape
// and fixed it with a MutationObserver on `{ childList: true }`. This is that TECHNIQUE
// applied to the `hidden` derivation, with one home instead of an eighth site deriving
// it an eighth time — the clamp keeps its own observer, because what it re-derives is a
// width, not `hidden`. `<adw-preferences-group>` is the third live one: `hasHeaderSuffix`
// feeds a core derivation rather than a `hidden` flag, so its existing host observer
// watches the suffix instead.
//
// NOTHING TO TEAR DOWN, deliberately. The observed nodes are children this element
// BUILT and owns, so the observer is unreachable the moment the element is, and is
// collected with it — the same reasoning `<adw-overlay-split-view>` writes above the
// `keydown` listener it binds once and never removes. Only a binding that reaches
// OUTSIDE (document, window, a media query) has to be released on disconnect and
// re-established on every connect. Keeping it bound while detached is also the better
// behaviour: a bar appended to a parked widget is already right when it comes back.

/**
 * Hide each of `sections` exactly while it holds no element children — now, and one
 * MICROTASK after every later childList change.
 *
 * The deferral is what a MutationObserver is; it matters because the derivation used to
 * run synchronously inside `_render()`. It lands before paint, so layout is never wrong,
 * but a caller that appends and measures in the SAME task still reads the old answer —
 * `<adw-toolbar-view>._syncClasses` does exactly that via `offsetHeight`, and its
 * undershoot classes are corrected by the ResizeObserver on the next frame.
 *
 * Element children, not child NODES: whitespace between two slotted bars is a text node
 * and an empty bar full of indentation is still an empty bar — which is also why the
 * CSS `:empty` this looks like cannot express it.
 */
export function bindEmptySections(...sections: readonly HTMLElement[]): void {
    const derive = () => {
        for (const section of sections) section.hidden = section.childElementCount === 0;
    };
    const observer = new MutationObserver(derive);
    for (const section of sections) observer.observe(section, { childList: true });
    derive();
}
