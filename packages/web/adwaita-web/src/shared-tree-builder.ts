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
import { attributeOf, hostTagOf, propertyOf } from '@gjsify/adwaita-core/tags';

import { slottedChildrenOf } from './slotted-children.js';

/** One authored placement, kept so {@link mountSharedTree} can hold the renderer to it. */
interface PlacedChild {
    parent: HTMLElement;
    child: HTMLElement;
    slot: string;
}

/** One node that authored `extensions`, kept so {@link mountSharedTree} can hold it too. */
interface ExtendedNode {
    el: HTMLElement;
    node: SharedTreeNode;
}

/** What one build collects for the checks that can only run once the tree is connected. */
interface BuildRecord {
    placed: PlacedChild[];
    extended: ExtendedNode[];
}

/**
 * Whether `member` can be assigned on `el`: the nearest descriptor up the prototype chain is
 * a writable data property or an accessor WITH a setter. `in` alone answers true for a
 * getter-only accessor, whose assignment throws in strict code.
 */
function isWritable(el: object, member: string): boolean {
    for (let at: object | null = el; at !== null; at = Object.getPrototypeOf(at) as object | null) {
        const descriptor = Object.getOwnPropertyDescriptor(at, member);
        if (descriptor === undefined) continue;
        return descriptor.set !== undefined || descriptor.writable === true;
    }
    return false;
}

/**
 * A `SharedTreeNode`, realised as a DETACHED element tree: a tag, its authored properties as
 * attributes, its style classes as classes, its extensions (ADR 0072) as the markup the element
 * reads, its placement as `slot=`, its children, in that order — recursive and total,
 * no tag list, no per-block case. A boolean authored property is the ATTRIBUTE'S PRESENCE
 * (`toggleAttribute`), which is what every element in the corpus reads
 * (`hasAttribute('revealed')`, `hasAttribute('expanded')`); spelling `"true"` would set a
 * present attribute for `false` as well.
 *
 * EXCEPT AN AUTHORED `false` ON A PROPERTY THE ELEMENT DECLARES. Absence cannot say `false`
 * where the GTK default is TRUE — `AdwNavigationPage:can-pop`, `GtkActionBar:revealed` —
 * because those elements read an absent attribute as that default, so `can-pop: false`
 * reached the page as `can-pop` unset and the page stayed poppable. The element's own
 * property setter knows its attribute convention, so an authored `false` is written
 * through it when the element (already upgraded: `createElement` of a defined tag
 * constructs it) declares one; everything else keeps the presence rule. "Declares" means a
 * member it can WRITE ({@link isWritable}): a getter-only accessor of the same name — the
 * split button's and the menu button's read-only `active` — would throw a bare `TypeError`
 * out of the assignment, so such a property falls back to the presence rule too.
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
export function buildSharedTree(node: SharedTreeNode, record: BuildRecord = { placed: [], extended: [] }): HTMLElement {
    const el = document.createElement(hostTagOf(node.tag));
    // The id is how the TypeScript beside a `.blp` reaches this element
    // (`root.querySelector('#…')`), the counterpart of `InternalChildren` on GTK.
    if (node.id !== undefined) el.id = node.id;
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        const member = propertyOf(prop);
        if (value === false && isWritable(el, member)) (el as unknown as Record<string, unknown>)[member] = false;
        else if (typeof value === 'boolean') el.toggleAttribute(attributeOf(prop), value);
        else el.setAttribute(attributeOf(prop), String(value));
    }
    // `styleClasses` is `GtkWidget:css-classes`, and this renderer's door for it is the
    // `class` attribute — what `.title-1`, `.dimmed` and `.card` select on. Unread, a
    // `.blp`'s `styles ["title-1"]` reached the tree and never the page.
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) el.classList.add(...node.styleClasses);
    writeExtensions(el, node);
    if (node.extensions !== undefined) record.extended.push({ el, node });
    for (const child of node.children ?? []) {
        const childEl = buildSharedTree(child, record);
        if (child.slot !== undefined) {
            childEl.setAttribute('slot', child.slot);
            record.placed.push({ parent: el, child: childEl, slot: child.slot });
        }
        el.append(childEl);
    }
    return el;
}

/**
 * ADR 0072's `extensions`, written in the markup this package already reads for each.
 *
 * `strings` is the `strings` attribute, a JSON array — `Gtk.StringList:strings` is a real
 * property, and JSON is how `model` is written on the two elements that take the list (see
 * `string-list-slot.ts`). `responses` are `<adw-alert-response>` children, the markup
 * spelling of GtkBuilder's `<response>` that `<adw-alert-dialog>` consumes at connect. A
 * translatable string is written as its source text: no renderer here translates, and the
 * marking stays on the tree for whoever extracts it.
 */
