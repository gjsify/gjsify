/**
 * Read the widget vocabulary from `@girs/<ns>/vocabulary` and build the emitter's model.
 *
 * WHY THIS REPLACED A GIR READER. This package used to parse the `.gir` XML itself, which
 * made it the SECOND reader of a format ts-for-gir already reads — and two readers of one
 * format are two truths that drift apart silently. ADR 0029 moved the vocabulary into
 * `@girs/*` so there is one. What stays here is the DIALECT: kebab tags, the camelCase
 * second spelling, `on<Signal>` prop names, Vue's Volar aliases. None of that is in the
 * vocabulary and none of it belongs there, as its own header says.
 *
 * WHY IT READS BOTH HALVES. The runtime `.js` carries the facts as values (`OWN_PROPS`,
 * `DECLS`, `OWN_SIGNALS`, `ENUM_NICKS`), which is what a check can compare against a live
 * typelib. The `.d.ts` carries the rendered TypeScript for each property, which no amount
 * of runtime data can reconstruct: `GtkBaselinePositionNick | Gtk.BaselinePosition`
 * depends on that file's own imports. So the types come from the declarations and the
 * facts come from the values, and neither is re-derived from the other.
 *
 * The `.d.ts` half is READ in `vocabulary-dts.mts`, which touches no file and so
 * imports no `gi://` — that is what lets `generator.spec.ts` pin its regexes against
 * literal fixtures instead of against whichever `@girs` happens to be installed.
 */

import GLib from 'gi://GLib?version=2.0';

import type { Declaration, PropMember, SignalMember, SurfaceModel } from './model.mjs';
// The SAME two transforms `generated.spec.ts` runs against the host's inverse. A
// second copy here would leave that round-trip check measuring a rule the artefact
// was not built with; measured over the 166 signals and 953 property names of the two
// vocabularies, the copies agreed — which is exactly how such a divergence stays
// invisible until a name with a digit or an underscore arrives.
import { camelOf, eventPropOf } from './names.mjs';
import { type DeclaredInterface, readDeclaredInterfaces, readNamespaceImports } from './vocabulary-dts.mjs';

/** The three fields `emit-types.mts` reads off a widget. Not a GIR class any more. */
export interface WidgetRef {
    readonly gtype: string;
    readonly namespace: string;
    readonly name: string;
}

interface VocabularyModule {
    readonly OWN_PROPS: Record<string, readonly string[]>;
    readonly OWN_SIGNALS: Record<string, readonly string[]>;
    readonly DECLS: Record<string, readonly string[]>;
    readonly ENUM_NICKS: Record<string, readonly string[]>;
    readonly CHILD_HOLDERS: readonly string[];
    readonly SINCE: Record<string, string>;
    readonly PROVENANCE: {
        readonly namespace: string;
        readonly version: string;
        readonly libraryVersion: string | null;
    };
}

function read(path: string): string {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

/** `GtkBox` -> `Gtk`, `Box`. The vocabulary keys are GTypes, which carry both. */
function splitGType(gtype: string, namespaces: readonly string[]): WidgetRef {
    for (const ns of namespaces) {
        if (gtype.startsWith(ns) && gtype.length > ns.length) {
            return { gtype, namespace: ns, name: gtype.slice(ns.length) };
        }
    }
    throw new Error(`cannot split GType ${gtype} across ${namespaces.join(', ')}`);
}

/** Every member a declaration renders, by the key it is emitted under. */
function ownMembers(declaration: Declaration): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of declaration.props) {
        out.set(p.camel, p.ts);
        if (p.kebab !== p.camel) out.set(p.kebab, p.ts);
    }
    // Signals too: a signal's rendered type names the DECLARING class, so the same
    // signal owned at two points of one chain renders two different types. The
    // `onNotify…` handlers are excluded on purpose — their shape never varies, so they
    // cannot conflict (`emit-types.mts` says the same where it emits them).
    for (const sig of declaration.signals) out.set(sig.prop, sig.ts);
    return out;
}

/**
 * Bases that have to be emitted as `Omit<Base, 'x'>`, per declaration.
 *
 * TypeScript refuses an interface whose own member is not ASSIGNABLE to the one it
 * inherits (TS2430), and a local redeclaration does not repair it — it turns one error
 * into another. So the base has to lose the key.
 *
 * `model.mts` said this map "now arrives empty" because the published vocabulary
 * resolves such conflicts upstream, and kept the machinery for the day one came back.
 * It came back with `@girs` 4.5.0: `AdwPreferencesPage:name` is GIR-nullable while
 * `GtkWidget:name` is not, so `string | null` met `string` and the whole generated
 * surface stopped compiling — nine problems out of `check-type-surfaces`, from one
 * property. Computing the set is the only form of this that cannot be overtaken by the
 * next release: an allowlist would have to be edited by whoever hits the next one.
 */
