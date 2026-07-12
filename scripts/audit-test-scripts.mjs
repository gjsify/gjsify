#!/usr/bin/env node
// Guards that every workspace package which ships a per-runtime test leg
// (`test:gjs` / `test:node`) actually RUNS it from its `test` script.
//
// Rationale: three separate times a package shipped a `test:gjs` (or built its
// node test bundle) that its `test` script never invoked — so `gjsify foreach
// test` (CI's main path) silently skipped that runtime's suite entirely
// (fetch/formdata/webcrypto lost their GJS leg; abort-controller/adwaita-app/
// storybook-core built but never ran their node leg). This turns that recurring
// class of bug into a hard CI failure. `test:browser` is intentionally exempt —
// it runs via the Playwright axis in tests/browser, not per-package `test`.
//
// Pure Node, zero deps — mirrors scripts/audit-runtimes.mjs so it runs on the
// plain runner in .github/workflows/audit-runtimes.yml.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Scoped to the surfaces CI's `gjsify foreach test` + the integration/e2e
// runners actually cover. `examples/` and `showcases/` are excluded from
// `foreach test` (`--exclude "@gjsify/example-*"`) and run via dedicated,
// affected-gated CI steps; several of them share the same unwired-leg pattern
// (a live-server GJS test) but gating CI on those risks flakiness — tracked as
// a separate cleanup, not enforced here.
const ROOTS = ['packages', 'tests'];
const LEGS = ['test:gjs', 'test:node'];
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'lib', '.git', 'fixtures']);
// packages/node-gi is the Axis-5 GI engine with its OWN test pipeline
// (node-gi.yml), not a standard gjsify workspace — exempt (see AGENTS.md).
const IGNORE_PKG_PREFIX = ['packages/node-gi'];

function findPkgJsons(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            if (IGNORE_DIRS.has(e.name)) continue;
            findPkgJsons(full, out);
        } else if (e.name === 'package.json') {
            out.push(full);
        }
    }
    return out;
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
            if (scripts[leg] && !test.includes(leg)) {
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
