/**
 * Build the declaration graph the type surfaces are emitted from.
 *
 * ONE INTERFACE PER GIR DECLARATION, carrying its OWN members and extending its
 * bases — not one flat interface per widget. The measurement decides it: the 164
 * concrete widgets have 6768 writable property slots between them and only 561
 * distinct property names. Flattening would emit the same `visible?: boolean`
 * 164 times; mirroring GIR's own inheritance emits it once, on `GtkWidgetProps`,
 * and the diff of a GTK update then shows what actually changed.
 *
 * THE CONFLICT MACHINERY IS NOT DEFENSIVE. TypeScript requires a multiply
 * inherited member to be IDENTICAL in every base — `string` and `string | null`
 * are not — and GTK's interfaces do redeclare class properties. So a base that
 * loses a member is emitted as `Omit<Base, 'name'>`, because a local redeclaration
 * does NOT repair incompatible bases (it turns one error into another).
 */

import { declarations, indexClasses, type GirClass, type GirNamespace } from './gir.mjs';
import { camelOf, eventPropOf, tsTypeOf, TypeMapError, type Universe } from './tsmap.mjs';

export interface PropMember {
    readonly kebab: string;
    readonly camel: string;
    readonly ts: string;
    readonly doc?: string;
    readonly deprecated: boolean;
    readonly since?: string;
}

export interface SignalMember {
    readonly signal: string;
    readonly prop: string;
    /** Already rendered — `(row: Gtk.ListBoxRow) => void`. */
    readonly ts: string;
    readonly doc?: string;
    readonly deprecated: boolean;
    readonly since?: string;
}

export interface Declaration {
    /** GIR-qualified — `Gtk.Box`. The graph is keyed on this, the way GIR references. */
    readonly key: string;
    readonly gtype: string;
    readonly kind: 'class' | 'interface';
    /** `GtkBoxProps`. */
    readonly iface: string;
    readonly bases: readonly string[];
    readonly props: readonly PropMember[];
    readonly signals: readonly SignalMember[];
    readonly doc?: string;
}

