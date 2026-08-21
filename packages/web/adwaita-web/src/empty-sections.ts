// "Hidden while it has no children" — the ONE derivation, kept live.
//
// THE INCIDENT
//
// Six container getters across three elements documented themselves as imperative
// append points — `<adw-toolbar-view>.topBar`/`.bottomBar`,
// `<adw-action-row>.prefixSection`/`.suffixSection`,
// `<adw-expander-row>.prefixSection`/`.suffixSection` — and then derived
// `hidden = childElementCount === 0` exactly once, inside the `_initialized` guard or
// inside a `_render()` only `attributeChangedCallback` can reach. Neither hears a
// childList change. So a header bar appended AFTER connect sat in the DOM with the
// right classes at offsetHeight 0, while the identical DECLARED bar rendered at 48px:
// the compiled sheet ends with a global `[hidden] { display: none !important }`, which
// the widget's own `display: flex` cannot beat. Measured the same in Firefox and
// Chromium.
//
// `<adw-clamp>` had already paid for this and fixed it with a MutationObserver on
// `{ childList: true }`, in a comment naming the toolbar view's empty-bar handling as
// the same bug. This is that fix, lifted so there is one copy rather than a seventh
// site deriving it a seventh time.
//
// NOTHING TO TEAR DOWN, deliberately. The observed nodes are children this element
// BUILT and owns, so the observer is unreachable the moment the element is, and is
// collected with it — the same reasoning `<adw-overlay-split-view>` writes above the
// `keydown` listener it binds once and never removes. Only a binding that reaches
// OUTSIDE (document, window, a media query) has to be released on disconnect and
// re-established on every connect. Keeping it bound while detached is also the better
// behaviour: a bar appended to a parked widget is already right when it comes back.

/**
 * Hide each of `sections` exactly while it holds no element children, now and on every
 * later childList change.
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