function computeOmissions(declarations: ReadonlyMap<string, Declaration>): Map<string, Map<string, readonly string[]>> {
    // Transitive members, memoised — a conflict can arrive from a grandparent, and the
    // emitted `extends` clause lists the whole chain flat.
    const cache = new Map<string, Map<string, string>>();
    const effective = (key: string): Map<string, string> => {
        const cached = cache.get(key);
        if (cached) return cached;
        const declaration = declarations.get(key);
        const out = new Map<string, string>();
        cache.set(key, out);
        if (!declaration) return out;
        for (const base of declaration.bases) for (const [k, v] of effective(base)) out.set(k, v);
        for (const [k, v] of ownMembers(declaration)) out.set(k, v);
        return out;
    };

    const omissions = new Map<string, Map<string, readonly string[]>>();
    for (const [key, declaration] of declarations) {
        const own = ownMembers(declaration);
        for (const base of declaration.bases) {
            const inherited = effective(base);
            const drop = [...own].filter(([k, v]) => inherited.has(k) && inherited.get(k) !== v).map(([k]) => k);
            if (drop.length === 0) continue;
            const perBase = omissions.get(key) ?? new Map<string, readonly string[]>();
            perBase.set(base, drop.sort());
            omissions.set(key, perBase);
        }
    }
    return omissions;
}

export interface VocabularySource {
    /** Import name, e.g. `gtk-4.0`. */
    readonly pkg: string;
    /** GType prefix, e.g. `Gtk`. */
    readonly prefix: string;
}

/**
 * Load the vocabulary packages and build the model the emitters already consume.
 *
 * `dir` is the `node_modules/@girs` root; the caller resolves it, because a generator
 * should not guess where its own dependencies live.
 */