export interface SurfaceModel {
    /** The 164, sorted by GType name. */
    readonly widgets: readonly GirClass[];
    readonly declarations: ReadonlyMap<string, Declaration>;
    /** Widget GType -> the GTypes of every declaration its members come from, self first. */
    readonly closure: ReadonlyMap<string, readonly string[]>;
    /** Enum GType -> nicks, for the emitted aliases and for the runtime nick check. */
    readonly enumNicks: ReadonlyMap<string, readonly string[]>;
    readonly namespacesUsed: ReadonlySet<string>;
    /** Copied from the universe, so the emitter needs no second source for it. */
    readonly packages: Readonly<Record<string, string>>;
    /** Base -> members it must not contribute, because a nearer declaration disagrees. */
    readonly omissions: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

const propsIfaceOf = (gtype: string): string => `${gtype}Props`;

/** First sentence, one line, `*​/`-safe — a hover blurb, not the manual. */
function blurb(doc: string | undefined, limit = 200): string | undefined {
    if (!doc) return undefined;
    const flat = doc.replace(/\s+/g, ' ').trim();
    if (flat === '') return undefined;
    const stop = flat.search(/\.\s|\.$/);
    const text = stop > 0 ? flat.slice(0, stop + 1) : flat;
    const cut = text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    return cut.replace(/\*\//g, '*​/');
}

export function buildSurface(
    widgets: readonly GirClass[],
    namespaces: readonly GirNamespace[],
    universe: Universe,
): SurfaceModel {
    const index = indexClasses(namespaces);
    const sorted = [...widgets].sort((a, b) => (a.gtype < b.gtype ? -1 : a.gtype > b.gtype ? 1 : 0));

    // Every declaration any widget's members can come from, and the per-widget
    // chain — both from the ONE walk in gir.mts, so the surface and the runtime
    // cross-check can never disagree about what a widget inherits.
    const needed = new Map<string, GirClass>();
    const closure = new Map<string, string[]>();
    for (const w of sorted) {
        const chain = declarations(w, index);
        closure.set(
            w.gtype,
            chain.map((c) => c.gtype),
        );
        for (const c of chain) needed.set(`${c.namespace}.${c.name}`, c);
    }

    const namespacesUsed = new Set<string>();
    const enumNicks = new Map<string, readonly string[]>();
    const declarationsOut = new Map<string, Declaration>();

    for (const [key, cls] of needed) {
        const props: PropMember[] = [];
        for (const p of cls.properties) {
            if (!p.writable) continue;
            let mapped: ReturnType<typeof tsTypeOf>;
            try {
                mapped = tsTypeOf(p.type, universe, 'prop');
            } catch (error) {
                throw new TypeMapError(`${key}.${p.name}: ${(error as Error).message}`);
            }
            for (const ns of mapped.namespaces) namespacesUsed.add(ns);
            for (const gtype of mapped.enums) {
                const found = universe.enums.get(p.type.name);
                if (found)
                    enumNicks.set(
                        gtype,
                        found.members.map((m) => m.replace(/_/g, '-')),
                    );
            }
            props.push({
                kebab: p.name,
                camel: camelOf(p.name),
                ts: mapped.text,
                doc: blurb(p.doc),
                deprecated: p.deprecated,
                since: p.since,
            });
        }

        const signals: SignalMember[] = [];
        for (const s of cls.signals) {
            const rendered: string[] = [];
            for (const [i, param] of s.params.entries()) {
                // A non-`in` slot the CALLEE allocates carries nothing on the way in.
                // Measured on gjs 1.88.1 / GTK 4.22.4: `Gtk.SpinButton::input` hands its
                // `new_value` as 6.95e-310 — uninitialised memory, arriving as a
                // perfectly ordinary `number`. Typing it `number` is an invitation to
                // read it, and the reader gets no warning of any kind.
                //
                // `caller-allocates="1"` is the opposite case and is NOT rewritten:
                // `Gtk.Overlay::get-child-position` hands a real `Gdk.Rectangle` for the
                // handler to FILL, and the whole point of the signal is writing to it.
                if (param.direction !== 'in' && !param.callerAllocates) {
                    rendered.push(`${safeParamName(param.name, i)}: OutParam`);
                    continue;
                }
                let mapped: ReturnType<typeof tsTypeOf>;
                try {
                    mapped = tsTypeOf(param.type, universe, 'param');
                } catch (error) {
                    throw new TypeMapError(`${key}::${s.name} param ${i}: ${(error as Error).message}`);
                }
                for (const ns of mapped.namespaces) namespacesUsed.add(ns);
                rendered.push(`${safeParamName(param.name, i)}: ${mapped.text}`);
            }
            signals.push({
                signal: s.name,
                prop: eventPropOf(s.name),
                ts: `(${rendered.join(', ')}) => void`,
                doc: blurb(s.doc),
                deprecated: s.deprecated,
                since: s.since,
            });
        }

        const bases: string[] = [];
        if (cls.parent && needed.has(cls.parent)) bases.push(cls.parent);
        for (const i of cls.implements) if (needed.has(i)) bases.push(i);

        declarationsOut.set(key, {
            key,
            gtype: cls.gtype,
            kind: cls.kind,
            iface: propsIfaceOf(cls.gtype),
            bases,
            props,
            signals,
            doc: blurb(cls.doc),
        });
    }

    return {
        widgets: sorted,
        declarations: declarationsOut,
        closure,
        enumNicks,
        namespacesUsed,
        packages: universe.packages,
        omissions: computeOmissions(declarationsOut),
    };
}

/** A GIR parameter can be unnamed or named something TypeScript will not take. */
const safeParamName = (name: string, i: number): string =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && name !== 'function' ? name : `arg${i}`;

interface MemberMap {
    /** Member name -> its rendered TS type, nearest declaration first. */
    readonly members: Map<string, string>;
}

/**
 * Which member each base must be stripped of.
 *
 * `Omit`, not a local redeclaration: TypeScript reports a member that differs
 * across two bases whether or not the deriving interface declares it too, so the
 * only repair is to stop one base from contributing it.
 */
function computeOmissions(decls: ReadonlyMap<string, Declaration>): Map<string, Map<string, string[]>> {
    const full = new Map<string, MemberMap>();
    const resolving = new Set<string>();

    const membersOf = (key: string): MemberMap => {
        const cached = full.get(key);
        if (cached) return cached;
        const decl = decls.get(key);
        if (!decl || resolving.has(key)) return { members: new Map() };
        resolving.add(key);
        const members = new Map<string, string>();
        // Own first, so a nearer declaration wins; then bases in order.
        for (const p of decl.props) {
            members.set(p.kebab, p.ts);
            members.set(p.camel, p.ts);
        }
        for (const s of decl.signals) members.set(s.prop, s.ts);
        for (const base of decl.bases) {
            for (const [name, ts] of membersOf(base).members) if (!members.has(name)) members.set(name, ts);
        }
        resolving.delete(key);
        const value = { members };
        full.set(key, value);
        return value;
    };

    const omissions = new Map<string, Map<string, string[]>>();
    for (const [key, decl] of decls) {
        const own = new Map<string, string>();
        for (const p of decl.props) {
            own.set(p.kebab, p.ts);
            own.set(p.camel, p.ts);
        }
        for (const s of decl.signals) own.set(s.prop, s.ts);

        const claimed = new Map(own);
        const perBase = new Map<string, string[]>();
        for (const base of decl.bases) {
            const drop: string[] = [];
            for (const [name, ts] of membersOf(base).members) {
                const holder = claimed.get(name);
                if (holder === undefined) claimed.set(name, ts);
                else if (holder !== ts) drop.push(name);
            }
            if (drop.length > 0) perBase.set(base, drop.sort());
        }
        if (perBase.size > 0) omissions.set(key, perBase);
    }
    return omissions;
}
