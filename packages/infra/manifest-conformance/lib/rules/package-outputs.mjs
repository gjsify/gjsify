/**
 * Rule `package-outputs` — after a build, every file a package DECLARES must
 * exist.
 *
 * A `package.json` is a contract with two audiences — the bundler/type-checker
 * inside the repo and every consumer outside it — and both read it through the
 * same fields: `main`, `module`, `types`/`typings`, `bin`, and every `exports`
 * condition. A build that leaves one of those paths unwritten produces a package
 * that resolves to nothing, and NOTHING else in the pipeline notices:
 *
 *   - `gjsify tsc` exits 0. With `composite`/`incremental`, a `.tsbuildinfo`
 *     that outlives its output tree makes tsc consider the project up to date
 *     and emit NOTHING — a silent no-op with a success exit code. That is issue
 *     #67, reproduced verbatim in `@gjsify/adwaita-core`: with a stale
 *     `tmp/.tsbuildinfo` present `gjsify tsc` printed nothing, exited 0, and
 *     `lib/types/` was never created; deleting the build info made the SAME
 *     command emit it.
 *   - The build-cache (ADR 0006) restores per output UNIT. A restore that
 *     replaces `lib/esm` while `lib/types` is missing is, from the cache's point
 *     of view, a hit.
 *   - `gjsify pack`'s type-shipping guard (#655, `tests/e2e/publish-types-shipped`)
 *     deliberately does NOT fire on an ABSENT declaration — an unbuilt dev tree
 *     must still pack. It only catches a file that exists but is excluded by
 *     `files`.
 *   - `gjsify tsc --noEmit` (the `check` job) type-checks SOURCES. It never
 *     looks at `lib/`.
 *
 * So the only signal was "the build exited 0", and it lied. The consumer-side
 * symptom is `TS7016: Could not find a declaration file for module
 * '@gjsify/<pkg>'` — which reads like a consumer bug and gets papered over with
 * a per-consumer tsconfig workaround.
 *
 * It is the same shape as the committed-bundle guard: state the artifact
 * contract, then check it, rather than trusting an exit code. It is
 * cause-agnostic — it catches a stale build info, a cache restore that dropped a
 * unit, a script that was never wired into `build`, and a plain typo in
 * `exports`, without knowing which one happened.
 *
 * WHAT IT COSTS
 *   - It is a POST-condition, so it needs a built tree: run it AFTER a build,
 *     never on a fresh clone (`ctx.allowUnbuilt` degrades it to a note for local
 *     use). In CI that means the `build` job and only there.
 *   - It proves EXISTENCE, not freshness or correctness. A `.d.ts` regenerated
 *     from stale sources still passes; that class belongs to the
 *     committed-bundle guard.
 *   - Wildcard subpaths (`./assets/*`) can only be checked down to their static
 *     directory prefix.
 *   - It reads the declaration as authoritative. A package that declares an
 *     entry point it genuinely does not ship must fix the declaration — there is
 *     deliberately no per-package opt-out, because an opt-out list is the thing
 *     that drifts and then lies.
 *
 * PORTABLE: reads nothing but the manifest and the filesystem. The name
 * exclusions (`@girs/*`, generated type packages, …) are supplied by the CALLER
 * via `ctx.options.packageOutputs.excludeNamePatterns`, so the rule itself
 * carries no repository knowledge and behaves identically in a consumer's tree.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, relative, resolve } from 'node:path';

import { defineRule } from '../registry.mjs';

/**
 * A value is a path this rule can check only when it is RELATIVE. Bare
 * specifiers (`browser` remaps a dependency name), `false` (browser exclusion),
 * `null` (an `exports` block) and non-strings are somebody else's contract.
 */
export function isCheckablePath(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.startsWith('#') || value.startsWith('node:')) return false;
    // `./x`, `../x`, `x/y.js`, `x.js` — but not `pkg` or `@scope/pkg`.
    if (value.startsWith('./') || value.startsWith('../')) return true;
    return /^[^@][^:]*\.[a-z0-9]+$/i.test(value) || value.includes('/');
}

/**
 * Collect `{ field, value }` for every path a package.json declares.
 * `exports` is walked recursively: condition objects, subpath maps and the
 * array fallback form all bottom out in strings.
 */
