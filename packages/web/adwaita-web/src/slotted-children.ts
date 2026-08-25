// Light-DOM slot routing that stays LIVE — "where a `[slot=]` child lands", kept true
// after connect instead of only at parse time.
//
// THE INCIDENT
//
// 42 of the element files under `src/elements/` install their own subtree with
// `this.replaceChildren(…)`, and the ones with slots snapshot the author's children in
// the line before it — ONCE, inside the `_initialized` guard. Every one of them is
// therefore a parse-time-only slot. `row.append(icon)` with `slot="prefix"` after connect
// leaves `icon` as a sibling of the three internal sections rather than inside
// `prefixSection`, where the byte-identical DECLARED child lands; nothing throws and
// nothing logs. `adw-header-bar.spec.ts` had the workaround written down as a test
// convention — "Appended LAST: the sections are built in `connectedCallback`, so the
// slotted children have to be in place before the bar enters the document" — which is
// this bug recorded as a house rule.
//
// It is wrong for hand-written HTML that appends after load, and it is what ADR 0027 § 9
// names as the obstacle to one widget vocabulary across GTK, Blueprint, JSX, Vue and this
// pillar: a renderer mutates its tree after mount by definition, so the same authored
// markup cannot drive both surfaces while a slot is a one-shot read.
//
// WHY A MutationObserver, and not either alternative
//
//   - **native `<slot>`** needs a shadow root, and ADR 0010 keeps this package light-DOM
//     ON PURPOSE: a shadow boundary is symmetric, so it would block the host page's CSS
//     from overriding IN, which is the overridability the `--adw-*` token contract sells.
//     That ADR lists native `<slot>` as part of the deferred shadow path and gates it
//     behind an ADR of its own — so it is not an option available to this fix. No element
//     in the package calls `attachShadow` today.
//   - **re-homing from the CHILD's `connectedCallback`** only reaches children that are
//     themselves custom elements: a plain `<button slot="suffix">` and a bare text node
//     have no callback, and both are slotted here today. It also inverts ownership —
//     every child would have to know its parent's internal structure — so it cannot live
//     in ONE place, which is the whole point of this module. And `connectedCallback`
//     fires on every re-parent of the subtree, so it would re-home on a move that changed
//     nothing.
//
// The observer is also the technique this package already reached for twice for the same
// "evaluated once at connect time" class: `<adw-clamp>` for its child width, and
// `src/empty-sections.ts` for the `hidden` derivation.
//
// WHAT THIS DELIBERATELY DOES NOT DO: reorder.
//
// A late child is APPENDED to its destination, which is where a parse-time child in the
// same position lands. Nothing finer is expressible: `host.insertBefore(child, ref)` with
// an already-adopted `ref` throws `NotFoundError` in the DOM before this module is
// reached, because `ref` is no longer a child of the host. Order fidelity under reordering
// is a property of native `<slot>`, i.e. of the shadow path ADR 0010 § 3 defers — until
// then a renderer that reorders must reorder inside the destination it was given, and
// that divergence is written down here rather than absorbed.
//
// NOTHING TO TEAR DOWN, deliberately. The observed node is the HOST, so the observer is
// unreachable the moment the element is and is collected with it — the same reasoning
// `src/empty-sections.ts` writes above its own. Only a binding that reaches OUTSIDE
// (document, window, a media query) has to be released on disconnect and re-established
// on every connect, which is what `scripts/check-adwaita-connect-rebind.mjs` polices.
// Staying bound while detached is also the better behaviour: a child appended to a parked
// widget is already in the right place when it comes back.

export interface AdwSlotClaim {
    /** The `slot="…"` value claimed. Omit for the DEFAULT slot — everything else. */
    readonly name?: string;
    /**
     * Claim by NODE as well as by slot name, for the typed-child spelling
     * (`<adw-alert-response>` IS the slot) and for a default that takes only some node
     * kinds (`<adw-entry-row>` adopts elements and drops stray whitespace, as GtkBuildable
     * does). Tried after an explicit `slot=` name and before the default, so a claim can
     * never swallow a child that named a different slot.
     */
    readonly claims?: (node: Node) => boolean;
}

/** A destination that RE-HOMES what it claims — the ordinary slot. */
export interface AdwSlotInto extends AdwSlotClaim {
    readonly into: HTMLElement;
}

/**
 * A slot whose child is consumed by a CALL rather than by a move: either data —
 * `<adw-alert-response id="ok">` is read for its id, label and appearance and then gone,
 * exactly as GtkBuilder leaves nothing of a `<responses>` entry in the widget tree — or a
 * widget whose insertion rule is the element's own (`addPrefix` PREPENDS, mirroring
 * `gtk_box_prepend`). A node the call did not move out of the host is dropped, so a
 * data-only child cannot linger as a stray sibling of the internal structure.
 */
export interface AdwSlotConsume extends AdwSlotClaim {
    readonly consume: (node: Node) => void;
}

