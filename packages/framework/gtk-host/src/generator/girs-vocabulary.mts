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

import GIRepository from 'gi://GIRepository?version=3.0';
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

/**
 * `GtkBox` -> `Gtk`, `Box`. The vocabulary keys are GTypes, which carry both — but only
 * for a GType whose prefix IS its namespace, which is every `Gtk`/`Adw` one and none of
 * the foreign ones. `GApplication` is `Gio.Application`, and the `G` it starts with is
 * shared by Gio, GLib and GObject, so no split of the STRING can tell them apart.
 *
 * The typelib is asked first because it indexes by GType name and simply knows; the
 * prefix walk is the fallback for a GType the installed libraries do not carry. See the
 * long note in `buildFromVocabulary` for the measurement and for what the `G` that used
 * to be on the prefix list emitted.
 */
function splitGType(gtype: string, namespaces: readonly string[], byGType: ReadonlyMap<string, WidgetRef>): WidgetRef {
    const known = byGType.get(gtype);
    if (known) return known;
    for (const ns of namespaces) {
        if (gtype.startsWith(ns) && gtype.length > ns.length) {
            return { gtype, namespace: ns, name: gtype.slice(ns.length) };
        }
    }
    throw new Error(`cannot split GType ${gtype} across ${namespaces.join(', ')} and no loaded typelib declares it`);
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
    // A BASE can leave the namespaces we load. `GtkApplication` extends `GApplication`
    // and `GtkMountOperation` extends `GMountOperation` — both Gio, both reached only as
    // ancestors, neither a DECLS key of its own. @girs 5.2.0 is the first vocabulary to
    // carry those two classes at all (ts-for-gir #474 widened DECLS past the widgets), so
    // before it every GType here started with `Gtk` or `Adw` and nothing had to answer
    // for the rest.
    //
    // A GTYPE PREFIX IS NOT A TYPESCRIPT NAMESPACE, and adding `G` to this list to make
    // the split succeed is what made it look like one. Gio, GLib and GObject all spell
    // their GType prefix `G`, so `GApplication` split to namespace `G` — which is not a
    // name `emitProps` can import, and `emitProps` SKIPS a namespace it cannot import
    // rather than failing. The artefact went out carrying thirteen references to a
    // namespace no import declares — `G.Application.SignalSignatures['activate']` and
    // twelve more, thirteen `TS2503: Cannot find namespace 'G'` in the type surface
    // consumers import. The answer is `Gio.Application`, and no prefix table can spell
    // it, because the prefix is the half the three namespaces share.
    //
    // So ASK THE TYPELIB, which indexes by GType name and therefore needs no table at
    // all — the same oracle and the same reasoning as `scripts/generate-enum-values.mjs`,
    // whose own comment records that keeping a second prefix-to-namespace list is how
    // Pango came to be missing there once already. Measured over the 392 declaration
    // GTypes of @girs 5.2.0: the typelib answers 388, disagrees with the prefix split on
    // NONE, and is the only source for the 2 foreign ones.
    //
    // The prefix split stays as the FALLBACK, for the 4 GTypes a vocabulary newer than
    // the installed libraries names and the typelib has never heard of — all `Gtk`/`Adw`
    // by construction, since a foreign GType could not have been reached without the
    // library that declares it. SORTED LONGEST FIRST: `splitGType` returns on the first
    // prefix that matches, so a one-letter prefix examined before `Gtk` would split
    // `GtkBox` into `G` + `tkBox` — a name that still renders, still compiles, and is
    // wrong everywhere it appears. Nothing on this list is a prefix of another today;
    // the sort is what keeps that from mattering.
    const prefixes = sources.map((s) => s.prefix).sort((a, b) => b.length - a.length);

    // GType name -> the namespace and class name the typelib registers it under. Built
    // from whatever `repo.require` has pulled in so far, which is each source namespace
    // plus its whole dependency closure — Gio, GLib, Gdk, Gsk and Pango arrive without
    // being named here, which is the point.
    const repo = new GIRepository.Repository();
    const byGType = new Map<string, WidgetRef>();
    const indexLoadedNamespaces = (): void => {
        for (const ns of repo.get_loaded_namespaces()) {
            for (let i = 0; i < repo.get_n_infos(ns); i++) {
                const info = repo.get_info(ns, i);
                if (!(info instanceof GIRepository.ObjectInfo) && !(info instanceof GIRepository.InterfaceInfo))
                    continue;
                const gtype = info.get_type_name();
                // First writer wins, in `repo.require` order: a GType two namespaces both
                // expose belongs to the one that declares it, not to an importer.
                if (gtype && !byGType.has(gtype)) byGType.set(gtype, { gtype, namespace: ns, name: info.get_name() });
            }
        }
    };
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

        // Load the typelib this vocabulary describes, and index everything it drags in.
        // Required HERE, from `PROVENANCE`, rather than up front from `source.pkg`: the
        // namespace spelling and the version are the vocabulary's own statement, and
        // parsing them back out of `gtk-4.0` would be a second answer to a question the
        // file already answers — the same reason the provenance line above is built from
        // it and not from the package name.
        repo.require(p.namespace, p.version, 0);
        indexLoadedNamespaces();

        for (const [gtype, nicks] of Object.entries(runtime.ENUM_NICKS)) enumNicks.set(gtype, nicks);
        namespacesUsed.add(source.prefix);

        // A TAG IS A WIDGET, OR A NON-WIDGET THAT HOLDS ONE — which is the rule
        // `emit.mts` already prints at the top of the generated table, and `CHILD_HOLDERS`
        // is the vocabulary's own answer for the second half. It is stated here because
        // this loop stopped implementing it without changing: through @girs 5.1.0 `DECLS`
        // WAS the widget vocabulary, so pushing every key satisfied the rule by accident
        // of the input, and ts-for-gir #474 — which widened `DECLS` to every declaration a
        // UI file can instantiate — ended that identity. Measured on 5.2.0: 344 keys, of
        // which 165 are widgets and 4 are child holders. The 175 the filter drops are
        // things like `GtkBuilder`, which cannot appear inside the file it builds, and
        // `GtkIMContextSimple`, an input method. Both were caught by gates rather than
        // here: the conformance table found `GtkBuilder`'s ctor answering `GtkJSBuilder`
        // under GJS, and the Volar rule found two acronym tags a Vue template cannot
        // resolve. Neither expectation was edited — the filter is what retires them.
        //
        // Verified against the previous artefact rather than asserted: widget-or-holder
        // reproduces main's 169 tags EXACTLY, with nothing added and nothing dropped, so
        // no tag a consumer mounts today leaves the table.
        //
        // `closure` still takes every key. The artefact carries the vocabulary verbatim —
        // that is a separate gate — and an `extends` clause still needs the ancestors the
        // filter excludes from being mountable.
        const childHolders = new Set(runtime.CHILD_HOLDERS);
        for (const [gtype, chain] of Object.entries(runtime.DECLS)) {
            closure.set(gtype, chain);
            for (const link of chain) referenced.add(link);
            const ref = splitGType(gtype, prefixes, byGType);
            if (gtype === 'GtkWidget' || chain.includes('GtkWidget') || childHolders.has(gtype)) widgets.push(ref);
        }

        // Every GType the surface names owes a declaration, not only the ones carrying
        // properties of their own. GtkSeparator and AdwSpinner declare none, and an
        // `extends` clause pointing at an interface that was never emitted does not
        // compile. Building this from OWN_PROPS alone left twelve such clauses.
        //
        // OWN_SIGNALS IS THE THIRD SOURCE, and it was missing for the same reason the
        // second one was: nothing in the corpus had yet been signal-only. @girs 5.2.0
        // carries signals for six interfaces that declare no properties and are no DECLS
        // key either — GtkTreeModel, GtkTreeSortable, GtkSelectionModel, GtkSectionModel,
        // GtkStyleProvider and GtkPrintOperationPreview — so a union of the first two
        // dropped them silently, and the artefact went out without their signals while
        // every other check stayed green. A union that is not built from EVERY map the
        // artefact carries is a filter nobody wrote down.
        const owned = new Set([
            ...Object.keys(runtime.DECLS),
            ...Object.keys(runtime.OWN_PROPS),
            ...Object.keys(runtime.OWN_SIGNALS),
        ]);
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
            const ref = splitGType(gtype, prefixes, byGType);
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
                    const b = splitGType(base, prefixes, byGType);
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
        const ref = splitGType(gtype, prefixes, byGType);
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
    //
    // AND REFUSE TO EMIT A NAMESPACE NOTHING CAN IMPORT, which is the mechanism rather
    // than the fix. Skipping a namespace this map has no package for is right for the
    // SECOND segment of a qualified name — `Gtk.Box.SignalSignatures['x']` offers `Box.`
    // to the same regex — and it was silently wrong for the first, which is how thirteen
    // `G.Application…` references reached a shipped artefact with no generator output to
    // show for it. The two cases are told apart by position: only a segment that starts a
    // qualified name is a namespace, so `(?<![\w.])` is what makes the refusal safe. The
    // typelib lookup in `splitGType` is why nothing trips this today; this is what says so
    // the next time a vocabulary widens.
    const packages: Record<string, string> = Object.fromEntries(sources.map((s) => [s.prefix, `@girs/${s.pkg}`]));
    const unimportable = new Map<string, string>();
    for (const declaration of declarations.values()) {
        for (const member of [...declaration.props, ...declaration.signals]) {
            for (const m of member.ts.matchAll(/(?<![\w.])([A-Z][A-Za-z0-9]*)\./g)) {
                const ns = m[1]!;
                if (namespacesUsed.has(ns)) continue;
                const pkg = importable.get(ns) ?? packages[ns];
                if (!pkg) {
                    unimportable.set(ns, `${declaration.gtype}: ${member.ts}`);
                    continue;
                }
                namespacesUsed.add(ns);
                packages[ns] = pkg;
            }
        }
    }
    if (unimportable.size > 0) {
        const shown = [...unimportable].map(([ns, where]) => `${ns} (first seen in ${where})`).join('; ');
        throw new Error(
            `${unimportable.size} namespace(s) named by a rendered type have no @girs package to import them from, ` +
                `so every reference to them would be emitted undefined: ${shown}`,
        );
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