export function declaredPaths(pkg) {
    const out = [];

    for (const field of ['main', 'module', 'types', 'typings', 'style', 'unpkg']) {
        if (isCheckablePath(pkg[field])) out.push({ field, value: pkg[field] });
    }
    // `browser` is either a single entry point or a remap table whose values may
    // be `false` or another module — only relative values are ours to check.
    if (typeof pkg.browser === 'string' && isCheckablePath(pkg.browser)) {
        out.push({ field: 'browser', value: pkg.browser });
    } else if (pkg.browser && typeof pkg.browser === 'object') {
        for (const [key, value] of Object.entries(pkg.browser)) {
            if (isCheckablePath(value)) out.push({ field: `browser[${JSON.stringify(key)}]`, value });
        }
    }

    if (typeof pkg.bin === 'string' && isCheckablePath(pkg.bin)) {
        out.push({ field: 'bin', value: pkg.bin });
    } else if (pkg.bin && typeof pkg.bin === 'object') {
        for (const [name, value] of Object.entries(pkg.bin)) {
            if (isCheckablePath(value)) out.push({ field: `bin[${JSON.stringify(name)}]`, value });
        }
    }

    // gjsify's own GJS-first bin map (`gjsify.bin`) is resolved by the CLI the
    // same way npm resolves `bin`, so it carries the same promise.
    const gjsifyBin = pkg.gjsify?.bin;
    if (typeof gjsifyBin === 'string' && isCheckablePath(gjsifyBin)) {
        out.push({ field: 'gjsify.bin', value: gjsifyBin });
    } else if (gjsifyBin && typeof gjsifyBin === 'object') {
        for (const [name, value] of Object.entries(gjsifyBin)) {
            if (isCheckablePath(value)) out.push({ field: `gjsify.bin[${JSON.stringify(name)}]`, value });
        }
    }

    // `gjsify.main` is the GJS-first twin of `main` — what `gjsify dlx` /
    // `gjsify showcase` load. It was omitted here while `gjsify.bin` was
    // checked, which reads as an oversight rather than a decision: both are
    // entry points the CLI resolves and both fail the same way.
    if (isCheckablePath(pkg.gjsify?.main)) out.push({ field: 'gjsify.main', value: pkg.gjsify.main });

    // The `--app node` bundle an example/showcase names for the node/bun/deno
    // runtimes. Missing, it surfaces to a user as
    //   Cannot run showcase "<x>" on deno: declared node entry not found
    // which reads as a broken package — because it is one.
    if (isCheckablePath(pkg.gjsify?.example?.node)) {
        out.push({ field: 'gjsify.example.node', value: pkg.gjsify.example.node });
    }

    const walkExports = (node, path) => {
        if (node === null || node === undefined) return;
        if (typeof node === 'string') {
            if (isCheckablePath(node)) out.push({ field: path, value: node });
            return;
        }
        if (Array.isArray(node)) {
            node.forEach((entry, i) => walkExports(entry, `${path}[${i}]`));
            return;
        }
        if (typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) walkExports(value, `${path}[${JSON.stringify(key)}]`);
        }
    };
    walkExports(pkg.exports, 'exports');

    return out;
}

/**
 * What must exist on disk for a declared value.
 *
 * A subpath PATTERN (`./assets/*`) has no single target, so the promise it can
 * still be held to is that the directory it globs into exists — a package that
 * exports `./assets/*` and ships no `assets/` is broken in exactly the way this
 * check is for.
 */
export function targetFor(pkgDir, value) {
    if (!value.includes('*')) return { abs: resolve(pkgDir, value), kind: 'file' };
    const staticPrefix = value.slice(0, value.indexOf('*'));
    const dir = posix.dirname(`${staticPrefix}x`);
    return { abs: resolve(pkgDir, dir), kind: 'dir' };
}

