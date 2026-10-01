/**
 * The workspace packages the BUNDLER TOOLCHAIN resolves OFF DISK — the one fact
 * three readers used to keep separately, and the two hand-kept facts that carve
 * it down to what a cold `build:infra` actually owes.
 *
 * WHY THE FACT EXISTS AT ALL. The GJS bundle INLINES these packages, so the
 * toolchain cannot statically import a sibling: a static edge would cost a
 * bootable CLI, and for `@gjsify/utils` it would give the process a second copy
 * of `main-loop`'s module-level singleton. So it `createRequire(import.meta.url)
 * .resolve('<specifier>')`s one instead and imports the result. `import.meta.url`
 * there is the CLI's OWN bundle, so the walk follows the WORKSPACE
 * `node_modules` — and on a cold checkout the workspace copy's `lib/esm` is a
 * BUILD OUTPUT. `build:infra` must therefore emit it before the first clause
 * that reaches `gjsify build`. #1901 put the `@gjsify/utils` edge on the SUCCESS
 * path of `tryLoadNative()`, and v0.53.0's cold `publish-napi` job died on it.
 *
 * THE READERS, and why one scan serves all three:
 *
 *   · `scripts/check-build-infra-order.mjs` rule 5 — ORDER: is the JavaScript
 *     emitted before the first bundler clause?
 *   · `scripts/bootstrap-native-facades.mjs` — the EMIT: `CLI_RUNTIME_DEPS` is
 *     what it tsc-builds before it spawns a CLI, so the scan is what holds that
 *     declared list honest.
 *   · `tests/e2e/bootstrap-cold-tree` — the check on that declaration.
 *
 * Two of the three hand-kept the answer themselves, which is the shape the
 * incident had: the list said `utils` was not needed, the list's own guard could
 * not see the edge, and the list's path spelling could not even express it
 * (`packages/infra/<name>`, and utils lives in `packages/gjs/`).
 *
 * WHY THE SCAN IS NOT A MANIFEST WALK. The dependency is real and UNDECLARED on
 * the edge that uses it — `@gjsify/rolldown-native` must NOT import
 * `@gjsify/utils` (its own header says so: the GJS loader resolves no bare
 * specifier in a file-URL import) — so the edge exists only as a resolve CALL in
 * the consumer, and no manifest rule can reach it.
 *
 * THE TWO SHAPES, because one of them is what a refactor produces. A literal
 * specifier and a `const` one resolved by name both occur in the tree today, and
 * a guard that reads only the first is a guard that a well-meaning edit turns
 * off: moving the specifier into a `const` (to keep tsc and Rolldown from
 * resolving an optional peer at build time — `css-as-string.ts` says exactly
 * that) leaves the edge byte-identical and the guard silent.
 *
 * `node:` only, and no dependency on a built `lib/`, so a cold tree can read it.
 */

import { readFileSync, readdirSync } from 'node:fs';

// Roots whose sources run inside `gjsify build`. The union, not the per-root
// reports: `@gjsify/rolldown-plugin-gjsify` is in the CLI's own production
// closure, so scanning per root would name its findings twice.
export const TOOLCHAIN_ROOTS = ['@gjsify/cli', '@gjsify/rolldown-plugin-gjsify'];

/**
 * The native facades `scripts/bootstrap-native-facades.mjs` builds ITSELF, and
 * which are therefore emitted by the `node scripts/bootstrap-native-facades.mjs`
 * clause of `build:infra` — before every bundler clause, which rule 1 of
 * `check-build-infra-order.mjs` already holds. Listed here because both readers
 * need the same carve-out and one of them OWNS the build.
 */
export const FACADE_PACKAGES = ['@gjsify/rolldown-native', '@gjsify/lightningcss-native'];

/**
 * Resolved off disk, yet NOTHING in `build:infra` owes them an emit — each with
 * the reason, because an exemption without one is a blanket.
 *
 * A name here is a CLAIM about this tree, so it is falsifiable: a reader that
 * stops exempting it (because the package gained a `build:infra` clause, or
 * because the edge it was exempting for is gone) is a change this file must
 * make in the same PR. `check-build-infra-order.mjs` prints the reason next to
 * the count so a stale one is visible instead of silent.
 */
export const EMIT_NOT_OWED = {
    '@gjsify/oxfmt-native': {
        name: '@gjsify/oxfmt-native',
        reason:
            'reached only from `gjsify format` (`oxc-resolve.ts`’s `tryLoadNativeOxfmt`), which no `build:infra` ' +
            'clause runs — so a cold tree reaches it through `gjsify format` alone, and the npm `oxfmt` ' +
            'fallback is what answers until then',
    },
    '@gjsify/tsc': {
        name: '@gjsify/tsc',
        reason:
            '`@gjsify/tsc/bundle` is served from OUTSIDE this workspace: the `gjsify` on PATH during a cold ' +
            'bootstrap is the PUBLISHED one `gjs -m install.mjs` put in its own prefix (ADR 0002), and that ' +
            'prefix carries a built `@gjsify/tsc`. Measured: v0.53.0’s cold `publish-napi` tree ran a ' +
            '`gjsify tsc` clause and got past it with `packages/infra/tsc/dist/` unbuilt. This package’s own ' +
            '`build` is `node scripts/build-bundle.mjs`, so a `tsc` emit would not produce the bundle anyway',
    },
};

/** Every hand-kept exemption as `name -> reason`, for lookup and for the reports. */
export const NOT_OWED = new Map(Object.values(EMIT_NOT_OWED).map((e) => [e.name, e.reason]));

