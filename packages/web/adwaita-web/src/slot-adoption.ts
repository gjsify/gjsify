// "Routed to its section at connect" — kept live, so a child that arrives later lands
// in the same place.
//
// THE INCIDENT
//
// Eight elements re-home their `[slot="…"]` children into an internal section, exactly
// once, inside the `_initialized` guard of `connectedCallback`. A child appended
// AFTERWARDS is never moved: it stays a direct child of the host, unstyled and
// unordered, and — because it is still visible — it looks placed. Measured in Firefox
// against a parse-time control, 14 of the 15 (element, slot) pairs the pillar routes:
//
//     <adw-toolbar-view> [slot=top]   wanted div.adw-toolbar-view-top   got (light DOM)
//     <adw-header-bar>   [slot=start] wanted div.adw-header-bar-start   got (light DOM)
//     <adw-action-row>   [slot=prefix] wanted div.adw-action-row-prefix got (light DOM)
//
// The fifteenth is `<adw-preferences-group>`, which already observes its host's
// childList — so it is both the exception and the proof the driver measures something.
//
// WHY IT MATTERS BEYOND HAND-WRITTEN HTML. ADR 0027 § 9 names exactly this as the
// measured obstacle to one authored tree driving both this pillar and the GTK host: a
// renderer mutates its tree after mount by definition, so a slot adopted once cannot
// serve one. It is also simply wrong for `bar.append(button)`, which is the imperative
// half of every one of these elements' documented surface.
//
// `bindEmptySections` is the sibling of this file and the same technique — the
// MutationObserver `<adw-clamp>` paid for first, in ONE home rather than an eighth site
// deriving it an eighth time. What differs is only the derivation: that one keeps a
// `hidden` flag true, this one keeps a child in the right parent.
//
// NOTHING TO TEAR DOWN, for the reason `empty-sections.ts` states in full: the observed
// node is the HOST, which owns the observer, so the two become unreachable together.
// Only a binding that reaches outside (document, window, a media query) has to be
// released on disconnect.

/**
 * Where each slot name routes: the section to append to, or a function that places the
 * child itself.
 *
 * The function form is not a convenience. `<adw-entry-row>` PREPENDS a prefix —
 * `adw_entry_row_add_prefix` mirrors `gtk_box_prepend`, so several prefixes stack in
 * reverse call order — and a plain `appendChild` would silently reverse that for a
 * late child while the parse-time path kept it. An element that already owns an
 * `addPrefix`/`addSuffix` passes that method and stays the single authority on its own
 * ordering.
 */
export type SlotRoute = HTMLElement | ((node: Element) => void);

export interface SlotRoutes {
    readonly [slot: string]: SlotRoute | undefined;
}

/**
 * Route `[slot="…"]` children of `host` into `routes`, now and after every later
 * childList change on the host.
 *
 * ONLY THE HOST'S OWN CHILDREN, and only ADDED ones. Both halves are load-bearing, and
 * `<adw-preferences-group>._observeHost` learned each of them the hard way: a record
 * whose target is a section is the CONSEQUENCE of a move this function just made, and
 * re-routing it appends the same child a second time.
 *
 * A child whose `slot` names nothing in `routes` is LEFT ALONE. That is deliberate and
 * it is the conservative half: an element's own parts (`this._startEl`) carry no `slot`
 * attribute, and neither does a consumer's unslotted content, so neither is touched by
 * a helper whose whole job is named placement.
 */
export function bindSlotAdoption(host: HTMLElement, routes: SlotRoutes, afterAdopt?: () => void): void {
    const route = (node: Node): boolean => {
        if (!(node instanceof Element)) return false;
        const slot = node.getAttribute('slot');
        if (slot === null) return false;
        const destination = routes[slot];
        if (destination === undefined) return false;
        if (typeof destination === 'function') {
            destination(node);
            return true;
        }
        if (node.parentElement === destination) return false;
        destination.appendChild(node);
        return true;
    };

    const observer = new MutationObserver((records) => {
        let adopted = false;
        for (const record of records) {
            if (record.target !== host) continue;
            for (const node of record.addedNodes) adopted = route(node) || adopted;
        }
        // Only when something MOVED, and only once per batch. `<adw-header-bar>` uses it
        // to drop the automatic title the moment a real `slot="center"` widget arrives —
        // its parse-time path chooses one or the other, so a late child that merely sat
        // BESIDE the auto title would render two titles where the declared form renders
        // one.
        if (adopted) afterAdopt?.();
    });
    observer.observe(host, { childList: true });

    // The children present RIGHT NOW, so a caller that appends in the same task as the
    // mount is not left waiting for the observer's microtask. `connectedCallback` has
    // already re-homed the parse-time ones; this catches anything appended between the
    // element being created and this call.
    let adopted = false;
    // SNAPSHOT, and the linter is wrong to call the spread useless here: `children` is a
    // LIVE HTMLCollection, and routing a child moves it OUT of the host. Iterating the
    // collection itself therefore renumbers under the loop and skips every second match.
    // eslint-disable-next-line unicorn/no-useless-spread -- the collection is live and this loop mutates it
    for (const child of [...host.children]) adopted = route(child) || adopted;
    if (adopted) afterAdopt?.();
}
