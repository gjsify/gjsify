/**
 * Rule `headless` (ADR 0015) — intra-GJS layering: headless vs toolkit-bound.
 *
 * Every other rule in this set models CROSS-RUNTIME reach: which of gjs × node ×
 * browser × nativescript a package claims, and whether the code a slot resolves
 * to can keep that claim. None of it says anything about layering WITHIN the GJS
 * runtime, and that is a real, documented contract that had no machine check at
 * all:
 *
 *   `@gjsify/canvas2d-core` documents itself as "**Headless** … NO GTK
 *   dependency in the ROOT entry", which is the entire reason it was split out
 *   of `@gjsify/canvas2d` (breaking the dom-elements↔canvas2d cycle). It
 *   nevertheless imported `gi://Gdk` from five call sites, and in GTK4 GDK
 *   lives inside `libgtk-4.so` — so the "headless" core dlopened the whole GTK
 *   stack on import.
 *
 * The existing audits structurally COULD NOT catch that:
 *
 *   · The runtimes drift check feeds `gi_url` into its suggestion as an INPUT,
 *     so the Gdk import made the declaration agree BETTER, not worse. It
 *     produced agreement, not drift.
 *   · The ADR-0014 reachability pass is gated on `slot === 'polyfill' ||
 *     slot === 'partial'` over the non-GJS targets. canvas2d-core's non-GJS
 *     slots are node:"none" / browser:"native" / nativescript:"none", so every
 *     slot was skipped and `src/**` was never examined.
 *
 * So the contract lived only in prose, and prose does not fail a build.
 *
 * ── The declaration ──
 *
 * `package.json#gjsify.headless` — an EXPLICIT declaration, never a heuristic.
 * A name heuristic (`*-core`) is guessable but wrong by construction:
 * `@gjsify/adwaita-core` and `@gjsify/storybook-core` are headless for entirely
 * different reasons, `@gjsify/webrtc-native` is a `-native` package that is the
 * most toolkit-bound thing in the tree, and a future `-core` may be headless in
 * neither sense. A declaration is honest (the package states its own promise),
 * greppable, and reviewable in the diff that introduces it.
 *
 * Two spellings, because there are two genuinely different promises:
 *
 *   "headless": true                       — the CLOSED promise: the root entry
 *                                            reaches NO typelib at all (no
 *                                            `gi://`, no `@girs/*` value
 *                                            import, no bare `cairo`/`system`/
 *                                            `gettext`, no legacy `imports.*`).
 *   "headless": ["Gdk", "Gtk"]             — the SCOPED promise: the root entry
 *                                            reaches none of the LISTED
 *                                            typelibs; others are fine. This is
 *                                            `@gjsify/canvas2d-core`, which is
 *                                            headless of GTK while legitimately
 *                                            binding Cairo + PangoCairo.
 *
 * A boolean-only field would force canvas2d-core — the package the invariant
 * exists for — to either lie or opt out. A list-only field would force
 * adwaita-core to enumerate an open-world set ("every typelib that exists"),
 * which is unmaintainable and silently under-specifies. The field therefore
 * carries the SHAPE of the promise, and the check reads it literally.
 *
 * ── What is checked ──
 *
 * For each declaring package, the ROOT import graph — starting at the source
 * behind `exports["."]`, following relative imports inside the package AND
 * crossing into the root/subpath entry of every workspace import — must not
 * reach a forbidden typelib.
 *
 * ROOT-ENTRY-ONLY IS THE POINT, and it is the subtlety that made the original
 * bug invisible in the first place. A side-effect SUBPATH may legitimately
 * reach the forbidden typelibs: the fix for canvas2d-core was to move the GDK
 * code behind `@gjsify/canvas2d-core/gdk`, which `@gjsify/dom-elements/register
 * /canvas` and `@gjsify/canvas2d` import EXPLICITLY. Scanning `src/**` would
 * flag that subpath and make the fixed tree red; scanning only what the root
 * entry pulls in is exactly the promise the prose makes.
 *
 * Failure to RESOLVE the root entry is itself a failure — a check that silently
 * passes when it cannot find what it is supposed to inspect is decorative.
 *
 * PORTABLE: the only inputs are the manifest, the package's own sources, and
 * the manifests of workspace siblings. Nothing here is specific to this
 * repository — a downstream GJS library can declare `gjsify.headless` and get
 * the same check from `gjsify manifest-check`.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { defineRule } from '../registry.mjs';
import {
    exportTarget,
    GJS_IMPORTS_GUARD_RE,
    IMPORT_RE,
    IMPORTS_LEGACY_RE,
    packageNameOf,
    resolveLocalSource,
    SIDE_EFFECT_RE,
    sourceForBuiltPath,
    TYPE_ONLY_RE,
} from '../source-graph.mjs';

/** GJS bare built-in specifiers that are typelib-backed bindings, not npm packages. */
const GJS_BARE_BINDINGS = new Set(['cairo', 'system', 'gettext']);

/** Compare namespaces case-insensitively: `@girs/gdkpixbuf-2.0` ≡ `GdkPixbuf`. */
export function normalizeTypelib(ns) {
    return String(ns).trim().toLowerCase();
}

