/**
 * Rule `shipped-gi-deps` — the GI namespaces a SHIPPED BUNDLE hard-depends on must be
 * ones the package declared, and a package that declared `gjsify.headless` must ship
 * a bundle that reaches none of them.
 *
 * WHY THIS RULE EXISTS AT ALL, which is #1898.
 *
 * Every GI-declaration check in this registry reads SOURCE. `headless` walks the
 * root entry's import graph out of `src/**`; the ADR-0014 reachability pass walks
 * `src/**` too. That is the right subject for a promise about a package's own code,
 * and it is why the audit has been green on the showcase population for as long as
 * that population has existed: `@gjsify/example-*` is excluded from `gjsify run build`
 * and from `gjsify run check`, so nothing about those apps was ever built, audited or
 * shipped through a gate that could see them.
 *
 * The gap is not that the source walk is wrong. It is that a BUNDLE is a different
 * artifact from its source, and the build ADDS GI bindings that appear in no source
 * file of the package. Measured on a real `--app gjs` build of
 * `@gjsify/example-dom-canvas2d-confetti`, whose own `src` imports no typelib at all:
 *
 *     dist/gjs.js   import t from "gi://Pango?version=1.0"
 *                   import r from "gi://Gio?version=2.0"
 *                   import o from "gi://Gdk?version=4.0"
 *                   import s from "gi://GdkPixbuf?version=2.0"
 *                   … nine namespaces, none of them in a source file
 *
 * They arrive through `--globals auto` — the bundler's own note on that build says so:
 * "this bundle now requires gi://Gdk, gi://GdkPixbuf, gi://Pango, gi://PangoCairo at
 * load" — and `@gjsify/fetch`'s bare `import "gi://Soup?version=3.0"` side-effect
 * import is the same shape. A source-graph rule is structurally blind to all of it: the
 * import statements are synthesised at BUILD time, by the bundler, from a decision
 * recorded nowhere in the package.
 *
 * The consequence is a failure this repository has already paid for once, recorded in
 * `packages/infra/cli/src/utils/ship/gi-namespaces.ts`'s header: a package derives an
 * EMPTY typelib dependency set, installs cleanly, and dies at its first GI call. The
 * reader that catches that exists — `scanGiNamespaces`, AST-parsed because a regex
 * misses the bare side-effect form and matches `gi://` inside a diagnostic string — but
 * it runs only inside `gjsify ship`, at the last step of a release, on the author's
 * machine. Nothing runs it on a pull request.
 *
 * SO THIS RULE IS THAT READER, MOVED TO WHERE IT CAN GATE. It reads the EMITTED files.
 *
 * ── ROOT-ENTRY GRAPH, not a per-file scan, and the second version got this wrong ──
 *
 * The first version scanned every `.js`/`.mjs` under `files` and reported three
 * findings on `main`, two of them false: `@gjsify/canvas2d-core` declares
 * `gjsify.headless: ["Gdk","GdkPixbuf","Gsk","Gtk","Adw"]`, and the shipped tree really
 * does contain `lib/esm/gdk-pixel-bridge.js` importing `gi://Gdk` — that is the FIX for
 * the violation the rule exists to catch, moved behind the `/gdk` subpath so the root
 * entry no longer reaches it. A rule that scans every module of a package's shipped
 * `lib/` tree re-reports the repair as the disease, and the only way to make it quiet
 * is the thing this registry exists to prevent.
 *
 * So the traversal is `walkHeadlessGraph`'s, over the SHIPPED tree: start at the
 * package's shipped root entry, follow relative imports inside the package, cross a
 * workspace edge into the sibling's shipped root entry, and report what that graph
 * reaches. `headless`'s own header states why the promise is root-only — "a side-effect
 * SUBPATH may legitimately reach the forbidden typelibs: the fix for canvas2d-core was
 * to move the GDK code behind `@gjsify/canvas2d-core/gdk`" — and that reasoning is a
 * property of the PROMISE, not of the artifact it is checked against. Checking it on
 * bytes and dropping the root-only limit at the same time would have been a second,
 * larger version of the same mistake.
 *
 * The two artifacts differ in ONE respect that matters and it is why this is not a
 * call into `walkHeadlessGraph`: a source walk resolves a workspace specifier through
 * `sourceForBuiltPath`, mapping a declared output back to the `.ts` behind it, and it
 * reads TypeScript. This walk resolves the same specifier to the SIBLING'S BUILT root
 * entry and reads emitted JavaScript. The VOCABULARY is shared and imported, never
 * restated — `typelibOfSpecifier`, `normalizeTypelib`, `IMPORT_RE`, `SIDE_EFFECT_RE`,
 * `TYPE_ONLY_RE` — so a specifier shape the two disagree about is a shape that cannot
 * be spelled two ways.
 *
 * ── What "hard" means, and the seam for ADR 0086 ──
 *
 * A namespace in the emitted set is a HARD dependency when the bundle loads it
 * unconditionally, and an OPTIONAL one when the import carries `&optional` (ADR 0086,
 * `gi://X?version=Y&optional` — the form that resolves to a try/catch and yields
 * `undefined` rather than throwing). The hard set is what a consumer must be able to
 * satisfy before the module runs at all, so it is what a package must be able to
 * ACCOUNT for.
 *
 * `optional` is a SEPARATE SET rather than a flag on one reader, and that is the whole
 * seam. ADR 0086 / PR #1947 is not merged here, so nothing in this tree emits
 * `&optional` and the optional set is empty on every real bundle. When that PR lands the
 * classification starts firing with no change to any caller, and those namespaces drop
 * out of the hard set a package must satisfy — which is the point of a seam: the
 * question "must this be declared?" stops depending on how the import was spelled. A
 * rule written to be extended by editing its one extraction site is a rule that gets
 * edited.
 *
 * ── What it CHECKS, and why the two halves differ in severity ──
 *
 *   1. FATAL — `gjsify.headless` violated in the SHIPPED tree. The existing `headless`
 *      rule holds that promise against SOURCE; this holds it against the files that
 *      ship, which is the stronger claim and the one a consumer experiences. It is also
 *      the half the BUNDLER can break on its own: a synthesised `import "gi://Gtk"` is
 *      a `dlopen` of libgtk-4.so at module evaluation with nothing in the source graph
 *      to explain it.
 *   2. A NOTE — a hard namespace on a package that declares no `gjsify.headless`. This
 *      is a fact, not a broken promise: most packages here legitimately bind typelibs,
 *      and they bind them through `@gjsify/*` dependencies the bundler inlines.
 *      Demanding per-namespace permission from all of them would be a new `gjsify.*`
 *      field, which `field-coverage` would then correctly refuse until a rule claimed
 *      it. Printing the set is the honest half: it makes the hard-dep set of every
 *      shipped bundle READABLE, so the number is in the log rather than a property
 *      nobody can see. A package that needs a guarantee declares `gjsify.headless` and
 *      the same set becomes fatal.
 *
 * ── The build-dependence is stated, never assumed ──
 *
 * The rule's subject is build output: gitignored, and absent in a fresh checkout —
 * which is the state #1898 was filed about. Treating that as "nothing to check" is the
 * defect, so a package whose declared `files` are not on disk is named in `unbuilt`, and
 * `unbuilt` is part of the run's own summary rather than a line buried in a green run.
 * `inspected` counts the packages whose shipped tree was actually opened, printed next
 * to `packages`, so the ratio is visible and a run that answered for nothing cannot
 * read as a full pass.
 *
 * PORTABLE: manifest, files on disk, and a string scan. No `@gjsify/cli` import — this
 * package must run in a consumer's tree with no dependencies — no build, no install.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { defineRule } from '../registry.mjs';
import { normalizeTypelib, typelibOfSpecifier } from './headless.mjs';
import { IMPORT_RE, SIDE_EFFECT_RE, TYPE_ONLY_RE } from '../source-graph.mjs';
import { stripComments } from '../strip-comments.mjs';

/** Extensions an emitted GJS/node artifact carries. `.gjs.mjs` is a compound suffix. */
const BUNDLE_EXTENSIONS = ['.gjs.mjs', '.gjs.js', '.mjs', '.js'];

