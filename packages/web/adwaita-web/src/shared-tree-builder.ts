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

import { assertTreeConstructs, type SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { GTK_WIDGET_MARGIN_CSS, attributeOf, hostTagOf, propertyOf } from '@gjsify/adwaita-core/tags';

import { capabilities } from './capabilities.mjs';
import { dispatchedSignalsOf } from './signals.js';
import { slottedChildrenOf } from './slotted-children.js';
import { templateTagFor } from './template-classes.js';

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
    /** Every authored id and the element it built, which a `bind` source is looked up in. */
    ids: Map<string, HTMLElement>;
    /** The `bindings` of every node, resolved once every id exists (a source may be built after its target). */
    binds: PendingBind[];
    /** The object a signal handler's NAME is resolved against (ADR 0093 § 3), as `Gtk.BuilderScope` does. */
    scope?: Readonly<Record<string, unknown>>;
}

interface PendingBind {
    el: HTMLElement;
    property: string;
    source: string;
    sourceProperty: string;
    flags: readonly string[];
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
export function buildSharedTree(node: SharedTreeNode, record: BuildRecord = newRecord()): HTMLElement {
    // ADR 0093 § 2: the whole tree is checked against the capability table before an element is
    // created. A refused `layout` is named with its node and the reason the table gives.
    assertTreeConstructs('adwaita-web', capabilities, node);
    const root = buildNode(node, record);
    for (const bind of record.binds) bindProperty(bind, record);
    return root;
}

/** A fresh record, with the scope when the caller has one. */
function newRecord(scope?: Readonly<Record<string, unknown>>): BuildRecord {
    return { placed: [], extended: [], ids: new Map(), binds: [], ...(scope === undefined ? {} : { scope }) };
}

/**
 * ADR 0093's `bindings`, the simple form: the target property takes the source's value now and
 * again on every `notify::<property>` the source dispatches (`G_BINDING_SYNC_CREATE`, which is
 * what GtkBuilder's `bind-flags` default means).
 *
 * Refused by name, never dropped: a source that is not an id of this tree (`template` included),
 * a source element that does not dispatch `notify::<property>`, a target without a writable
 * property, and any flag, which this first slice has not verified. An element dispatches
 * `notify::…` only while connected, so a tree built but never attached follows once, at build.
 */
function bindProperty(bind: PendingBind, record: BuildRecord): void {
    const { el, property, source, sourceProperty, flags } = bind;
    const where = `<${el.localName}> \`${property}: bind ${source}.${sourceProperty}\``;
    const from = record.ids.get(source);
    if (from === undefined) {
        throw new Error(`${where} names no object: nothing in this tree has the id '${source}'.`);
    }
    if (flags.length > 0) {
        throw new Error(
            `${where} carries ${flags.join(', ')}: adwaita-web binds the plain form only until each flag is ` +
                'verified against GObject.',
        );
    }
    const notification = `notify::${sourceProperty}`;
    const declared = dispatchedSignalsOf(from);
    const event = declared[notification];
    if (event === undefined) {
        throw new Error(
            `${where}: <${from.localName}> dispatches no '${notification}', so the target would follow the source ` +
                `once and never again. It dispatches: ${Object.keys(declared).join(', ') || 'none'}.`,
        );
    }
    const targetMember = propertyOf(property);
    const sourceMember = propertyOf(sourceProperty);
    if (!isWritable(el, targetMember)) {
        throw new Error(`${where}: <${el.localName}> has no writable property '${targetMember}'.`);
    }
    const follow = () => {
        (el as unknown as Record<string, unknown>)[targetMember] = (from as unknown as Record<string, unknown>)[
            sourceMember
        ];
    };
    follow();
    from.addEventListener(event, follow);
}

function buildNode(node: SharedTreeNode, record: BuildRecord): HTMLElement {
    // An `extern` node is built by the class the application registered under its name (ADR 0093).
    const el = document.createElement(node.extern === true ? templateTagFor(node.tag) : hostTagOf(node.tag));
    // The id is how the TypeScript beside a `.blp` reaches this element
    // (`root.querySelector('#…')`), the counterpart of `InternalChildren` on GTK.
    if (node.id !== undefined) {
        el.id = node.id;
        record.ids.set(node.id, el);
    }
    for (const [property, binding] of Object.entries(node.bindings ?? {})) {
        record.binds.push({
            el,
            property,
            source: binding.source,
            sourceProperty: binding.property,
            flags: binding.flags ?? [],
        });
    }
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        const member = propertyOf(prop);
        if (value === false && isWritable(el, member)) (el as unknown as Record<string, unknown>)[member] = false;
        else if (typeof value === 'boolean') el.toggleAttribute(attributeOf(prop), value);
        else el.setAttribute(attributeOf(prop), String(value));
        // A margin is also inline style (`GTK_WIDGET_MARGIN_CSS` says why); the attribute
        // stays, since it is what the tree authored and what a reader of the DOM looks for.
        const margin = GTK_WIDGET_MARGIN_CSS[attributeOf(prop)];
        if (margin !== undefined) el.style.setProperty(margin, `${Number(value)}px`);
    }
    // `styleClasses` is `GtkWidget:css-classes`, and this renderer's door for it is the
    // `class` attribute — what `.title-1`, `.dimmed` and `.card` select on. Unread, a
    // `.blp`'s `styles ["title-1"]` reached the tree and never the page.
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) el.classList.add(...node.styleClasses);
    writeExtensions(el, node);
    bindSignals(el, node, record);
    if (node.extensions !== undefined) record.extended.push({ el, node });
    for (const child of node.children ?? []) {
        const childEl = buildNode(child, record);
        if (child.page !== undefined) writePage(el, childEl, child);
        if (child.slot !== undefined) {
            childEl.setAttribute('slot', child.slot);
            record.placed.push({ parent: el, child: childEl, slot: child.slot });
        }
        el.append(childEl);
    }
    return el;
}

