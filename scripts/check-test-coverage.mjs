#!/usr/bin/env node
// Report per-package source-file ↔ spec-file coverage gaps.
//
// "Covered" means: for every impl file `src/<name>.ts` there exists EITHER
//   (a) a sibling spec file `src/<name>.spec.ts` / `src/<name>.gjs.spec.ts`
//       / `src/<name>.browser.spec.ts`, OR
//   (b) some sibling `*.spec.ts` imports the impl file with one of
//       `from './<name>'` / `from './<name>.js'`.
//
// Structural on purpose: it catches an impl file added with no spec at all, and
// says nothing about assertion or branch coverage.
//
// Usage:
//   node scripts/check-test-coverage.mjs              # per-package summary
//   node scripts/check-test-coverage.mjs --verbose    # also list uncovered files
//   node scripts/check-test-coverage.mjs --strict     # exit 1 if any uncovered
//
// Scans `packages/{node,web,dom,framework,gjs,infra}/*/src/**/*.ts`.

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, basename, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PILLAR_DIRS = ['node', 'web', 'dom', 'framework', 'gjs', 'infra'];

const args = new Set(process.argv.slice(2));
const VERBOSE = args.has('--verbose') || args.has('-v');
const STRICT = args.has('--strict');

/** Files whose names never need a spec (entry points, type-only, register barrels). */
const SKIP_FILE_PATTERNS = [
    /^index\.ts$/,
    /^test\.mts$/,
    /^test\.browser\.mts$/,
    /^cjs-compat\.cjs$/,
    /\.d\.ts$/,
    /\.spec\.ts$/,
    /\.gjs\.spec\.ts$/,
    /\.browser\.spec\.ts$/,
    /\.test\.ts$/,
    /-types?\.ts$/, // type-only files (e.g. dom-types.ts, cairo-types.ts)
    /^types\.ts$/,
    /^constants\.ts$/, // const-only files
    /\.d\.mts$/,
];

async function* walk(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__fixtures__' || entry.name === 'fixtures') continue;
            yield* walk(path);
        } else if (entry.isFile()) {
            yield path;
        }
    }
}

function shouldSkip(filename) {
    return SKIP_FILE_PATTERNS.some((re) => re.test(filename));
}

/** Whether any sibling spec imports `implPath`. `specCache` reads each spec once. */
async function isCoveredByImport(implPath, siblingSpecs, specCache) {
    const name = basename(implPath, '.ts');
    const needles = [`./${name}'`, `./${name}.js'`, `./${name}"`, `./${name}.js"`];
    for (const spec of siblingSpecs) {
        let body = specCache.get(spec);
        if (body === undefined) {
            body = await readFile(spec, 'utf8');
            specCache.set(spec, body);
        }
        if (needles.some((n) => body.includes(n))) return true;
    }
    return false;
}

async function analysePackage(packageDir) {
    const srcDir = join(packageDir, 'src');
    try {
        const s = await stat(srcDir);
        if (!s.isDirectory()) return null;
    } catch {
        return null;
    }

    const allFiles = [];
    for await (const path of walk(srcDir)) {
        allFiles.push(path);
    }

    const implFiles = [];
    const specsByDir = new Map();
    for (const path of allFiles) {
        const name = basename(path);
        const dir = dirname(path);
        if (name.endsWith('.spec.ts')) {
            const list = specsByDir.get(dir) ?? [];
            list.push(path);
            specsByDir.set(dir, list);
        } else if (name.endsWith('.ts') && !shouldSkip(name)) {
            implFiles.push(path);
        }
    }

    const specCache = new Map();
    const uncovered = [];
    for (const impl of implFiles) {
        const name = basename(impl, '.ts');
        const dir = dirname(impl);
        const siblings = specsByDir.get(dir) ?? [];

        const hasMatchingSpec = siblings.some((s) => {
            const sn = basename(s);
            return sn === `${name}.spec.ts` || sn === `${name}.gjs.spec.ts` || sn === `${name}.browser.spec.ts`;
        });

        if (hasMatchingSpec) continue;
        if (await isCoveredByImport(impl, siblings, specCache)) continue;
        uncovered.push(impl);
    }

    return {
        package: relative(ROOT, packageDir),
        implCount: implFiles.length,
        specCount: [...specsByDir.values()].reduce((a, v) => a + v.length, 0),
        uncoveredCount: uncovered.length,
        uncovered,
    };
}

async function main() {
    const results = [];
    for (const pillar of PILLAR_DIRS) {
        const pillarDir = join(ROOT, 'packages', pillar);
        let entries;
        try {
            entries = await readdir(pillarDir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const result = await analysePackage(join(pillarDir, entry.name));
            if (result) results.push(result);
        }
    }

    results.sort((a, b) => a.package.localeCompare(b.package));

    let totalImpl = 0,
        totalSpec = 0,
        totalUncovered = 0;
    console.log('package                                          impl  spec  uncov  status');
    console.log('-------------------------------------------------------------------------');
    for (const r of results) {
        totalImpl += r.implCount;
        totalSpec += r.specCount;
        totalUncovered += r.uncoveredCount;
        const status = r.uncoveredCount === 0 ? 'OK' : `${r.uncoveredCount} missing`;
        const pkg = r.package.padEnd(48);
        const impl = String(r.implCount).padStart(4);
        const spec = String(r.specCount).padStart(5);
        const uncov = String(r.uncoveredCount).padStart(6);
        console.log(`${pkg} ${impl} ${spec} ${uncov}  ${status}`);
        if (VERBOSE && r.uncoveredCount > 0) {
            for (const path of r.uncovered) {
                console.log(`    · ${relative(ROOT, path)}`);
            }
        }
    }
    console.log('-------------------------------------------------------------------------');
    console.log(`TOTAL: ${results.length} packages, ${totalImpl} impl, ${totalSpec} spec, ${totalUncovered} uncovered`);

    if (STRICT && totalUncovered > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
