// Every custom-element constructor this package's barrel exports, however it exports it.
//
// THE INCIDENT THIS EXISTS TO PREVENT, in the shape it was caught. Two browser drivers
// derive their element set from the package rather than from a list — `Object.values` of
// the module namespace, kept to the functions whose prototype is an `HTMLElement`. That
// read the widget classes because the barrel re-exported every one of them flat. ADR 0034
// § Amendment 6 removed those re-exports: the same scan would have gone on passing while
// its subject shrank to the handful of web-only classes that keep a flat name. Measured
// on chromium: the narrow scan drops 187 of the package's 4633 browser assertions, and
// the only thing that noticed was `connect-lifecycle.spec.ts`'s `tags.length > 40`
// floor. A floor catches the collapse; it does not catch a scan that is merely narrower
// than it reads, and the next removal will be smaller.
//
// So the walk goes ONE LEVEL into the exported objects, which is where `Adw` and `Gtk`
// put their members. One level and not a recursion: the namespaces are flat by
// construction (`namespace.ts` builds them from a single object literal each), and a
// deep walk would start reporting whatever a future export happens to hang off itself.
//
// It is a module rather than a copy in each spec because the second copy is where a
// helper gets lifted, and this was already the second copy.

/** A constructor the `CustomElementRegistry` could hold — the filter both drivers used. */
function isElementClass(value: unknown): value is CustomElementConstructor {
    return typeof value === 'function' && value.prototype instanceof HTMLElement;
}

/**
 * The element classes reachable from `barrel`, de-duplicated.
 *
 * De-duplicated because a class can arrive twice: `Adw.CheckBox`-style aliasing is not
 * used today, but a widget that is both a namespace member and a flat web-only export
 * would otherwise be driven twice and counted twice in the floors below the callers.
 *
 * @param barrel the module namespace of `index.ts` (`import * as adwaitaWeb`)
 */
export function exportedElementClasses(barrel: Record<string, unknown>): CustomElementConstructor[] {
    const found = new Set<CustomElementConstructor>();
    for (const exported of Object.values(barrel)) {
        if (isElementClass(exported)) {
            found.add(exported);
            continue;
        }
        if (typeof exported !== 'object' || exported === null) continue;
        for (const member of Object.values(exported)) if (isElementClass(member)) found.add(member);
    }
    return [...found];
}