/**
 * The `--app node` bundle a package PROMISES by declaring a non-gjs runtime in
 * `gjsify.example.runtimes`, when it does not name one explicitly.
 *
 * `gjsify.example.runtimes` is the only declaration in this manifest that
 * promises an artifact WITHOUT naming its path: the CLI derives it from the GJS
 * entry (`dist/x.gjs.js` → `dist/x.node.mjs`, probing the three ESM
 * extensions), so "declares node but ships none" is invisible to a plain path
 * check. That is exactly the shape that shipped:
 * `@gjsify/example-dom-excalibur-jelly-jumper@0.23.0` declared all four
 * runtimes, its `build` script never called its own `build:node`, and the
 * tarball carried only `dist/gjs.js` — so `deno run npm:@gjsify/cli showcase
 * excalibur-jelly-jumper` died on a file that was promised and never built.
 *
 * Mirrors `resolveNodeEntry()` in `@gjsify/cli` (`utils/resolve-gjs-entry.ts`).
 * The two must agree: this is the check, that is the consumer.
 *
 * @returns `null` when nothing is promised (no declaration, gjs-only, or an
 *   explicit `gjsify.example.node` — which `declaredPaths` already covers),
 *   otherwise the promise and the paths that would satisfy it.
 */
export function impliedExampleNodeEntry(pkg) {
    const example = pkg.gjsify?.example;
    if (!example || typeof example !== 'object') return null;
    if (typeof example.node === 'string') return null;
    if (!Array.isArray(example.runtimes)) return null;

    const nonGjs = example.runtimes.filter((r) => typeof r === 'string' && r !== 'gjs');
    if (nonGjs.length === 0) return null;

    const gjsEntry =
        pkg.gjsify?.main ??
        (pkg.gjsify?.bin && typeof pkg.gjsify.bin === 'object' ? Object.values(pkg.gjsify.bin)[0] : undefined) ??
        pkg.main;
    if (typeof gjsEntry !== 'string' || gjsEntry.length === 0) {
        return { runtimes: nonGjs, candidates: [], reason: 'no GJS entry to derive a node bundle from' };
    }

    const stem = gjsEntry.replace(/\.gjs\.(js|mjs|cjs)$/, '').replace(/\.(js|mjs|cjs)$/, '');
    return { runtimes: nonGjs, candidates: [`${stem}.node.mjs`, `${stem}.node.js`, `${stem}.node.cjs`], reason: null };
}

/**
 * A static `import … from 'node:x'` — the one thing a `--app gjs` bundle can
 * never contain: GJS has no resolver for that URI scheme, so the module dies at
 * LOAD with `ImportError: Unsupported URI scheme for importing: node`. The gjs
 * target aliases every `node:` builtin to its `@gjsify/*` implementation, so a
 * correct bundle carries none.
 */