/** A source file a `gjsify build` of the toolchain actually ships. */
const SOURCE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

/**
 * Test and bundle-only sources: they never reach the published JavaScript the
 * bundler runs, and no `build:infra` clause loads one. A spec is a fixture —
 * `app-runtime.spec.ts` names `@gjsify/node-gi` to assert a staging report.
 */
const NOT_SHIPPED = /\.(?:spec|test)\.[cm]?[jt]sx?$|(?:^|\/)test\.[cm]?tsx?$/;

/**
 * Shape A: the literal, resolved on the spot.
 *
 * `createRequire` on the line is what makes it a RESOLUTION rather than a
 * `resolve…(…)` helper over version strings, and `import.meta.url` on the same
 * line is what makes the walk follow the WORKSPACE — the property the whole rule
 * turns on, so it is what the pattern requires rather than infers.
 */
const RESOLVE_LITERAL = /createRequire\([^)]*\)\s*\.\s*resolve\(\s*'(@gjsify\/[^']+)'/g;

/** Shape B: `const specifier = '@gjsify/<x>'`, resolved by name further down. */
const SPECIFIER_DECL = /const\s+([A-Za-z_$][\w$]*)\s*=\s*'(@gjsify\/[^']+)'/g;

/** name -> { dir } for every manifest under `packages/<group>/<pkg>/`. */
function packageIndex(root) {
    const byName = new Map();
    const base = `${root}/packages`;
    let groups;
    try {
        groups = readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => `${base}/${d.name}`);
    } catch {
        return byName;
    }
    for (const group of groups) {
        let entries;
        try {
            entries = readdirSync(group, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dir = `${group}/${entry.name}`;
            let json;
            try {
                json = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
            } catch {
                continue; // a manifest that does not parse is check-manifests' problem
            }
            if (json.name) byName.set(json.name, dir);
        }
    }
    return byName;
}

/**
 * Production closure of a package — what `-d` builds before the clause itself.
 * `optionalDependencies` count (that is how `buildDependencyGraph()` reads them);
 * `devDependencies` do not, and a dev edge is not something the published CLI
 * resolves at RUN time.
 */
function productionClosure(name, byName, seen = new Set()) {
    if (seen.has(name)) return seen;
    seen.add(name);
    const dir = byName.get(name);
    if (!dir) return seen;
    let json;
    try {
        json = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    } catch {
        return seen;
    }
    for (const dep of Object.keys({ ...json.dependencies, ...json.optionalDependencies })) {
        if (byName.has(dep)) productionClosure(dep, byName, seen);
    }
    return seen;
}

function sourceFiles(dir) {
    const out = [];
    const walk = (at) => {
        let entries;
        try {
            entries = readdirSync(at, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = `${at}/${entry.name}`;
            if (entry.isDirectory()) walk(path);
            else if (SOURCE.test(entry.name)) out.push(path);
        }
    };
    walk(dir);
    return out;
}

/** `'@gjsify/foo/bar'` -> `'@gjsify/foo'`; npm keeps the name to two segments. */
function packageNameOf(specifier) {
    return specifier.split('/').slice(0, 2).join('/');
}

/**
 * Every workspace specifier the toolchain resolves off disk.
 *
 * `root` is a repo root, so the same call works on this tree and on a fixture
 * tree the e2e builds — which is also why the package location is read from the
 * manifest index rather than spelled `packages/infra/<name>`.
 *
 * Returns `{ deps, scanned, toolchain }`:
 *   · `deps`      — `name -> { spec, file }`, the FIRST site found per name
 *   · `scanned`   — how many toolchain packages had at least one site, so a
 *                   reader can refuse a scan that resolved nothing (see the
 *                   `toolchainScanned` refusal in `check-build-infra-order.mjs`)
 *   · `toolchain` — the package names the scan covered
 */
export function offDiskToolchainDeps(root) {
    const byName = packageIndex(root);
    const toolchain = new Set();
    for (const toolRoot of TOOLCHAIN_ROOTS) {
        for (const name of productionClosure(toolRoot, byName)) toolchain.add(name);
    }
    const deps = new Map();
    let scanned = 0;
    for (const name of [...toolchain].sort()) {
        const dir = byName.get(name);
        if (!dir) continue;
        let foundHere = false;
        for (const file of sourceFiles(`${dir}/src`)) {
            if (NOT_SHIPPED.test(file)) continue;
            let src;
            try {
                src = readFileSync(file, 'utf8');
            } catch {
                continue;
            }
            // The anchor that makes the walk follow the workspace. Without it the
            // pattern would also match a `resolve…(…)` helper over version
            // strings, and the rule would cry wolf on every package that has one.
            if (!src.includes('import.meta.url')) continue;
            const sites = [];
            for (const m of src.matchAll(RESOLVE_LITERAL)) sites.push(m[1]);
            for (const m of src.matchAll(SPECIFIER_DECL)) {
                // Shape B, same FILE: the specifier is named once and handed to a
                // resolver later. A `.resolve(<that name>)` anywhere in the file is
                // the site; the walker below keeps the binding site as the record,
                // because that is the line a reader has to change.
                const call = new RegExp(`\\.\\s*resolve\\(\\s*${m[1]}\\s*\\)`);
                if (call.test(src)) sites.push(m[2]);
            }
            for (const specifier of sites) {
                foundHere = true;
                const name2 = packageNameOf(specifier);
                if (!deps.has(name2)) {
                    deps.set(name2, { spec: specifier, file: file.slice(`${root}/`.length) });
                }
            }
        }
        if (foundHere) scanned++;
    }
    return { deps, scanned, toolchain };
}
