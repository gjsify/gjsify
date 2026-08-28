#!/usr/bin/env node
// Guards that every workspace package which ships a per-runtime test leg
// (`test:gjs` / `test:node`) actually RUNS it from its `test` script.
//
// Three separate times a package shipped a `test:gjs` (or built its node test
// bundle) that its `test` script never invoked, so `gjsify foreach test` — CI's
// main path — silently skipped that runtime entirely: fetch/formdata/webcrypto
// lost their GJS leg, abort-controller/adwaita-app/storybook-core built but never
// ran their node leg. `test:browser` is exempt: it runs via the Playwright axis in
// tests/browser, not per-package `test`.

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// Scoped to the surfaces CI's `gjsify foreach test` + the integration/e2e runners
// actually cover. `examples/` and `showcases/` are excluded from `foreach test`
// (`--exclude "@gjsify/example-*"`) and run via dedicated affected-gated steps;
// several share the same unwired-leg pattern, but gating on them risks flakiness.
const ROOTS = ['packages', 'tests'];
const LEGS = ['test:gjs', 'test:node'];
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'lib', '.git', 'fixtures']);
// packages/node-gi is the axis-5 GI engine with its OWN pipeline (node-gi.yml),
// not a standard gjsify workspace — exempt (see AGENTS.md). Spelled with `/`, like
// every path compared against it (see `posixPath`): in the host spelling the
// exemption is a no-op on Windows, where the script then fails on the one package
// it is written to ignore while Linux stays green.
const IGNORE_PKG_PREFIX = ['packages/node-gi'];

/**
 * A repo-relative path in the one spelling this script compares against.
 *
 * `path.join()` answers in `path.sep`, so on Windows this produced
 * `packages\node-gi\node-gi\package.json` against an `IGNORE_PKG_PREFIX` of
 * `packages/node-gi`: the exemption never fired and `@gjsify/node-gi` was
 * reported as violating a rule it is exempt from. Windows accepts forward slashes,
 * so normalising where the path is produced also makes the reported path identical
 * on both platforms.
 *
 * `split(sep).join('/')`, not `replaceAll('\\','/')`: a backslash is a legal
 * character in a POSIX filename, and rewriting it there would corrupt a path.
 */
function posixPath(p) {
    return p.split(sep).join('/');
}

function findPkgJsons(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = posixPath(join(dir, e.name));
        if (e.isDirectory()) {
            if (IGNORE_DIRS.has(e.name)) continue;
            findPkgJsons(full, out);
        } else if (e.name === 'package.json') {
            out.push(full);
        }
    }
    return out;
}

/**
 * Does `test` invoke `leg` — as opposed to merely CONTAINING its name?
 *
 * `test.includes('test:node')` was the whole test, and `build:test:node` contains
 * `test:node`. That pairing is the tree's dominant idiom
 * (`"test": "gjsify run build:test:node && gjsify run test:node"`), so deleting the second
 * half of it left this gate printing OK over a suite that no longer ran — measured on
 * `packages/infra/cli`, the largest node suite in the repo. Building a bundle is not
 * running it, which is the distinction this script's own founding incident is about
 * ("abort-controller/adwaita-app/storybook-core built but never ran their node leg").
 */
function runsLeg(test, leg) {
    return new RegExp(`(?<![\\w:-])${leg}(?![\\w:-])`).test(test);
}

const violations = [];
for (const root of ROOTS) {
    for (const pkgPath of findPkgJsons(root)) {
        if (IGNORE_PKG_PREFIX.some((p) => pkgPath === `${p}/package.json` || pkgPath.startsWith(`${p}/`))) continue;
        let pkg;
        try {
            pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        } catch {
            continue;
        }
        const scripts = pkg.scripts || {};
        const test = scripts.test || '';
        for (const leg of LEGS) {
            if (scripts[leg] && !runsLeg(test, leg)) {
                violations.push({ name: pkg.name || pkgPath, pkgPath, leg });
            }
        }
    }
}

if (violations.length) {
    console.error(
        `audit-test-scripts: ${violations.length} package(s) declare a test leg their \`test\` script does not run:\n`,
    );
    for (const v of violations) {
        console.error(`  ✗ ${v.name} — has "${v.leg}" but \`test\` omits it  (${v.pkgPath})`);
    }
    console.error(
        `\nAdd \`&& gjsify run <leg>\` to each \`test\` script (or delete the unused \`<leg>\`).` +
            `\n\`test:browser\` is exempt — it runs via the Playwright axis in tests/browser.`,
    );
    process.exit(1);
}
console.log('audit-test-scripts: OK. Every package runs its declared test:gjs / test:node legs from `test`.');
