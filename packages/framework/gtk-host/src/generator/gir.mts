/**
 * Read the GIR XML into a plain model.
 *
 * WHY THE XML AND NOT THE TYPELIB. Both carry the structure — measured on gtk
 * 4.22.4, `GIRepository` 3.0 answers class enumeration, abstractness, properties
 * with `CONSTRUCT_ONLY`, signals, methods and property enum types, and its
 * concrete-widget set is IDENTICAL to the XML's. What the typelib does not carry,
 * and offers no API that could, is documentation, default values and
 * since-versions: it strips them by design, which is why gi-docgen reads the GIR.
 * ADR 0028 § 6 makes these surfaces a PUBLISHED artifact whose point is what a
 * consumer's editor shows on hover, so the richer input wins.
 *
 * WHY @gjsify/domparser. Measured on the 6.2 MB `Gtk-4.0.gir`: 232 ms, RSS 53 MB
 * -> 96 MB, and its `application/xml` mode is right where it has to be —
 * selectors are case-SENSITIVE (`CLASS` matches nothing), namespaced tags work
 * (`glib\:signal` -> 352), namespaced attributes work (`[glib\:type-name]` ->
 * 445). No new dependency, and a tier-1 package gets dogfooded against a real
 * 6 MB document.
 *
 * ONE FROZEN WART TO KNOW ABOUT: in XML mode `tagName` is LOWERCASED and
 * `nodeName` UPPERCASED, both wrong by the XML spec and both deliberately frozen
 * (ADR 0026 § Decision 4) because a measured consumer switches on lowercase tag
 * literals at 24 sites. Harmless here — every GIR tag is lowercase already — but
 * a generator for a mixed-case dialect could not use this reader as-is.
 */

import { DOMParser } from '@gjsify/domparser';

/**
 * A GIR type reference, with the array flag kept SEPARATE.
 *
 * Not a nicety: `<property name="css-classes"><array><type name="utf8"/></array>`
 * is `string[]`, and a reader that asked for a descendant `<type>` would answer
 * `string` — for a property authored as `cssClasses={['card']}` on every second
 * widget. `querySelector` searches descendants, so the array case has to be
 * checked FIRST, on own children only.
 */
export interface GirType {
    /** Qualified where GIR wrote a reference (`Gtk.Orientation`), bare for a C scalar (`gboolean`). */
    readonly name: string;
    readonly array: boolean;
}

export interface GirProperty {
    readonly name: string;
    readonly writable: boolean;
    readonly readable: boolean;
    readonly constructOnly: boolean;
    readonly type: GirType;
    /** GIR carries it, the typelib does not — `GTK_ORIENTATION_HORIZONTAL`. */
    readonly defaultValue?: string;
    readonly deprecated: boolean;
    /** GIR's `version` attribute — the release that introduced this member. */
    readonly since?: string;
    readonly doc?: string;
}

/**
 * The GObject nick a GIR enum member would get if GIR did not say.
 *
 * GIR writes `baseline_fill`; the nick GObject registered is `baseline-fill`. This
 * is the FALLBACK for a `<member>` with no `glib:nick` — the attribute itself is
 * the answer wherever it exists, because the substitution is right for Gtk and Adw
 * by luck and not by construction: across every GIR in this workspace 40,940
 * members carry the attribute and 97 disagree with it.
 */
export const nickOf = (member: string): string => member.replace(/_/g, '-');

export interface GirParam {
    readonly name: string;
    readonly type: GirType;
    /** GIR's `direction`, which defaults to `in` when the attribute is absent. */
    readonly direction: 'in' | 'out' | 'inout';
    /**
     * GIR's `caller-allocates`. It decides whether a non-`in` slot holds anything
     * at all — see `renderParam` in `surface.mts`, which is the only reader.
     */
    readonly callerAllocates: boolean;
}