export async function buildFromVocabulary(
    dir: string,
    sources: readonly VocabularySource[],
): Promise<{ model: SurfaceModel; widgets: WidgetRef[]; provenance: string }> {
    const prefixes = sources.map((s) => s.prefix);
    const declarations = new Map<string, Declaration>();
    const closure = new Map<string, readonly string[]>();
    const enumNicks = new Map<string, readonly string[]>();
    const namespacesUsed = new Set<string>();
    const widgets: WidgetRef[] = [];
    const allRendered = new Map<string, DeclaredInterface>();
    const missing: string[] = [];
    const referenced = new Set<string>();
    const provenance: string[] = [];
    const importable = new Map<string, string>();
    const allSince = new Map<string, string>();

    // `file://` needs an absolute path: GJS answers a relative one with
    // "Unable to load file async", which reads like a missing file rather than a
    // malformed URL. Resolved once, against the process's cwd, so a caller may pass
    // either form.
    const root = GLib.canonicalize_filename(dir, null);

    for (const source of sources) {
        const base = `${root}/${source.pkg}/${source.pkg}-vocabulary`;
        const runtime = (await import(`file://${base}.js`)) as VocabularyModule;
        const dts = read(`${base}.d.ts`);
        const declared = readDeclaredInterfaces(dts);
        for (const [ns, pkg] of readNamespaceImports(dts, source.pkg)) importable.set(ns, pkg);
        for (const [gtype, iface] of declared) allRendered.set(gtype, iface);
        for (const [key, version] of Object.entries(runtime.SINCE)) allSince.set(key, version);

        // Provenance comes from the vocabulary itself, not from the package names the
        // caller passed: the namespace spelling is authoritative there, and it carries
        // the library version the types were generated against — which the GIR route
        // never knew.
        const p = runtime.PROVENANCE;
        provenance.push(
            p.libraryVersion ? `${p.namespace}-${p.version}/${p.libraryVersion}` : `${p.namespace}-${p.version}`,
        );

        for (const [gtype, nicks] of Object.entries(runtime.ENUM_NICKS)) enumNicks.set(gtype, nicks);
        namespacesUsed.add(source.prefix);

        for (const [gtype, chain] of Object.entries(runtime.DECLS)) {
            closure.set(gtype, chain);
            for (const link of chain) referenced.add(link);
            const ref = splitGType(gtype, prefixes);
            widgets.push(ref);
        }

        // Every GType the surface names owes a declaration, not only the ones carrying
        // properties of their own. GtkSeparator and AdwSpinner declare none, and an
        // `extends` clause pointing at an interface that was never emitted does not
        // compile. Building this from OWN_PROPS alone left twelve such clauses.
        const owned = new Set([...Object.keys(runtime.DECLS), ...Object.keys(runtime.OWN_PROPS)]);
        for (const gtype of owned) {
            const names = runtime.OWN_PROPS[gtype] ?? [];
            const rendered = declared.get(gtype);
            const props: PropMember[] = names.flatMap((kebab) => {
                const d = rendered?.props.get(kebab);
                if (!d) {
                    missing.push(`${gtype}.${kebab}`);
                    return [];
                }
                return [
                    {
                        kebab,
                        camel: camelOf(kebab),
                        ts: d.ts,
                        doc: d.doc,
                        deprecated: d.deprecated,
                        since: d.since ?? runtime.SINCE[`${gtype}.${kebab}`],
                    },
                ];
            });
            const ref = splitGType(gtype, prefixes);
            const signals: SignalMember[] = (runtime.OWN_SIGNALS[gtype] ?? []).map((signal) => ({
                signal,
                prop: eventPropOf(signal),
                ts: `${ref.namespace}.${ref.name}.SignalSignatures['${signal}']`,
                deprecated: false,
                since: runtime.SINCE[`${gtype}::${signal}`],
            }));
            // `DECLS[gtype]` is the chain self-first, so the bases are the tail. The
            // emitter renders `extends` from it; without it every interface would be flat
            // and `GtkBox` would redeclare all 40 of `GtkWidget`'s properties.
            const chain = runtime.DECLS[gtype] ?? [gtype];
            const bases = chain
                .slice(1)
                .filter((base) => base !== gtype)
                .map((base) => {
                    const b = splitGType(base, prefixes);
                    return `${b.namespace}.${b.name}`;
                });
            declarations.set(`${ref.namespace}.${ref.name}`, {
                key: `${ref.namespace}.${ref.name}`,
                gtype,
                // Keyed bare, beside `X.prop` and `X::signal` — the vocabulary states a
                // version for the type itself since ts-for-gir#457.
                since: runtime.SINCE[gtype],
                kind: 'class',
                iface: `${gtype}Props`,
                bases,
                props,
                signals,
                doc: rendered?.doc,
            });
        }
    }

    // Report every mismatch together. The first one on its own never distinguishes
    // "one class was missed" from "a whole shape of declaration is unparsed", and that
    // is the only question worth asking here.
    if (missing.length > 0) {
        const shown = missing.slice(0, 15).join(', ');
        const rest = missing.length > 15 ? `, and ${missing.length - 15} more` : '';
        throw new Error(`${missing.length} of the OWN_PROPS entries have no rendered declaration: ${shown}${rest}`);
    }

    // Chain links no vocabulary owns — the pure interfaces GtkBuildable and
    // GtkConstraintTarget — are still named in `extends`. They hold no properties, so
    // the empty interface is the whole point: it makes the clause resolve.
    for (const gtype of referenced) {
        const ref = splitGType(gtype, prefixes);
        const key = `${ref.namespace}.${ref.name}`;
        if (declarations.has(key)) continue;
        declarations.set(key, {
            key,
            gtype,
            kind: 'class',
            iface: `${gtype}Props`,
            // A chain link carries its own version too. These are the pure interfaces,
            // and three of them state one — GtkAccessibleText, GtkAccessibleRange,
            // GtkAccessibleHypertext. Dropping it here is invisible until a host
            // predates one of them, which is the case this data exists for.
            since: allSince.get(gtype),
            bases: [],
            props: [...(allRendered.get(gtype)?.props.entries() ?? [])].map(([kebab, d]) => ({
                kebab,
                camel: camelOf(kebab),
                ts: d.ts,
                doc: d.doc,
                deprecated: d.deprecated,
                since: d.since,
            })),
            signals: [],
            doc: allRendered.get(gtype)?.doc,
        });
    }

    // Import only what the rendered types actually name. The vocabulary imports more
    // than any one surface uses, and an unused import is a lint failure.
    const packages: Record<string, string> = Object.fromEntries(sources.map((s) => [s.prefix, `@girs/${s.pkg}`]));
    for (const declaration of declarations.values()) {
        for (const member of [...declaration.props, ...declaration.signals]) {
            for (const m of member.ts.matchAll(/\b([A-Z][A-Za-z0-9]*)\./g)) {
                const ns = m[1]!;
                const pkg = importable.get(ns);
                if (!pkg || namespacesUsed.has(ns)) continue;
                namespacesUsed.add(ns);
                packages[ns] = pkg;
            }
        }
    }

    widgets.sort((a, b) => (a.gtype < b.gtype ? -1 : 1));

    return {
        model: {
            widgets: widgets as never,
            declarations,
            closure,
            enumNicks,
            namespacesUsed,
            packages,
            omissions: computeOmissions(declarations),
        },
        widgets,
        provenance: provenance.join(' '),
    };
}