/**
 * `gi://Gtk?version=4.0` → `{ ns: 'Gtk', optional: false }`; anything else → `null`.
 *
 * The query is read for `optional` as a PARAMETER rather than pattern-matched whole, so
 * an unrecognised one cannot hide it: a specifier carrying both `version` and
 * `optional` classifies, and the namespace is what decides a hard dependency. `version`
 * is deliberately not read — `Gtk` at 4.0 and `Gtk` at 4.2 are the same declaration, and
 * `gjsify.headless` names namespaces.
 */
export function parseGiSpecifier(specifier) {
    if (!specifier.startsWith('gi://')) return null;
    const rest = specifier.slice('gi://'.length);
    const q = rest.indexOf('?');
    const ns = q === -1 ? rest : rest.slice(0, q);
    if (!/^[A-Za-z][A-Za-z\d_]*$/.test(ns)) return null;
    const query = q === -1 ? '' : rest.slice(q + 1);
    return { ns, optional: query.split('&').some((part) => part === 'optional') };
}

/**
 * A quoted module specifier in an IMPORT or REQUIRE position, after comments are gone.
 *
 * The POSITION is what makes this safe on an emitted artifact, and the first version got
 * it wrong in the direction that matters. Matching any string that starts with `gi://`
 * reported `gi://Ns?version=X` — a placeholder `gi-namespaces.ts` writes in a JSDoc, and
 * `tsc` preserves it — as a dependency of `@gjsify/cli`, on a tree where the package
 * loads no such namespace. That is the `gi-namespaces.ts` incident repeating: "it matched
 * `gi://…` inside a diagnostic STRING". A check whose finding can be produced by
 * rewording a comment is a check that gets silenced.
 *
 * So the pattern is the CONSTRUCT, not the token. Group 1 is the keyword, group 2 the `(`
 * of a call, group 4 the specifier. A `(` in group 2 with keyword `import` is
 * `await import("gi://X")` — the sanctioned graceful-degradation shape, which resolves
 * to a catch branch and is NOT a hard dependency — so it is read and dropped rather than
 * pattern-matched away, which would also have eaten `from(`.
 */