export interface GirSignal {
    readonly name: string;
    /**
     * WITHOUT the emitting object. GIR lists a signal's `<parameters>` free of the
     * instance (unlike a `<method>`), and the host strips the instance too —
     * `next(...args.slice(1))` in `signals.ts`. The two line up exactly, which is
     * why a generated handler signature can be taken from here verbatim.
     */
    readonly params: readonly GirParam[];
    readonly deprecated: boolean;
    /** GIR's `version` attribute — the release that introduced this signal. */
    readonly since?: string;
    readonly doc?: string;
}

export interface GirClass {
    /** The GType name — `GtkBox`. Absent for a class GIR declares without one. */
    readonly gtype: string;
    /** GIR-local name — `Box`. */
    readonly name: string;
    readonly namespace: string;
    readonly kind: 'class' | 'interface';
    readonly abstract: boolean;
    /** Namespace-qualified parent — `Gtk.Widget` — or null at the root. */
    readonly parent: string | null;
    /** Qualified interfaces (`<implements>`), or an interface's `<prerequisite>`s. */
    readonly implements: readonly string[];
    readonly methods: readonly string[];
    readonly signals: readonly GirSignal[];
    readonly properties: readonly GirProperty[];
    readonly doc?: string;
}

export interface GirEnum {
    readonly gtype: string;
    /** Namespace-qualified — `Gtk.Orientation`. */
    readonly qualified: string;
    readonly flags: boolean;
    /** The NICKS, which is what a string-accepting surface needs. */
    readonly members: readonly string[];
}

export interface GirNamespace {
    readonly name: string;
    readonly version: string;
    /** Classes AND interfaces, in one list: `implements` resolves against the same index. */
    readonly classes: readonly GirClass[];
    readonly enums: readonly GirEnum[];
    /** Every other named type GIR declares — records, unions, callbacks, aliases. */
    readonly otherTypes: readonly string[];
}

interface El {
    getAttribute(name: string): string | null;
    querySelectorAll(selector: string): ArrayLike<El>;
    querySelector(selector: string): El | null;
    readonly children: ArrayLike<El>;
    readonly tagName: string;
    readonly textContent: string | null;
}

/** Direct children only — a `<class>` must not inherit its nested types' members. */
const ownChildren = (el: El, tagName: string): El[] => {
    const out: El[] = [];
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
        const kid = kids[i] as El;
        if (kid.tagName === tagName) out.push(kid);
    }
    return out;
};

const firstChildEl = (el: El, tagName: string): El | null => ownChildren(el, tagName)[0] ?? null;

const firstDoc = (el: El): string | undefined => {
    for (const doc of ownChildren(el, 'doc')) {
        const text = doc.textContent?.trim();
        if (text) return text;
    }
    return undefined;
};

/** GIR writes a same-namespace reference bare, and a foreign one qualified. */
const qualify = (namespace: string, reference: string): string =>
    reference.includes('.') ? reference : `${namespace}.${reference}`;

/** A GIR type name is a REFERENCE when it is dotted or capitalised; `gboolean` is not. */
const isReference = (name: string): boolean => name !== '' && /^[A-Z]|\./.test(name);

const UNKNOWN_TYPE: GirType = { name: '', array: false };

function readType(namespace: string, owner: El): GirType {
    const array = firstChildEl(owner, 'array');
    if (array) {
        const inner = firstChildEl(array, 'type');
        const name = inner?.getAttribute('name') ?? '';
        // A nested array (`char***`) has no honest one-line spelling here, and no
        // GTK property is one. Reported as unknown rather than flattened.
        if (!inner || firstChildEl(array, 'array')) return UNKNOWN_TYPE;
        return { name: isReference(name) ? qualify(namespace, name) : name, array: true };
    }
    const type = firstChildEl(owner, 'type');
    if (!type) return UNKNOWN_TYPE;
    const name = type.getAttribute('name') ?? '';
    return { name: isReference(name) ? qualify(namespace, name) : name, array: false };
}

