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
 */

import GLib from 'gi://GLib?version=2.0';

import type { Declaration, PropMember, SignalMember, SurfaceModel } from './model.mjs';

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

/** One property, as the `.d.ts` renders it: the TS text plus whatever JSDoc sits above. */
interface DeclaredProp {
    readonly ts: string;
    readonly doc?: string;
    readonly since?: string;
    readonly deprecated: boolean;
}

function read(path: string): string {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

/**
 * The interfaces a vocabulary `.d.ts` declares, with each property's rendered type.
 *
 * Brace-matched rather than terminated on `\n}`: an interface body can contain a nested
 * object type, and a reader that stops at the first closing brace silently truncates it.
 * That exact shortcut is already recorded as a defect in two sibling scripts.
 */
/**
 * Read the namespace imports a vocabulary declares: `import type Gdk from
 * '@girs/gdk-4.0'`.
 *
 * These are the only honest answer to "which namespaces do the rendered types reach
 * into". Deriving it from the source list instead emitted `Gdk.RGBA` with no Gdk
 * import — TS2503, in a file nobody edits by hand.
 */
function readNamespaceImports(text: string, ownPkg: string): Map<string, string> {
    const out = new Map<string, string>();
    const line = /^import type (\w+) from '([^']+)';$/gm;
    for (let m = line.exec(text); m !== null; m = line.exec(text)) {
        const spec = m[2]!;
        out.set(m[1]!, spec.startsWith('.') ? `@girs/${ownPkg}` : spec);
    }
    return out;
}

function readDeclaredInterfaces(text: string): Map<string, Map<string, DeclaredProp>> {
    const out = new Map<string, Map<string, DeclaredProp>>();
    // `\s*` before the brace is load-bearing: without it only interfaces that carry an
    // `extends` clause match, because `[^{]*` swallows the space for those. Every root
    // interface — GtkAccessible, GtkFileChooser, GtkListItem — is declared without one.
    const head = /^export interface (\w+)Props(?:\s+extends\s[^{]*)?\s*\{/gm;
    for (let m = head.exec(text); m !== null; m = head.exec(text)) {
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < text.length && depth > 0; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
        }
        out.set(m[1]!, readProps(text.slice(m.index + m[0].length, i - 1)));
    }
    return out;
}

/** Property lines plus the JSDoc block immediately above each one. */
function readProps(body: string): Map<string, DeclaredProp> {
    const props = new Map<string, DeclaredProp>();
    const line = /^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\?: (.+);$/gm;
    for (let m = line.exec(body); m !== null; m = line.exec(body)) {
        const name = m[1] ?? m[2]!;
        const before = body.slice(0, m.index);
        const open = before.lastIndexOf('/**');
        const close = before.lastIndexOf('*/');
        const block = open !== -1 && close > open ? before.slice(open, close + 2) : '';
        // Strip the block delimiters before the per-line stars. Doing it per line only
        // works for multi-line comments: a single-line `/** text */` keeps its trailing
        // `*/`, which the emitter then closes a second time and `gjsify format` rejects
        // as a syntax error.
        const doc = block
            .replace(/^\/\*\*/, '')
            .replace(/\*\/$/, '')
            .split('\n')
            .map((l) => l.replace(/^\s*\*+ ?/, '').trim())
            .filter((l) => l !== '' && !l.startsWith('@'))
            .join(' ');
        props.set(name, {
            ts: m[3]!,
            doc: doc === '' ? undefined : doc,
            since: /@since ([\d.]+)/.exec(block)?.[1],
            deprecated: /@deprecated/.test(block),
        });
    }
    return props;
}

const camelOf = (kebab: string): string => kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `GtkBox` -> `Gtk`, `Box`. The vocabulary keys are GTypes, which carry both. */
function splitGType(gtype: string, namespaces: readonly string[]): WidgetRef {
    for (const ns of namespaces) {
        if (gtype.startsWith(ns) && gtype.length > ns.length) {
            return { gtype, namespace: ns, name: gtype.slice(ns.length) };
        }
    }
    throw new Error(`cannot split GType ${gtype} across ${namespaces.join(', ')}`);
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
    const allRendered = new Map<string, Map<string, DeclaredProp>>();
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
        for (const [gtype, props] of declared) allRendered.set(gtype, props);
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
                const d = rendered?.get(kebab);
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
                prop: `on${camelOf(signal).replace(/^[a-z]/, (c) => c.toUpperCase())}`,
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
                doc: undefined,
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
            props: [...(allRendered.get(gtype)?.entries() ?? [])].map(([kebab, d]) => ({
                kebab,
                camel: camelOf(kebab),
                ts: d.ts,
                doc: d.doc,
                deprecated: d.deprecated,
                since: d.since,
            })),
            signals: [],
            doc: undefined,
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
            omissions: new Map(),
        },
        widgets,
        provenance: provenance.join(' '),
    };
}
