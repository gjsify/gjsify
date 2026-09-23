// THE INSTANTIATION HALF OF ADR 0051, SHIPPED — the `adwaita-web` third of what #1726 did
// for `gtk-host` and #1729 did for `adwaita-nativescript`. Turning an
// `@gjsify/adwaita-core/conformance` `SharedTreeNode` into real `<adw-*>`/`<gtk-*>` custom
// elements is this renderer's OWN translation, not test code, and it lived only inside
// `shared-trees.spec.ts` — unreachable by a storybook fixture, a devtools probe replaying a
// gallery block, or a second suite, all of which would have had to import a `.spec.ts` file
// to reach it. `hostTagOf`/`attributeOf` moved to `@gjsify/adwaita-core/tags` for exactly
// this: a builder shipping FROM a package, not a dev-only driver reading `scripts/`, can
// depend on the two case rules without depending on `scripts/`, which cannot ship inside an
// npm package at all.
//
// TWO FUNCTIONS, NOT ONE WITH A FLAG — the split neither sibling builder needed.
// `gtk-host`'s `materialize`/`insert` and NativeScript's `_addChildFromBuilder` each fully
// REALISE a widget at construction; nothing later changes what it is. A Custom Element is
// not: most elements this package defines build their internals in `connectedCallback`
// (`shared-trees.spec.ts`'s own note: "these elements build on connect"), which runs only
// once the element is CONNECTED to a document. So `buildSharedTree` alone — `createElement`
// + `setAttribute`, recursing into children — is precisely the builder that ships dead
// nodes: it stays exported for a caller supplying its own attachment point (its result
// becomes live the moment ANYTHING connects it, same as a bare `document.createElement`
// always has), but the complete path most callers want is `mountSharedTree`: build, attach
// under a fresh host `<div>` in `document.body`, hand back the realised root.
//
// `unmount` IS PART OF THE SAME LIFECYCLE, NOT A TEST HOOK. `shared-trees.spec.ts`'s own
// `finally` block is test POLICY (never leave a red test's tree mounted for the next one to
// trip over); the ability to detach what was attached is a plain fact about anything with a
// `connectedCallback`, so `mountSharedTree` hands it back rather than making a caller reach
// into a host `<div>` it was never given.
//
// Placed flat under `src/`, at parity with this package's other single-purpose modules
// (`accent.ts`, `breakpoints.ts`, `icon-registry.ts`) rather than a new `conformance/` or
// `builder/` directory for one file: unlike `gtk-host`, this package has no existing
// `conformance/` home to add to. Exported through the existing barrel, `src/index.ts` — the
// package's `exports` map ships only `.`, and a new subpath would buy nothing for a module
// this small, most of which (the `SharedTreeNode` type) is erased at build anyway.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { attributeOf, hostTagOf } from '@gjsify/adwaita-core/tags';

import { slottedChildrenOf } from './slotted-children.js';

/**
 * `GtkWidget`'s four margins, as the CSS property each one is.
 *
 * WRITTEN AS INLINE STYLE, NOT LEFT AS AN ATTRIBUTE, because an attribute cannot carry a
 * length into a stylesheet portably (`attr()` with a type is not in every engine this
 * package targets). `start`/`end` are the LOGICAL edges, as `gtk_widget_set_margin_start`
 * documents them; `top`/`bottom` are physical in GTK too. The attribute is still written:
 * it is what the tree authored, and what a reader of the DOM looks for.
 */
const GTK_WIDGET_MARGINS: Readonly<
    Record<string, 'marginInlineStart' | 'marginInlineEnd' | 'marginTop' | 'marginBottom'>
> = {
    'margin-start': 'marginInlineStart',
    'margin-end': 'marginInlineEnd',
    'margin-top': 'marginTop',
    'margin-bottom': 'marginBottom',
};

/** One authored placement, kept so {@link mountSharedTree} can hold the renderer to it. */
interface PlacedChild {
    parent: HTMLElement;
    child: HTMLElement;
    slot: string;
}

/**
 * A `SharedTreeNode`, realised as a DETACHED element tree: a tag, its authored properties as
 * attributes, its style classes as classes, its placement as `slot=`, its children, in that order — recursive and total,
 * no tag list, no per-block case. A boolean authored property is the ATTRIBUTE'S PRESENCE
 * (`toggleAttribute`), which is what every element in the corpus reads
 * (`hasAttribute('revealed')`, `hasAttribute('expanded')`); spelling `"true"` would set a
 * present attribute for `false` as well.
 *
 * THE SLOT IS WRITTEN AS THE ATTRIBUTE THIS RENDERER ALREADY ROUTES ON, not translated:
 * `src/slotted-children.ts` reads `slot=` off every light-DOM child and keeps the routing
 * live. This builder read `tag`, `props` and `children` and dropped `slot` silently until a
 * real `.blp` authored one — the `[top]` header bar landed in `adw-toolbar-view-content` and
 * the window title was then discarded by `<adw-header-bar>`'s own build, at exit 0.
 *
 * NOT YET LIVE — see the file header. Nothing here has run `connectedCallback` until
 * something connects it: {@link mountSharedTree} for the common case, or a caller's own
 * container. A DETACHED build therefore cannot check a slot either: an element that has not
 * upgraded has declared no slots yet, so the refusal below belongs to the mount.
 */