function readProperty(namespace: string, el: El): GirProperty {
    return {
        name: el.getAttribute('name') ?? '',
        // CONSTRUCT_ONLY implies WRITABLE in GObject and GIR spells both out, so
        // `writable` alone is the settable set — a construct-only property is
        // settable, just at construction, which is exactly why the host defers
        // materialisation (ADR 0027 § Decision 5).
        writable: el.getAttribute('writable') === '1',
        readable: el.getAttribute('readable') !== '0',
        constructOnly: el.getAttribute('construct-only') === '1',
        type: readType(namespace, el),
        defaultValue: el.getAttribute('default-value') ?? undefined,
        deprecated: el.getAttribute('deprecated') === '1',
        since: el.getAttribute('version') ?? undefined,
        doc: firstDoc(el),
    };
}

function readDirection(el: El): 'in' | 'out' | 'inout' {
    const raw = el.getAttribute('direction');
    return raw === 'out' || raw === 'inout' ? raw : 'in';
}

function readSignal(namespace: string, el: El): GirSignal {
    const params = firstChildEl(el, 'parameters');
    return {
        name: el.getAttribute('name') ?? '',
        params: params
            ? ownChildren(params, 'parameter').map((p) => ({
                  name: p.getAttribute('name') ?? '',
                  type: readType(namespace, p),
                  direction: readDirection(p),
                  callerAllocates: p.getAttribute('caller-allocates') === '1',
              }))
            : [],
        deprecated: el.getAttribute('deprecated') === '1',
        since: el.getAttribute('version') ?? undefined,
        doc: firstDoc(el),
    };
}

function readDeclaration(namespace: string, el: El, kind: 'class' | 'interface'): GirClass | null {
    const gtype = el.getAttribute('glib:type-name');
    const name = el.getAttribute('name');
    // No GType name means GIR is describing something that is not a GObject
    // class we could ever instantiate by tag. Skipped, not guessed at.
    if (!gtype || !name) return null;
    const parent = kind === 'class' ? el.getAttribute('parent') : null;
    const related = kind === 'class' ? 'implements' : 'prerequisite';
    return {
        gtype,
        name,
        namespace,
        kind,
        // An interface can never be instantiated, and saying so here is what keeps
        // the concrete-widget filter from having to know the difference.
        abstract: kind === 'interface' || el.getAttribute('abstract') === '1',
        parent: parent ? qualify(namespace, parent) : null,
        implements: ownChildren(el, related)
            .map((i) => i.getAttribute('name') ?? '')
            .filter((n) => n !== '')
            .map((n) => qualify(namespace, n)),
        methods: ownChildren(el, 'method').map((m) => m.getAttribute('name') ?? ''),
        signals: ownChildren(el, 'glib:signal').map((s) => readSignal(namespace, s)),
        properties: ownChildren(el, 'property').map((p) => readProperty(namespace, p)),
        doc: firstDoc(el),
    };
}

/** Every named type GIR declares that is neither class, interface nor enum. */
const OTHER_TYPE_TAGS = ['record', 'union', 'callback', 'alias'] as const;

export function readNamespace(xml: string): GirNamespace {
    const doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as El;
    const ns = doc.querySelector('namespace');
    if (!ns) throw new Error('no <namespace> element — is this a GIR file?');
    const name = ns.getAttribute('name');
    if (!name) throw new Error('<namespace> has no name attribute');
    const version = ns.getAttribute('version') ?? '';

    const classes: GirClass[] = [];
    for (const [tag, kind] of [
        ['class', 'class'],
        ['interface', 'interface'],
    ] as const) {
        for (const el of ownChildren(ns, tag)) {
            const read = readDeclaration(name, el, kind);
            if (read) classes.push(read);
        }
    }

    const enums: GirEnum[] = [];
    for (const tag of ['enumeration', 'bitfield']) {
        for (const el of ownChildren(ns, tag)) {
            const gtype = el.getAttribute('glib:type-name');
            const local = el.getAttribute('name');
            if (!gtype || !local) continue;
            enums.push({
                gtype,
                qualified: `${name}.${local}`,
                flags: tag === 'bitfield',
                // `glib:nick` is the nick GObject actually registered. The old
                // reader derived it from `name` with one underscore substitution,
                // which is right for Gtk and Adw — measured, all 919 agree — and is
                // right by LUCK: across every GIR in this workspace 40,940 members
                // carry the attribute and 97 of them disagree with the derivation.
                // A surface built on the guess would type a nick GTK refuses, and
                // GObject drops a wrong nick silently.
                members: ownChildren(el, 'member').map(
                    (m) => m.getAttribute('glib:nick') ?? nickOf(m.getAttribute('name') ?? ''),
                ),
            });
        }
    }

    const otherTypes: string[] = [];
    for (const tag of OTHER_TYPE_TAGS) {
        for (const el of ownChildren(ns, tag)) {
            const local = el.getAttribute('name');
            if (local) otherTypes.push(`${name}.${local}`);
        }
    }

    return { name, version, classes, enums, otherTypes };
}