/**
 * The typelib namespace a bare specifier binds, or `null` when the specifier
 * is not a GI binding at all.
 *
 * `@girs/*` is the TYPE package for a namespace, but a VALUE import of it
 * resolves to a body that re-exports the `gi://` default — so it binds the
 * typelib just as directly. (The caller filters `import type` first.)
 */
export function typelibOfSpecifier(spec) {
    let m = /^gi:\/\/([^?/]+)/.exec(spec);
    if (m) return { ns: m[1], form: `gi://${m[1]}` };
    // `@girs/gdk-4.0`, `@girs/gjs`, and any future `@girs/<ns>-<ver>/<subpath>`
    // — the namespace is what binds, the subpath does not change that.
    m = /^@girs\/([A-Za-z0-9_]+)(?:-[\d.]+)?(?:\/|$)/.exec(spec);
    if (m) return { ns: m[1], form: spec };
    if (GJS_BARE_BINDINGS.has(spec)) return { ns: spec, form: `bare '${spec}'` };
    return null;
}

/** The source file behind a package's `exports["."]` (the ROOT entry). */
export function rootEntrySource(rec) {
    const declared = exportTarget(rec.exports, '.');
    const fromExports = declared ? sourceForBuiltPath(rec.pkgDir, declared) : null;
    if (fromExports) return fromExports;
    const fallback = join(rec.pkgDir, 'src', 'index.ts');
    return existsSync(fallback) ? fallback : null;
}

/** The source a `<pkg>[/<subpath>]` workspace specifier resolves to, or `null`. */
export function workspaceEntrySource(spec, meta) {
    const pkgName = packageNameOf(spec);
    const rec = meta.get(pkgName);
    if (!rec) return null;
    const rest = spec.slice(pkgName.length + 1);
    if (rest.length === 0) return rootEntrySource(rec);
    const declared = exportTarget(rec.exports, `./${rest}`);
    const fromExports = declared ? sourceForBuiltPath(rec.pkgDir, declared) : null;
    if (fromExports) return fromExports;
    // Undeclared subpath (or one whose target is not a TS-backed file): fall
    // back to the conventional source layout rather than losing the edge.
    return sourceForBuiltPath(rec.pkgDir, rest);
}

/**
 * Walk the ROOT import graph and collect every GI binding it reaches.
 *
 * Follows relative imports within a package and crosses workspace edges into
 * the entry the specifier actually resolves to — a headless root that reaches
 * GTK through a sibling package is no less GTK-bound than one that imports
 * `gi://Gtk` itself.
 *
 * Two deliberate limits, both shared with the cross-runtime reachability walk:
 * only STATIC ESM imports are followed (a `await import('gi://Gtk')` behind a
 * runtime branch is the sanctioned graceful-degradation shape, not a leak), and
 * a workspace edge whose entry has no TS source behind it (`@gjsify/empty`, a
 * `.mjs`-only subpath) is dropped rather than guessed at.
 */
export async function walkHeadlessGraph(entryFile, meta) {
    const seen = new Set([entryFile]);
    /** child file → the file that imported it, for rendering the reach path. */
    const parents = new Map();
    const hits = [];
    const queue = [entryFile];
    while (queue.length) {
        const file = queue.shift();
        let text;
        try {
            text = await readFile(file, 'utf8');
        } catch {
            continue;
        }
        if (IMPORTS_LEGACY_RE.test(text) && !GJS_IMPORTS_GUARD_RE.test(text)) {
            hits.push({ ns: 'imports', form: 'legacy `imports.*` read', file });
        }
        for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                // `import type` / `export type … from` erase before the bundler runs.
                if (re === IMPORT_RE && TYPE_ONLY_RE.test(m[0])) continue;
                const spec = m[1];
                const next = spec.startsWith('.')
                    ? resolveLocalSource(file, spec)
                    : meta.has(packageNameOf(spec))
                      ? workspaceEntrySource(spec, meta)
                      : null;
                if (next) {
                    if (seen.has(next)) continue;
                    seen.add(next);
                    parents.set(next, file);
                    queue.push(next);
                    continue;
                }
                if (spec.startsWith('.')) continue;
                const binding = typelibOfSpecifier(spec);
                if (binding) hits.push({ ...binding, file });
            }
        }
    }
    return { hits, parents };
}

/**
 * `src/index.ts → src/context/text-rendering.ts` — how the root reaches `file`.
 *
 * Files inside the declaring package render package-relative; a file the graph
 * reached across a workspace edge renders root-relative, so a cross-package
 * leak reads as one at a glance instead of as a `../../` puzzle.
 */
