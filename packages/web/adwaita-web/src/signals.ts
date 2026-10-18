// The GTK signals an element dispatches, and the DOM event each one arrives as (ADR 0093 § 3).
//
// A GTK signal name is not a DOM event name — `clicked` is a native `click` here, `notify::active`
// is a `CustomEvent` of that very name — so a `.blp`'s `clicked => $onClicked()` cannot be wired by
// the name alone, and an element that dispatches nothing under it must not be wired silently. Each
// element declares its signals in a `static signals` the way it declares its `slots`, and the
// builder refuses a signal the element does not declare.

/** GTK signal name → the DOM event type the element dispatches it as. */
export type DispatchedSignals = Readonly<Record<string, string>>;

/**
 * The signals `el`'s class and every class above it declare, or none. A class inherits its
 * base's signals as a GObject class does (`map` / `unmap` are declared once, on
 * `WidgetElement`); where two declare the same name, the more derived class wins.
 */
export function dispatchedSignalsOf(el: Element): DispatchedSignals {
    const chain: DispatchedSignals[] = [];
    for (let klass: unknown = el.constructor; typeof klass === 'function'; klass = Object.getPrototypeOf(klass)) {
        const own = Object.getOwnPropertyDescriptor(klass, 'signals')?.value as DispatchedSignals | undefined;
        if (own !== undefined) chain.unshift(own);
    }
    return Object.assign({}, ...chain) as DispatchedSignals;
}