/** Every class and interface across the namespaces read, keyed the way GIR references them. */
export function indexClasses(namespaces: readonly GirNamespace[]): Map<string, GirClass> {
    const byQualified = new Map<string, GirClass>();
    for (const ns of namespaces) {
        for (const cls of ns.classes) byQualified.set(`${ns.name}.${cls.name}`, cls);
    }
    return byQualified;
}

/**
 * Walk to the root, or as far as the loaded namespaces reach.
 *
 * A chain that leaves the loaded set is not an error: `Gtk.Widget`'s own parent
 * is `GObject.InitiallyUnowned`, and loading GObject-2.0 to learn that would buy
 * nothing. What matters is whether `Gtk.Widget` is ON the chain.
 */
export function ancestors(cls: GirClass, index: Map<string, GirClass>): GirClass[] {
    const out: GirClass[] = [];
    const seen = new Set<string>();
    let parent = cls.parent;
    while (parent) {
        if (seen.has(parent)) break; // a cycle in generated input is not worth hanging over
        seen.add(parent);
        const next = index.get(parent);
        if (!next) break;
        out.push(next);
        parent = next.parent;
    }
    return out;
}

/**
 * Every declaration a class's members can come from — self, ancestors, interfaces.
 *
 * The interfaces are not optional and the measurement says why: `GtkBox` declares
 * four properties of its own and `orientation` is NOT among them. It lives on
 * `Gtk.Orientable`, an `<implements>` of `GtkBox`, because GObject installs
 * interface properties on the implementor at runtime while GIR keeps them once,
 * on the interface. A class-only reader therefore emits a surface in which
 * `<gtk-box orientation="vertical">` — the most-written GtkBox attribute there is
 * — is a type error.
 *
 * Order is self, then the parent chain, then interfaces of each, so a nearer
 * declaration of the same property name wins.
 */
export function declarations(cls: GirClass, index: Map<string, GirClass>): GirClass[] {
    const out: GirClass[] = [];
    const seen = new Set<string>();
    const push = (c: GirClass): void => {
        const key = `${c.namespace}.${c.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(c);
    };
    push(cls);
    for (const a of ancestors(cls, index)) push(a);
    // Breadth-first over the interfaces of everything collected so far, including
    // interfaces reached through another interface's `<prerequisite>`.
    for (let i = 0; i < out.length; i++) {
        for (const name of (out[i] as GirClass).implements) {
            const iface = index.get(name);
            if (iface) push(iface);
        }
    }
    return out;
}

/**
 * Concrete descendants of a root class — the set a renderer can actually create.
 *
 * The root is a PARAMETER so a fixture can exercise this with a five-class GIR of
 * its own. Hard-coding `GtkWidget` would leave the walk, the abstract filter and
 * the namespace-crossing parent chain testable only against the real 6.2 MB file,
 * where an off-by-one is invisible.
 */
export function concreteWidgets(namespaces: readonly GirNamespace[], root = 'GtkWidget'): GirClass[] {
    const index = indexClasses(namespaces);
    const out: GirClass[] = [];
    for (const ns of namespaces) {
        for (const cls of ns.classes) {
            if (cls.abstract) continue;
            if (ancestors(cls, index).some((a) => a.gtype === root)) out.push(cls);
        }
    }
    return out;
}
