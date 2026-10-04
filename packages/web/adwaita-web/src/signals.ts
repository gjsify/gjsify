// The GTK signals an element dispatches, and the DOM event each one arrives as (ADR 0093 § 3).
//
// A GTK signal name is not a DOM event name — `clicked` is a native `click` here, `notify::active`
// is a `CustomEvent` of that very name — so a `.blp`'s `clicked => $onClicked()` cannot be wired by
// the name alone, and an element that dispatches nothing under it must not be wired silently. Each
// element declares its signals in a `static signals` the way it declares its `slots`, and the
// builder refuses a signal the element does not declare.

/** GTK signal name → the DOM event type the element dispatches it as. */
export type DispatchedSignals = Readonly<Record<string, string>>;

/** The signals `el`'s class declares, or none. */
export function dispatchedSignalsOf(el: Element): DispatchedSignals {
    return (el.constructor as { signals?: DispatchedSignals }).signals ?? {};
}