export function buildSharedTree(node: SharedTreeNode, placed: PlacedChild[] = []): HTMLElement {
    const el = document.createElement(hostTagOf(node.tag));
    // The id is how the TypeScript beside a `.blp` reaches this element
    // (`root.querySelector('#…')`), the counterpart of `InternalChildren` on GTK.
    if (node.id !== undefined) el.id = node.id;
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        if (typeof value === 'boolean') el.toggleAttribute(attributeOf(prop), value);
        else el.setAttribute(attributeOf(prop), String(value));
        const margin = GTK_WIDGET_MARGINS[attributeOf(prop)];
        if (margin !== undefined) el.style[margin] = `${Number(value)}px`;
    }
    // `styleClasses` is `GtkWidget:css-classes`, and this renderer's door for it is the
    // `class` attribute — what `.title-1`, `.dimmed` and `.card` select on. Unread, a
    // `.blp`'s `styles ["title-1"]` reached the tree and never the page.
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) el.classList.add(...node.styleClasses);
    for (const child of node.children ?? []) {
        const childEl = buildSharedTree(child, placed);
        if (child.slot !== undefined) {
            childEl.setAttribute('slot', child.slot);
            placed.push({ parent: el, child: childEl, slot: child.slot });
        }
        el.append(childEl);
    }
    return el;
}

/**
 * A placement the element has no destination for is refused BY NAME, after connect.
 *
 * `bindSlottedChildren` copies the NATIVE assignment algorithm — an unmatched `slot=` name
 * is assigned nowhere and the child visibly stays put — which is right for hand-written
 * markup and is not a report. An authored tree is a claim about where a widget goes, so the
 * builder that realises one has to say when the renderer could not honour it; a widget
 * silently left beside its destination is the defect this whole path was measured on.
 *
 * The element's own `slots` declaration is the answer, never a list kept here: an element
 * that binds a slot enrols itself in this refusal, and one that stops binding drops out of
 * it visibly.
 *
 * AN ELEMENT THIS PACKAGE DOES NOT DEFINE IS NOT REFUSED, and that exemption is narrow on
 * purpose. An undefined element has exactly ONE destination — itself — so a placement
 * cannot land anywhere but where the tree authored it; what such a tree is really missing
 * is the WIDGET, which is a wider gap than a slot and not this refusal's claim to make.
 * (`AdwApplicationWindow` is the live case: a real `.blp` roots at one and this package has
 * no element for it.) A DEFINED element that routes no named slot is refused like any
 * other: it built a structure and chose not to route into it, so a name it does not have
 * would leave the child beside that structure.
 */
function refuseUnknownSlots(placed: readonly PlacedChild[]): void {
    for (const { parent, child, slot } of placed) {
        if (customElements.get(parent.localName) === undefined) continue;
        const binding = slottedChildrenOf(parent);
        const known = (binding?.slots ?? []).map((declared) => declared.name).filter((name) => name !== undefined);
        if (known.includes(slot)) continue;
        throw new Error(
            `<${parent.localName}> has no slot "${slot}", so the authored <${child.localName}> has nowhere ` +
                `to go. Known slots: ${known.length > 0 ? known.join(', ') : 'none — it routes no named slot'}.`,
        );
    }
}

/** A tree {@link mountSharedTree} built and connected. */
export interface MountedSharedTree {
    /** The authored root — connected, so every custom element under it has upgraded and run. */
    root: HTMLElement;
    /** Disconnects and discards the mount point. */
    unmount: () => void;
}

/**
 * {@link buildSharedTree}, attached under a fresh host `<div>` in `document.body` so the tree
 * — and every custom element in it — is REAL rather than merely constructed. This is the
 * instantiation half a caller reading the corpus's elements normally wants; a bare
 * `buildSharedTree` is for a caller that already has somewhere of its own to attach it.
 */
export function mountSharedTree(node: SharedTreeNode): MountedSharedTree {
    const host = document.createElement('div');
    const placed: PlacedChild[] = [];
    host.append(buildSharedTree(node, placed));
    document.body.append(host);
    // After the append, because that is what upgrades the elements and runs the binds the
    // refusal reads; before the return, because a caller handed a tree back has no way left
    // to tell a placement that was honoured from one that was dropped.
    try {
        refuseUnknownSlots(placed);
    } catch (error) {
        host.remove();
        throw error;
    }
    return { root: host.firstElementChild as HTMLElement, unmount: () => host.remove() };
}