/**
 * ADR 0093's `signals`: each handler NAME is looked up on the scope the builder was handed and
 * listened for as the DOM event the element declares for that GTK signal.
 *
 * Refused by name, never dropped: a missing scope or handler (as `Gtk.Builder` refuses one), a
 * signal the element does not declare, and the `swapped`, `after` and `object` forms, which this
 * first slice has not verified against GTK's argument order and emission phase.
 */
function bindSignals(el: HTMLElement, node: SharedTreeNode, record: BuildRecord): void {
    const declared = dispatchedSignalsOf(el);
    for (const signal of node.signals ?? []) {
        const name = signal.detail === undefined ? signal.name : `${signal.name}::${signal.detail}`;
        const event = declared[name];
        if (event === undefined) {
            throw new Error(
                `<${el.localName}> declares no signal '${name}', so the handler '${signal.handler}' would never ` +
                    `run. It dispatches: ${Object.keys(declared).join(', ') || 'none'}.`,
            );
        }
        if (signal.object !== undefined || (signal.flags?.length ?? 0) > 0) {
            throw new Error(
                `the handler '${signal.handler}' for '${name}' uses ${signal.object === undefined ? '' : 'an object '}` +
                    `${(signal.flags ?? []).join(', ')}: adwaita-web binds plain handlers only until each of those ` +
                    'is verified against GTK.',
            );
        }
        const handler = record.scope?.[signal.handler];
        if (typeof handler !== 'function') {
            throw new Error(
                `the tree binds the handler '${signal.handler}' for '${name}', and the scope ` +
                    `${record.scope === undefined ? 'was not given (pass `scope`)' : 'has no such function'}.`,
            );
        }
        el.addEventListener(event, (domEvent) => handler.call(record.scope, domEvent));
    }
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
 * (It was `AdwApplicationWindow`, which `showcases/gtk/effect-adw-services/src/window.blp`
 * roots at while this package had no element for it. That element now exists, so the live
 * case is the opposite one: `<adw-window>` and `<adw-application-window>` both declare
 * `content`, which is what that file's `content:` becomes.) A DEFINED element that routes
 * no named slot is refused like any other: it built a structure and chose not to route
 * into it, so a name it does not have would leave the child beside that structure.
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
export function mountSharedTree(
    node: SharedTreeNode,
    options: { scope?: Readonly<Record<string, unknown>> } = {},
): MountedSharedTree {
    const host = document.createElement('div');
    const record = newRecord(options.scope);
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

/**
 * A `page` as the attributes `<gtk-notebook>` (`tab-label`) and `<gtk-stack>` (`name`, `title`)
 * read off their children. Any other parent is refused by name: the attributes would be written
 * and read by nobody.
 */
function writePage(parent: HTMLElement, child: HTMLElement, node: SharedTreeNode): void {
    const { page } = node;
    if (parent.localName === 'gtk-notebook') {
        if (page?.label !== undefined) child.setAttribute('tab-label', page.label);
    } else if (parent.localName === 'gtk-stack') {
        if (page?.name !== undefined) child.setAttribute('name', page.name);
        if (page?.label !== undefined) child.setAttribute('title', page.label);
    } else {
        throw new Error(
            `adwaita-web's shared-tree builder: <${node.tag}> has a page, and <${parent.localName}> has no pages.`,
        );
    }
}