export type AdwSlot = AdwSlotInto | AdwSlotConsume;

export interface AdwSlottedChildren {
    /** The declared slots, so a driver can probe them without a hand-written ledger. */
    readonly slots: readonly AdwSlot[];
    /**
     * Route the host's CURRENT children into their slots, then make `structure` the
     * host's own children, then stay live.
     *
     * The three steps are one call because their ORDER is the invariant: the author's
     * children have to leave the host before it is emptied, or `replaceChildren` destroys
     * them — the bug `<adw-entry-row>` records above its own `_authored` snapshot. Passing
     * `structure` here also means the set this module must never route is DERIVED from the
     * call that installs it, rather than a second list to keep in sync.
     *
     * Call once per built subtree; a second call replaces the observer rather than
     * stacking one.
     */
    install(...structure: readonly Node[]): void;
    /** The slot `node` belongs to, or `null` when none claims it. */
    slotFor(node: Node): AdwSlot | null;
}

/** Where a bound host's slots can be read back from — see {@link slottedChildrenOf}. */
const BOUND = new WeakMap<Element, AdwSlottedChildren>();

/**
 * The slot binding `host` installed, if it has one.
 *
 * This is how `slotted-children.spec.ts` drives EVERY registered element rather than a
 * list of the ones someone remembered: an element that binds a slot enrols itself in the
 * placement driver, and one that stops binding drops out of it visibly.
 */
export function slottedChildrenOf(host: Element): AdwSlottedChildren | undefined {
    return BOUND.get(host);
}

/**
 * Bind `host`'s light-DOM children to `slots`.
 *
 * `onAdopt` fires for a child adopted AFTER {@link AdwSlottedChildren.install} and not
 * during it: the install pass IS the element's own build, which seeds its state on the
 * next line with everything that landed, so firing there would make every element's build
 * order depend on how many children the author wrote.
 */
export function bindSlottedChildren(
    host: HTMLElement,
    slots: readonly AdwSlot[],
    onAdopt?: (node: Node, slot: AdwSlot) => void,
): AdwSlottedChildren {
    const named = new Map<string, AdwSlot>();
    const typed: Array<[(node: Node) => boolean, AdwSlot]> = [];
    let fallback: AdwSlot | null = null;
    for (const slot of slots) {
        const claims = slot.claims;
        if (slot.name !== undefined) named.set(slot.name, slot);
        if (claims !== undefined) typed.push([claims, slot]);
        if (slot.name === undefined && claims === undefined) fallback = slot;
    }

    /** The host's OWN children, installed by this module — never routed back into a slot. */
    let structure: ReadonlySet<Node> = new Set();
    let observer: MutationObserver | null = null;

    const slotFor = (node: Node): AdwSlot | null => {
        if (structure.has(node)) return null;
        // An explicit `slot=` NAME is answered first and answered alone: `slot=""` is the
        // default slot in the native assignment algorithm, and an unmatched name is
        // assigned nowhere at all. Both are copied deliberately — a `slot="sufix"` typo
        // that silently became default content would render in the wrong place and look
        // intentional, where a child that visibly stays put does not.
        const name = node instanceof Element ? (node.getAttribute('slot') ?? '') : '';
        if (name !== '') return named.get(name) ?? null;
        // Then the typed claims (`<adw-alert-response>` IS the slot), then the default.
        for (const [claims, slot] of typed) if (claims(node)) return slot;
        return fallback;
    };

    const route = (node: Node): AdwSlot | null => {
        const slot = slotFor(node);
        if (slot === null) return null;
        if ('into' in slot) {
            slot.into.appendChild(node);
            return slot;
        }
        slot.consume(node);
        // Data, not content: the call read what it needed and left the node where it was,
        // so it has to go. A `consume` that MOVED the node (`addPrefix`) has already
        // changed the parent and this is a no-op.
        if (node.parentNode === host) host.removeChild(node);
        return slot;
    };

    const binding: AdwSlottedChildren = {
        slots,
        slotFor,
        install(...nodes: readonly Node[]) {
            for (const node of Array.from(host.childNodes)) route(node);
            structure = new Set(nodes);
            host.replaceChildren(...nodes);
            // Armed AFTER `replaceChildren`, so its own records are never delivered: an
            // observer armed first would see the whole of `structure` as added nodes and
            // spend a microtask rejecting them.
            observer?.disconnect();
            observer = new MutationObserver((records) => {
                for (const record of records) {
                    // Only the HOST's own child list. A destination's records are the
                    // CONSEQUENCE of a move, and re-routing them appends each child a
                    // second time — the reason `<adw-preferences-group>` filtered on
                    // `record.target` back when it was the only element doing this.
                    if (record.target !== host) continue;
                    for (const node of record.addedNodes) {
                        const slot = route(node);
                        if (slot !== null) onAdopt?.(node, slot);
                    }
                }
            });
            observer.observe(host, { childList: true });
        },
    };
    BOUND.set(host, binding);
    return binding;
}