const NODE_SPECIFIER_IMPORT = /(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?from\s*["'`]node:[a-z_/]+["'`]/;

/**
 * Is the file at `abs` a GJS bundle, or a NODE bundle wearing its name?
 *
 * THE INCIDENT. `@gjsify/example-gtk-adwaita-storybook@0.37.0` shipped a
 * `dist/gjs.js` byte-identical to its `dist/gjs.node.mjs`: `build:gjs` ran
 * `gjsify storybook --build-only --out dist/gjs.js` with no `--runtime`, and
 * that flag defaults to the runtime the CLI is EXECUTING IN — node, in the
 * release job. A script named `build:gjs` therefore produced an `--app node`
 * bundle, wrote it to the GJS path and exited 0; the homepage's storybook slide
 * died on every Linux and arm64 gjs tab while the tarball, the manifest and the
 * build all looked correct. Nothing else could catch it — existence was checked,
 * the artifact was never compared against the TARGET it was named for.
 *
 * Cause-agnostic like the existence half: a missing `--runtime`, a copied file
 * and a mis-wired build script all land here without it knowing which happened.
 *
 * @returns `null` when the file is a plausible gjs bundle, otherwise why not.
 */
export function inspectGjsArtifact(abs, nodeAbs) {
    let source;
    try {
        source = readFileSync(abs, 'utf8');
    } catch {
        // Unreadable belongs to the EXISTENCE half; reporting it twice would make
        // one defect read as two. Same for the node entry below.
        return null;
    }
    if (NODE_SPECIFIER_IMPORT.test(source)) {
        return 'imports a `node:` builtin, which GJS cannot resolve — this is an `--app node` bundle';
    }
    if (nodeAbs && existsSync(nodeAbs)) {
        try {
            if (readFileSync(nodeAbs, 'utf8') === source) {
                return 'is byte-identical to the declared `--app node` bundle';
            }
        } catch {
            /* see above */
        }
    }
    return null;
}

/**
 * One finding as a line. Shared with `scripts/verify-package-outputs.mjs` so the
 * rule and the standalone script cannot word the same defect differently — they
 * did, once, and a `kind` added to one renderer read as nonsense in the other.
 */
export function formatMissing(m) {
    // `artifact` findings are about a file that EXISTS and is the wrong thing,
    // so "missing" would be a lie; their `path` already carries the sentence.
    const detail = m.kind === 'artifact' ? `wrong artifact: ${m.path}` : `missing ${m.kind}: ${m.path}`;
    return `    ${m.field} → ${m.value}   (${detail})`;
}

/**
 * Inspect every in-scope package and report which declared paths are missing.
 * Exported separately from the rule so the standalone entry script can render
 * its own `--json` payload from the same data.
 */
export function inspectDeclaredOutputs(ctx) {
    const opts = ctx.options?.packageOutputs ?? {};
    const excludeNamePatterns = opts.excludeNamePatterns ?? [];
    const includePrivate = opts.includePrivate === true;
    const results = [];

    for (const pkg of ctx.packages) {
        if (ctx.only.length === 0) {
            if (excludeNamePatterns.some((re) => re.test(pkg.name))) continue;
            if (pkg.private && !includePrivate) continue;
        }

        const missing = [];
        for (const { field, value } of declaredPaths(pkg.manifest)) {
            const { abs, kind } = targetFor(pkg.dir, value);
            if (existsSync(abs) && (kind === 'file' || statSync(abs).isDirectory())) continue;
            missing.push({ field, value, path: relative(ctx.root, abs), kind });
        }

        // A package with a `gjsify.main` is launchable by `gjsify showcase`, and the CLI
        // decides which runtimes it will accept from `gjsify.example.runtimes`. An ABSENT
        // declaration does not mean "gjs only" — `utils/runtimes.ts` treats it as
        // UNCONSTRAINED, so the CLI will happily try any requested runtime. That is the
        // inverse of every other declaration in this manifest, and it makes the question
        // "does this showcase run everywhere?" unanswerable: silence and "yes" look
        // identical.
        //
        // ZERO findings today, deliberately: all nine packages declaring `gjsify.main`
        // were surveyed, and the eight PUBLISHED ones each declare their runtimes. The
        // ninth (`@gjsify/example-gtk-node-gi-window`) is `private` and not a CLI
        // dependency, so `gjsify showcase` cannot resolve it by name and it has nothing
        // to declare — which is why the private carve-out above is load-bearing here
        // rather than merely inherited.
        //
        // So this is a guard, not a repair. It earns its place because the loophole is
        // real for the published ones: add a showcase, forget the declaration, and
        // `--runtime bun` is ACCEPTED and then dies in a bundle that was never built —
        // the same ending as `@gjsify/example-dom-excalibur-jelly-jumper@0.23.0`, which
        // declared four runtimes whose bundle its `build` never produced. That failure
        // has a check (`impliedExampleNodeEntry` below); its mirror image, declaring
        // nothing at all, did not.
        //
        // It lives in THIS rule rather than a new one because `gjsify.example` is already
        // claimed here and `impliedExampleNodeEntry` already reasons about exactly this
        // `gjsify.main` ↔ `gjsify.example` pair.
        //
        // In practice it fires under `verify-package-outputs.mjs --scope examples`, since
        // the default scope excludes `@gjsify/example-*` by name and inverting that
        // carve-out is what the examples scope exists for. Nothing else declares
        // `gjsify.main`, so the check is inert in the other scopes rather than partial.
        // Gated on `!private` EXPLICITLY, not inherited from the caller's
        // `includePrivate`: the declaration is required because the CLI resolves a
        // showcase BY NAME, which needs it published. A private workspace showcase is
        // launched by path and has nothing to declare, so `--include-private` must not
        // turn it into a finding — the message would then assert `gjsify showcase can
        // launch it` about a package that it cannot.
        if (
            !pkg.private &&
            typeof pkg.manifest.gjsify?.main === 'string' &&
            !Array.isArray(pkg.manifest.gjsify?.example?.runtimes)
        ) {
            missing.push({
                field: 'gjsify.example.runtimes',
                value: '(not declared)',
                path:
                    `declares gjsify.main (${pkg.manifest.gjsify.main}) so \`gjsify showcase\` can launch it, but names ` +
                    'no runtimes. An absent list reads as UNCONSTRAINED to the CLI, not as gjs-only — declare the ' +
                    'runtimes this showcase actually ships bundles for.',
                kind: 'declaration',
            });
        }

        // The one promise made without naming a path — see `impliedExampleNodeEntry`.
        const implied = impliedExampleNodeEntry(pkg.manifest);
        if (implied && !implied.candidates.some((c) => existsSync(resolve(pkg.dir, c)))) {
            missing.push({
                field: 'gjsify.example.runtimes',
                value: implied.runtimes.join(', '),
                path:
                    implied.candidates.length > 0
                        ? implied.candidates.map((c) => relative(ctx.root, resolve(pkg.dir, c))).join(' | ')
                        : implied.reason,
                kind: 'any-of',
            });
        }
        // The artifact half: a file declared for `gjs` must BE a gjs bundle.
        // Existence is not the contract — a node bundle at the GJS path exists
        // and resolves and fails at load. See `inspectGjsArtifact`.
        const gjsEntry = pkg.manifest.gjsify?.main;
        const runtimes = pkg.manifest.gjsify?.example?.runtimes;
        if (typeof gjsEntry === 'string' && Array.isArray(runtimes) && runtimes.includes('gjs')) {
            const gjsAbs = resolve(pkg.dir, gjsEntry);
            if (existsSync(gjsAbs)) {
                const nodeEntry =
                    pkg.manifest.gjsify?.example?.node ?? impliedExampleNodeEntry(pkg.manifest)?.candidates?.[0];
                const wrong = inspectGjsArtifact(
                    gjsAbs,
                    typeof nodeEntry === 'string' ? resolve(pkg.dir, nodeEntry) : undefined,
                );
                if (wrong) {
                    missing.push({
                        field: 'gjsify.main',
                        value: gjsEntry,
                        path: `${relative(ctx.root, gjsAbs)} ${wrong}`,
                        kind: 'artifact',
                    });
                }
            }
        }

        results.push({
            dir: pkg.rel,
            name: pkg.name,
            missing,
            // Printed on failure so the reader knows what to re-run, without
            // this rule needing a map of which script owns which output.
            scripts: Object.fromEntries(
                Object.entries(pkg.manifest.scripts ?? {}).filter(
                    ([key]) => key === 'build' || key.startsWith('build:'),
                ),
            ),
        });
    }
    return results;
}

export const packageOutputsRule = defineRule({
    id: 'package-outputs',
    scope: 'portable',
    fields: [
        'main',
        'module',
        'types',
        'typings',
        'style',
        'unpkg',
        'browser',
        'bin',
        'exports',
        'gjsify.bin',
        'gjsify.main',
        'gjsify.example',
    ],
    description: 'every path a package.json declares (main/exports/types/bin/gjsify.{bin,main,example}) exists on disk',
    run(ctx) {
        const results = inspectDeclaredOutputs(ctx);
        const broken = results.filter((r) => r.missing.length > 0);
        const totalMissing = broken.reduce((n, r) => n + r.missing.length, 0);

        const failures = [];
        for (const r of broken) {
            const lines = [`${r.name} (${r.dir}) declares ${r.missing.length} path(s) that do not hold:`];
            for (const m of r.missing) lines.push(formatMissing(m));
            const scripts = Object.keys(r.scripts);
            if (scripts.length > 0) {
                lines.push(`    produced by: ${scripts.map((s) => `gjsify workspace ${r.name} ${s}`).join(' · ')}`);
            }
            failures.push(lines.join('\n'));
        }

        if (failures.length > 0 && ctx.allowUnbuilt) {
            return {
                failures: [],
                notes: [
                    `${totalMissing} declared path(s) missing across ${broken.length} package(s) — ` +
                        'tolerated (--allow-unbuilt). Run a full build and re-check.',
                ],
                stats: { checked: results.length, broken: broken.length, totalMissing },
                results,
            };
        }

        return {
            failures,
            notes:
                failures.length > 0
                    ? [
                          'A build that leaves a declared entry point unwritten still exits 0 — most often a ' +
                              '`.tsbuildinfo` that outlived its output tree, which makes `gjsify tsc` a silent no-op. ' +
                              "Delete the package's build info (its `clear` script does) and rebuild, then fix the " +
                              'declaration or the build script so it cannot recur.',
                      ]
                    : [],
            summary: `package-outputs: OK. ${results.length} package(s) checked; every declared entry point exists.`,
            stats: { checked: results.length, broken: broken.length, totalMissing },
            results,
        };
    },
});