export function renderReachPath(entryFile, file, parents, pkgDir, root) {
    const chain = [file];
    let cur = file;
    while (parents.has(cur) && chain.length < 12) {
        cur = parents.get(cur);
        chain.push(cur);
    }
    if (chain[chain.length - 1] !== entryFile) chain.push(entryFile);
    return (
        chain
            .reverse()
            // `relative` decides the containment, not a `/`-spelled string prefix:
            // both `pkgDir` and `f` are host-native, so on Windows the prefix test
            // was always false and every hop rendered root-relative
            // (`packages\dom\foo\src\index.ts → …` instead of `src/index.ts → …`).
            // Only the message degraded, but a diagnostic nobody can read is the
            // part of a failing rule that has to work.
            .map((f) => {
                const rel = relative(pkgDir, f);
                const inside = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
                return (inside ? rel : relative(root, f)).split(sep).join('/');
            })
            .join(' → ')
    );
}

/**
 * Build the per-package record set the headless walk needs, keyed by package
 * name so a workspace import can be followed into the entry it resolves to.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function collectHeadlessMeta(ctx) {
    const byName = new Map();
    for (const pkg of ctx.allPackages) {
        if (typeof pkg.manifest.name !== 'string') continue;
        byName.set(pkg.manifest.name, {
            name: pkg.manifest.name,
            pkgDir: pkg.dir,
            rel: pkg.rel,
            headless: pkg.gjsify.headless,
            exports: pkg.manifest.exports && typeof pkg.manifest.exports === 'object' ? pkg.manifest.exports : null,
        });
    }
    return byName;
}

/**
 * Run the headless-contract audit.
 *
 * `checked` counts declarations whose root entry actually got walked; a
 * declaration that did not (bad shape, unresolvable entry) is a failure, so on
 * the OK path `checked` IS the number of declaring packages.
 */
export async function auditHeadless(meta, root) {
    const failures = [];
    let checked = 0;

    for (const rec of [...meta.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
        if (rec.headless === undefined) continue;

        // Declaration shape. An unreadable declaration must fail loudly rather
        // than degrade to "nothing forbidden", which would pass on anything.
        /** @type {Set<string>|null} `null` = the closed promise (no typelib at all). */
        let forbidden;
        if (rec.headless === true) {
            forbidden = null;
        } else if (
            Array.isArray(rec.headless) &&
            rec.headless.length > 0 &&
            rec.headless.every((n) => typeof n === 'string' && n.trim().length > 0)
        ) {
            forbidden = new Set(rec.headless.map(normalizeTypelib));
        } else {
            failures.push(
                `${rec.name}: invalid \`gjsify.headless\` — expected \`true\` (the root entry reaches NO typelib) or a ` +
                    `non-empty array of typelib namespaces it promises not to reach (e.g. ["Gdk","Gtk"]). ` +
                    `Got ${JSON.stringify(rec.headless)} (headless-declaration-invalid).`,
            );
            continue;
        }

        const entryFile = rootEntrySource(rec);
        if (!entryFile) {
            failures.push(
                `${rec.name}: declares \`gjsify.headless\` but its root entry source could not be resolved from ` +
                    `package.json#exports["."] (${JSON.stringify(exportTarget(rec.exports, '.'))}) and no src/index.ts exists — ` +
                    `nothing to check, so the promise is unverifiable (headless-entry-unresolvable).`,
            );
            continue;
        }
        checked++;

        const { hits, parents } = await walkHeadlessGraph(entryFile, meta);
        const reported = new Set();
        for (const hit of hits) {
            if (forbidden !== null && !forbidden.has(normalizeTypelib(hit.ns))) continue;
            const key = `${hit.form}|${hit.file}`;
            if (reported.has(key)) continue;
            reported.add(key);
            const promise =
                forbidden === null
                    ? 'gjsify.headless=true (the root entry must reach NO typelib)'
                    : `gjsify.headless=[${rec.headless.join(', ')}]`;
            failures.push(
                `${rec.name}: ${promise} but the ROOT entry graph reaches ${hit.form} — ` +
                    `via ${renderReachPath(entryFile, hit.file, parents, rec.pkgDir, root)} ` +
                    `(headless-contract-violated).`,
            );
        }
    }
    return { failures, checked };
}

export const headlessRule = defineRule({
    id: 'headless',
    scope: 'portable',
    fields: ['gjsify.headless'],
    description: "a package's ROOT entry graph must not reach a typelib it promised not to (ADR 0015)",
    async run(ctx) {
        const meta = ctx.options?.headlessMeta ?? collectHeadlessMeta(ctx);
        const { failures, checked } = await auditHeadless(meta, ctx.root);
        return {
            failures,
            notes: failures.length
                ? [
                      'A `gjsify.headless` declaration is a promise about the ROOT entry only. Fix by one of: ' +
                          '(a) move the toolkit-bound code behind a side-effect SUBPATH the root never imports and have its ' +
                          'consumers import that subpath explicitly (the `@gjsify/canvas2d-core/gdk` pattern); ' +
                          '(b) inject the capability through a seam the root defines but does not implement ' +
                          '(`CanvasPixelBridge`); (c) narrow or drop the declaration if the package genuinely cannot keep it — ' +
                          'a headless claim that is not true belongs in neither the docs nor package.json.',
                  ]
                : [],
            stats: { checked },
            summary: `headless audit (ADR 0015): OK. ${checked} package(s) declare \`gjsify.headless\`; no root entry graph reaches a typelib it promised not to.`,
        };
    },
});