function writeExtensions(el: HTMLElement, node: SharedTreeNode): void {
    const strings = node.extensions?.strings;
    if (strings !== undefined) el.setAttribute('strings', JSON.stringify(strings.map((string) => string.value)));
    for (const response of node.extensions?.responses ?? []) {
        const responseEl = document.createElement('adw-alert-response');
        responseEl.id = response.id;
        if (response.appearance !== undefined) responseEl.setAttribute('appearance', response.appearance);
        if (response.enabled === false) responseEl.setAttribute('enabled', 'false');
        responseEl.textContent = response.label;
        el.append(responseEl);
    }
}

/** The response API an element answers to — `<adw-alert-dialog>`'s, named after libadwaita's. */
interface ResponseReader {
    getResponseLabel(id: string): string | null;
    getResponseAppearance(id: string): string | null;
    getResponseEnabled(id: string): boolean;
}

/**
 * An extension the realised element did not take is refused, after connect, like a slot.
 *
 * Both doors are markup the ELEMENT consumes, so writing them proves nothing: an element that
 * has no `model` slot, or is not a dialog, leaves the list or the responses where the builder
 * put them, and the widget renders empty at exit 0. So each is read back off the element. A
 * string list must have been consumed (it is data and leaves the tree when taken); every
 * response must be registered with the label, appearance and enabled state the tree authored.
 */
function refuseUnheldExtensions(extended: readonly ExtendedNode[]): void {
    for (const { el, node } of extended) {
        if (node.extensions?.strings !== undefined && el.isConnected) {
            const parent = el.parentElement?.localName ?? 'nothing';
            throw new Error(
                `<${parent}> did not take the <${el.localName}> authored at "${el.getAttribute('slot') ?? ''}", so ` +
                    `its ${node.extensions.strings.length} string(s) reach no list.`,
            );
        }
        const reader = el as unknown as Partial<ResponseReader>;
        for (const response of node.extensions?.responses ?? []) {
            const held =
                typeof reader.getResponseLabel === 'function' &&
                reader.getResponseLabel(response.id) === response.label &&
                reader.getResponseAppearance?.(response.id) === (response.appearance ?? 'default') &&
                reader.getResponseEnabled?.(response.id) === (response.enabled ?? true);
            if (!held) {
                throw new Error(
                    `<${el.localName}> did not register the response "${response.id}" as authored, so the ` +
                        'dialog would show without it.',
                );
            }
        }
    }
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
    const record: BuildRecord = { placed: [], extended: [] };
    host.append(buildSharedTree(node, record));
    document.body.append(host);
    // After the append, because that is what upgrades the elements and runs the binds the
    // refusal reads; before the return, because a caller handed a tree back has no way left
    // to tell a placement that was honoured from one that was dropped.
    try {
        refuseUnknownSlots(record.placed);
        refuseUnheldExtensions(record.extended);
    } catch (error) {
        host.remove();
        throw error;
    }
    return { root: host.firstElementChild as HTMLElement, unmount: () => host.remove() };
}