const MODULE_SPECIFIER_RE = /\b(from|import|require)\s*(\()?\s*(['"`])((?:[^'"`\\]|\\.)*)\3/g;

/**
 * `…requireGi("Gtk", …)` — the form `gjsGiNodePlugin` emits under `--app node`, where
 * the `gi://` specifier is rewritten away and the literal namespace is all that
 * survives. Matched on the `requireGi` property plus a string-literal first argument.
 *
 * A same-named method on an unrelated object is the documented residual
 * over-approximation, and it is the safe direction for a gate: a synthesised
 * `requireGi` call is REPORTED, and the planted-bundle cases in
 * `tests/e2e/audit-strict-scopes/` are what keep the shape honest. `depends.spec.ts`
 * carries the AST-level authority for the packaging path, which cannot afford to
 * over-approximate because an unmapped namespace fails the build.
 */
const REQUIRE_GI_RE = /\.requireGi\(\s*['"`]([A-Za-z][A-Za-z\d_]*)['"`]/g;

/**
 * Collapse a namespace set case-insensitively, preferring the capitalised spelling.
 *
 * `gi://adw` and `gi://Adw` are ONE namespace, and a set that prints both reads as two
 * dependencies where there is one — which is the only reason to print the set at all.
 */
function canonicalize(entries) {
    /** @type {Map<string, {lower: string, exact: string[], capital: string[], form: string}>} */
    const byLower = new Map();
    for (const { ns, form } of entries) {
        const lower = ns.toLowerCase();
        if (!byLower.has(lower)) byLower.set(lower, { lower, exact: [], capital: [], form });
        const bucket = byLower.get(lower);
        if (ns[0] === ns[0].toUpperCase()) bucket.capital.push(ns);
        else bucket.exact.push(ns);
    }
    return [...byLower.values()]
        .map((b) => ({ ns: b.capital[0] ?? b.exact[0] ?? b.lower, form: b.form }))
        .sort((a, b) => a.ns.localeCompare(b.ns));
}

/**
 * The GI bindings one EMITTED file hard-depends on, split by optionality.
 *
 * Each entry keeps the SPECIFIER it was reached by, not just the namespace. The first
 * version printed `gi://` + namespace for every hit, which invented a specifier that is
 * not in the file: `@gjsify/child_process` binds Gio through `import … from
 * "@girs/gio-2.0"` — a VALUE import of the type package, lowercase, with no `gi://` text
 * anywhere in its emitted root — and the report claimed `gi://gio`. A hard-dep set whose
 * spellings are fabricated cannot be pasted into a `depends.ts` or a bug report, which is
 * the only reason to print one.
 *
 * Comments go through the repository's ONE stripper first, and every specifier is routed
 * through `typelibOfSpecifier` — the SAME reader `headless` uses — so a `gi://X`, a
 * `@girs/x` value import and a bare `cairo` / `system` / `gettext` binding are classified
 * by one definition and a shape cannot be spelled two ways. Only `gi://` is asked the
 * extra question, because only it carries `&optional`.
 *
 * @param {string} source emitted artifact text
 * @returns {{hard: {ns: string, form: string}[], optional: {ns: string, form: string}[]}}
 */
export function scanBundleGiNamespaces(source) {
    const text = stripComments(source);
    const hard = [];
    const optional = [];
    for (const [, keyword, call, , spec] of text.matchAll(MODULE_SPECIFIER_RE)) {
        if (call === '(' && keyword === 'import') continue;
        if (spec.startsWith('gi://')) {
            const parsed = parseGiSpecifier(spec);
            if (parsed === null) continue;
            (parsed.optional ? optional : hard).push({ ns: parsed.ns, form: spec });
            continue;
        }
        const binding = typelibOfSpecifier(spec);
        if (binding) hard.push({ ns: binding.ns, form: binding.form });
    }
    for (const [, ns] of text.matchAll(REQUIRE_GI_RE)) hard.push({ ns, form: `requireGi("${ns}")` });
    return { hard: canonicalize(hard), optional: canonicalize(optional) };
}

/**
 * The `files` entries that are plain paths (no glob), whose ABSENCE means "not built".
 *
 * An ABSENT `files` is not an absent shipped tree: npm then publishes the whole package
 * directory, so a package with no `files` ships `lib/` like any other. Treating "no
 * `files`" as "nothing to look at" reported `@gjsify/empty` and `@gjsify/adwaita-icons`
 * as having no root entry when both name one, and 86 packages as an unanswered boundary
 * when 80 of them ship a prebuild payload or a stylesheet and have no JS entry at all.
 */
function declaredRoots(manifest) {
    if (!Array.isArray(manifest.files)) return [];
    return manifest.files.filter((e) => typeof e === 'string' && !/[*?[\]{}!]/.test(e));
}

/** Whether `abs` is inside something the package SHIPS. No `files` ⇒ the whole dir. */
function isShipped(pkgDir, manifest, abs) {
    const roots = declaredRoots(manifest);
    if (roots.length === 0) return true;
    return roots.some((r) => {
        const root = join(pkgDir, r.replace(/^\.\//, ''));
        return abs === root || abs.startsWith(`${root}${sep}`);
    });
}

/**
 * The string value behind an `exports` condition set, or `null`.
 *
 * An `exports` entry is either a string or a conditions object, and a package may use
 * `{"import": …, "require": …, "default": …}`. `default` is read LAST and only as a
 * fallback, for the same reason `headless` reads it: a package that declares only
 * `types` + `import` still has a root, and refusing to find it would report a package
 * as "no root entry" when it plainly has one.
 */
function conditionTarget(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    for (const key of ['gjsify', 'browser', 'import', 'node', 'require', 'default']) {
        const found = conditionTarget(value[key]);
        if (found) return found;
    }
    return null;
}

/**
 * Every SHIPPED root entry of a package, as absolute paths.
 *
 * More than one is the normal case, not an edge: a showcase ships a `--app gjs` bundle
 * AND a `--app node` bundle (`gjsify.example.node`), and both are what a consumer runs.
 * Checking the root the source walk happens to resolve and leaving the second bundle
 * unchecked is the vacuity this rule exists to end, one entry point at a time.
 *
 * A declared target that is not on disk is NOT returned — the caller counts that as
 * unbuilt, and a path it cannot open is not a root it walked.
 */
export function shippedRootEntries(pkg) {
    const manifest = pkg.manifest ?? {};
    const candidates = [
        pkg.gjsify?.main,
        manifest.main,
        conditionTarget(manifest.exports?.['.']),
        conditionTarget(manifest.exports?.['.']?.default),
    ];
    const out = [];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate.length === 0) continue;
        // A root the package does not SHIP is not its root. `adwaita-fonts` names
        // `index.css` and `adwaita-icons` names `index.ts`: neither is an emitted JS
        // artifact, so neither is a graph this rule can walk, and admitting them would
        // report a package as "no root entry" when what it has is a stylesheet.
        if (!BUNDLE_EXTENSIONS.some((ext) => candidate.endsWith(ext))) continue;
        const abs = resolve(pkg.dir, candidate);
        if (!isShipped(pkg.dir, manifest, abs)) continue;
        if (existsSync(abs) && !out.includes(abs)) out.push(abs);
    }
    return out;
}

/** `src/index.ts → src/foo.ts` for source, `lib/esm/index.js → lib/esm/foo.js` for output. */
function renderPath(entryFile, file, parents, pkgDir, root) {
    const chain = [file];
    let cur = file;
    while (parents.has(cur) && chain.length < 12) {
        cur = parents.get(cur);
        chain.push(cur);
    }
    if (chain[chain.length - 1] !== entryFile) chain.push(entryFile);
    return chain
        .reverse()
        .map((f) => {
            const rel = relative(pkgDir, f);
            const inside = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('/');
            return (inside ? rel : relative(root, f)).split(sep).join('/');
        })
        .join(' → ');
}

/**
 * The per-package input the audit needs, resolved once.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function collectShippedPackages(ctx) {
    /** @type {Map<string, {pkg: any, roots: string[], declared: string[], absent: string[], declaresRoot: boolean}>} */
    const collected = new Map();
    // `--scope` filters HERE rather than through `createContext`'s `only`, because `only`
    // also narrows every LEDGER: under a scoped population `field-coverage` reported
    // `gjsify.buildCache` as declared by nothing and `stylesheet-font-families` called its
    // own entries stale. A scope names the packages whose SHIPPED OUTPUT this rule must
    // answer for; it does not make the rest of the repository stop existing.
    //
    // The patterns are applied, not interpreted — they arrive as `RegExp[]` in
    // `ctx.options.shippedScope`, and this file names no package. A rule that imported
    // the repo's own scope list would stop being `portable` and would break in the
    // consumer tree this package exists to serve.
    const scope = ctx.options?.shippedScope ?? null;

    for (const pkg of ctx.allPackages) {
        if (pkg.private) continue;
        // The website is an Astro site, not a GJS bundle set: it declares `files` and has
        // no emitted artifact any of this reads.
        if (pkg.manifest.name === '@gjsify/website') continue;
        if (scope && scope.some((re) => re.test(pkg.manifest.name))) continue;
        const declared = declaredRoots(pkg.manifest);
        // Whether the package NAMES a JS root entry at all, and whether that FILE is on
        // disk. The MISSING ROOT ENTRY is the obligation, not a missing `files` directory:
        // `@gjsify/gtk-runtime-darwin-arm64` ships `files: ["index.js","index.d.ts","gtk"]`
        // and its `gtk/` payload is legitimately absent on a Linux checkout — that is the
        // OS axis answering, and it is `prebuild-artifacts`' question, not this one.
        // Keying on `files` made every cross-platform payload package a permanent
        // "unbuilt" finding on the wrong host, which is the vacuity in a new coat.
        const rootCandidates = [
            pkg.gjsify?.main,
            pkg.manifest.main,
            conditionTarget(pkg.manifest.exports?.['.']),
        ].filter((c) => typeof c === 'string' && BUNDLE_EXTENSIONS.some((ext) => c.endsWith(ext)));
        const declaresRoot = rootCandidates.length > 0;
        const absentRoot =
            declaresRoot && !shippedRootEntries(pkg).length
                ? rootCandidates.find((c) => !existsSync(resolve(pkg.dir, c)))
                : undefined;
        collected.set(pkg.manifest.name, {
            pkg,
            roots: shippedRootEntries(pkg),
            declared,
            absent: absentRoot ? [absentRoot] : [],
            declaresRoot,
        });
    }
    return collected;
}

/**
 * Run the audit.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export async function auditShippedGiDeps(ctx) {
    const failures = [];
    const notes = [];
    /** @type {string[]} */
    const unbuilt = [];
    const unrooted = [];
    const unresolved = [];
    const shipped = collectShippedPackages(ctx);
    const byName = new Map([...shipped].map(([name, entry]) => [name, entry]));
    // Whether this run was told WHICH population to answer for. Set by `--scope`; absent
    // for the default whole-tree sweep, where a missing build output is an ordinary state
    // of a job that deliberately does not build.
    const shippedAudit = ctx.options?.shippedAudit === true;
    // Packages a shipped scope may not answer for on this runner, handed in rather than
    // read: this file is `portable` and names no package of this repository's. Each entry
    // carries a reason and an issue and is used at most once — a stale one FAILS below,
    // which is what stops the list becoming where omissions go to die.
    const excused = new Map(Object.entries(ctx.options?.shippedUnbuiltAllowlist ?? {}));
    const excusedUsed = new Set();

    let inspected = 0;
    let graphs = 0;
    let packages = 0;
    /**
     * Per package: the union of its shipped roots' bindings, plus the reach PATH of each
     * one so a finding names the file chain rather than only the root.
     * @type {Map<string, {entry: string, hard: Map<string, string>, optional: Map<string, string>, paths: Map<string, string>}>}
     */
    const facts = new Map();

    for (const [name, { pkg, roots, absent, declaresRoot }] of [...shipped].sort((a, b) => a[0].localeCompare(b[0]))) {
        packages++;
        if (absent.length > 0) {
            const label = `${name} (${absent.join(', ')})`;
            unbuilt.push(label);
            // A scope that named this population cannot pass over a package it never
            // opened: that is the vacuity #1898 is about, and a note shaped like it is
            // the defect wearing a warning label. `--allow-unbuilt` is the seam
            // `package-outputs` already has, and the default whole-tree sweep keeps the
            // note because that job builds nothing on purpose.
            if (excused.has(name)) {
                excusedUsed.add(name);
                continue;
            }
            if (shippedAudit && !ctx.allowUnbuilt) {
                failures.push(
                    `${label}: declares shipped path(s) that are not on disk, so no bundle of this package was ` +
                        'inspected. This run audited a population BY NAME and could not answer for it. Build the ' +
                        'package (a shipped scope is meant to run on a built tree) or pass --allow-unbuilt to record ' +
                        'the gap without failing on it (shipped-unbuilt).',
                );
            }
            continue;
        }
        if (roots.length === 0) {
            // Only a package that NAMES a JS root entry and does not have it on disk is a
            // gap. A package that names none ships a prebuild payload, a stylesheet or
            // nothing, and saying so is how eighty non-answers drown the one real one.
            if (declaresRoot) unrooted.push(name);
            continue;
        }
        inspected++;
        for (const entry of roots) {
            graphs++;
            const { hits, parents, unresolved: dropped } = walkShippedGraph(entry, byName);
            for (const dep of dropped) unresolved.push(`${name} → ${dep}`);
            const record =
                facts.get(name) ??
                facts.set(name, { entry, hard: new Map(), optional: new Map(), paths: new Map() }).get(name);
            for (const hit of hits) {
                const sink = hit.optional ? record.optional : record.hard;
                if (!sink.has(hit.ns)) sink.set(hit.ns, hit.form);
                if (hit.optional) continue;
                const key = `${hit.ns}|${hit.file}`;
                if (!record.paths.has(key)) {
                    record.paths.set(key, renderPath(entry, hit.file, parents, pkg.dir, ctx.root));
                }
            }
        }
    }

    for (const [name, record] of [...facts].sort((a, b) => a[0].localeCompare(b[0]))) {
        const { entry, hard, optional, paths } = record;
        if (hard.size === 0 && optional.size === 0) continue;
        const rel = relative(ctx.root, entry).split(sep).join('/');
        const spell = (map) => [...map].map(([ns, form]) => `\`${form}\` (${ns})`).join(', ');
        const declared = shipped.get(name)?.pkg.gjsify?.headless;

        if (declared === undefined) {
            notes.push(
                `${name}: shipped root \`${rel}\` hard-depends on ${hard.size} GI namespace(s) — ${spell(hard)}` +
                    (optional.size > 0 ? `; plus ${optional.size} optional (${spell(optional)})` : '') +
                    '. No `gjsify.headless` declaration, so this is a NOTE, not a violation: it is what the package ' +
                    'loads, printed so the hard-dep set of every shipped bundle is READABLE rather than inferred — ' +
                    '`gi-namespaces.ts` records what an empty one costs, a package that installs cleanly and dies at ' +
                    'its first GI call. A package that needs a GUARANTEE declares `gjsify.headless` and the same set ' +
                    'becomes fatal.',
            );
            continue;
        }

        /** @type {Set<string>|null} `null` = the closed promise (no typelib at all). */
        let forbidden;
        if (declared === true) {
            forbidden = null;
        } else if (Array.isArray(declared) && declared.length > 0) {
            forbidden = new Set(declared.map((ns) => normalizeTypelib(ns)));
        } else {
            failures.push(
                `${name}: invalid \`gjsify.headless\` — expected \`true\` or a non-empty array of typelib namespaces; ` +
                    `got ${JSON.stringify(declared)} (shipped-headless-declaration-invalid).`,
            );
            continue;
        }

        const reported = new Set();
        for (const [ns, form] of hard) {
            if (forbidden !== null && !forbidden.has(normalizeTypelib(ns))) continue;
            if (reported.has(ns)) continue;
            reported.add(ns);
            const path = [...paths]
                .filter(([k]) => k.startsWith(`${ns}|`))
                .map(([, v]) => v)
                .join(' ; ');
            const promise =
                forbidden === null
                    ? 'gjsify.headless=true (the shipped root entry must reach NO typelib)'
                    : `gjsify.headless=[${declared.join(', ')}]`;
            failures.push(
                `${name}: ${promise} but the SHIPPED root entry \`${rel}\` hard-depends on \`${form}\` (${ns}) — via ` +
                    `${path} (shipped-headless-violated). The SOURCE graph this promise was written against does not ` +
                    `contain it, and that is the point: a GI binding the BUNDLER synthesises — \`--globals auto\`, a ` +
                    `bare side-effect \`import "gi://X"\` inside a dependency, an alias substitution — reaches no source ` +
                    `file of this package, so only the emitted artifact can see it. Fix by moving the binding behind a ` +
                    `subpath the root does not import, by narrowing the bundle (\`excludeGlobals\` or an explicit ` +
                    `--globals\` allowlist), or by dropping the declaration if the package cannot keep it.`,
            );
        }
        if (optional.size > 0) {
            notes.push(
                `${name}: \`${rel}\` optionally imports ${spell(optional)} (ADR 0086 \`&optional\`) — excluded from the ` +
                    'hard-dependency set, so it is not a violation even under `gjsify.headless`.',
            );
        }
    }

    // A standing exception must still describe a live gap. An entry whose package now
    // builds, or is no longer in the population at all, FAILS — the ledger cannot outlive
    // its cause, which is the whole reason it is a checked list rather than a comment.
    for (const name of excused.keys()) {
        if (excusedUsed.has(name)) continue;
        // Only a package IN this population can have a stale entry. An entry for a
        // package outside the population is not exercised by this run, which is the
        // normal state of a shared ledger under `--scope=examples` — failing on it made
        // the self-retiring check report a hole that was not there, and the fix would
        // have been to delete an entry that the ship scope still needs.
        if (!shipped.has(name)) continue;
        failures.push(
            `shipped-unbuilt allowlist: "${name}" is listed as excused from a shipped scope but its shipped root ` +
                'entry is on disk, so the excuse is no longer needed. Delete the entry; a standing exception nobody ' +
                're-checks is a hole with a comment on it.',
        );
    }

    return { failures, notes, unbuilt, unrooted, unresolved, packages, inspected, graphs, excused: [...excusedUsed] };
}

/**
 * Walk the SHIPPED root-entry graph of one package, collecting GI bindings.
 *
 * Mirrors `walkHeadlessGraph`'s contract — static imports only, workspace edges crossed
 * into the SIBLING'S SHIPPED root entry, a guarded `imports?.gi` probe not a binding —
 * and returns the same `{ hits, parents, unresolved }` shape so the two rules' findings
 * are rendered by one piece of prose. A workspace edge with no shipped root on disk is
 * DROPPED and RECORDED in `unresolved`, because dropping it silently is how a scope ends
 * up claiming coverage it does not have — the defect #1898 is about, one edge at a time.
 *
 * The one thing it cannot share with `walkHeadlessGraph` is the resolution of a workspace
 * specifier: that walk maps a declared output back to the `.ts` behind it through
 * `sourceForBuiltPath`, because it reads source. This one maps it to the sibling's
 * BUILT root entry, because it reads emitted JavaScript. The VOCABULARY is imported, not
 * restated — `typelibOfSpecifier`, `normalizeTypelib`, `IMPORT_RE`, `SIDE_EFFECT_RE`,
 * `TYPE_ONLY_RE` — so a specifier shape the two could disagree about cannot exist.
 *
 * @param {string} entryFile absolute path of a shipped root entry
 * @param {Map<string, {roots: string[]}>} byName sibling packages by name
 * @returns {{hits: {ns: string, form: string, file: string, optional: boolean}[],
 *           parents: Map<string, string>, unresolved: string[]}}
 */
export function walkShippedGraph(entryFile, byName) {
    const seen = new Set([entryFile]);
    const parents = new Map();
    const hits = [];
    const unresolved = new Set();
    const queue = [entryFile];
    while (queue.length > 0) {
        const file = queue.shift();
        let text;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                if (re === IMPORT_RE && TYPE_ONLY_RE.test(m[0])) continue;
                const spec = m[1];
                let next = null;
                if (spec.startsWith('.')) {
                    const abs = resolve(dirname(file), spec);
                    next = ['', '.js', '.mjs', '.gjs.mjs', '.gjs.js', '/index.js']
                        .map((ext) => `${abs}${ext}`)
                        .find((cand) => existsSync(cand) && BUNDLE_EXTENSIONS.some((e) => cand.endsWith(e)));
                } else {
                    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
                    const sibling = byName.get(name);
                    if (sibling) {
                        const [first] = sibling.roots;
                        if (first) next = first;
                        else unresolved.add(name);
                    }
                }
                if (next) {
                    if (seen.has(next)) continue;
                    seen.add(next);
                    parents.set(next, file);
                    queue.push(next);
                    continue;
                }
                if (spec.startsWith('.')) continue;
                const binding = typelibOfSpecifier(spec);
                if (binding) hits.push({ ...binding, file, optional: false });
            }
        }
        // ONE reader for the emitted artifact, not a second scan: the walk and the
        // per-file scan asking "is this a hard GI dependency?" separately is how two
        // answers to one question start, and only the rule body would be able to tell.
        const { hard, optional: opt } = scanBundleGiNamespaces(text);
        for (const b of hard) hits.push({ ns: b.ns, form: b.form, file, optional: false });
        for (const b of opt) hits.push({ ns: b.ns, form: b.form, file, optional: true });
    }
    return { hits, parents, unresolved: [...unresolved].sort() };
}

export const shippedGiDepsRule = defineRule({
    id: 'shipped-gi-deps',
    scope: 'portable',
    // Governs no NEW declaration kind: it HOLDS `gjsify.headless` against the emitted
    // artifact rather than against source, which `headless` already claims. Two rules
    // claiming one field is correct — `field-coverage` fails a field NO rule claims, and
    // a promise two different artifacts can break needs both held.
    fields: ['gjsify.headless'],
    description:
        'a SHIPPED root entry must not hard-depend on a typelib its gjsify.headless promise forbids (built output, not source)',
    async run(ctx) {
        const { failures, notes, unbuilt, unrooted, unresolved, packages, inspected, graphs } =
            await auditShippedGiDeps(ctx);
        const boundary = [
            unbuilt.length > 0 ? `${unbuilt.length} unbuilt (${unbuilt.join(', ')})` : null,
            unrooted.length > 0 ? `${unrooted.length} with no shipped root entry (${unrooted.join(', ')})` : null,
            unresolved.length > 0
                ? `${unresolved.length} unresolved workspace edge(s) (${unresolved.join(', ')})`
                : null,
        ]
            .filter(Boolean)
            .join('; ');
        return {
            failures,
            notes,
            stats: { packages, inspected, graphs, unbuilt: unbuilt.length },
            summary:
                `shipped-gi-deps: ${graphs} shipped root-entry graph(s) over ${inspected}/${packages} published ` +
                `package(s) inspected against their EMITTED output` +
                (boundary === '' ? '.' : ` — NOT ANSWERED: ${boundary}.`),
        };
    },
});
