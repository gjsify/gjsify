// E2E: a bundle that imports ONE accent colour carries no Gio resource registry.
//
// THE INCIDENT (#2321). `import { adwaitaAccentBgColor } from '@gjsify/adwaita-core'`
// pulled `gio-resource.js` into the bundle, because the barrel re-exports it and
// nothing told the bundler that the registry claim is the ONLY side effect in the
// package. `gio-resource.js` runs `claimResourceRegistry(globalThis)` at load,
// which THROWS when the module evaluates a second time in one realm:
//
//   A second copy of the Gio resource registry was loaded: @gjsify/adwaita-core
//   must be in the bundle once (ADR 0116 § 3).
//
// beifahrer's page agent is a classic IIFE script injected into a page before
// every request: since the 0.64 bump every second call on one document failed
// (JumpLink/beifahrer#138). The consumer wanted a colour table and paid for a
// registry.
//
// WHAT IS JUDGED. The bundle's CONTENT, not the package's exports:
//
//   1. the barrel import of one accent colour → NO `claimResourceRegistry`;
//   2. the `./accent` SUBPATH import           → NO `claimResourceRegistry`;
//   3. a bundle that USES the registry         → the claim IS there, because
//      ADR 0116 § 3 still has to catch two registries answering differently.
//
// (3) is what keeps (1) from being a lie: the fix drops the claim from a bundle
// that never asks for a resource, not from the registry itself.
//
// The suite runs the IN-TREE CLI (no packing, no npm install) and needs
// `@gjsify/adwaita-core` BUILT — the bundle resolves the workspace package
// through the repo's own `node_modules`, exactly as a consumer would resolve
// the published one through its own.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { e2eSkipReason } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI = join(REPO_ROOT, 'node_modules', '.bin', 'gjsify');
const PACKAGE = join(REPO_ROOT, 'packages', 'web', 'adwaita-core');
const BUILT_ACCENT = join(PACKAGE, 'lib', 'esm', 'accent.js');

// The probe lives INSIDE the repo: the bundler resolves `@gjsify/adwaita-core`
// from the importer's directory upwards, and only the repo tree carries the
// workspace symlink. `tmp/` is gitignored.
const PROBE_DIR = join(REPO_ROOT, 'tmp', 'e2e-adwaita-accent-bundle');

/** The registry claim, as it appears in a built bundle. */
const CLAIM = 'claimResourceRegistry';

/** The blue accent background — the value the probes import. */
const BLUE = '3584e4';

const SKIP = e2eSkipReason('adwaita-accent-bundle', [
    ['the in-tree gjsify CLI', existsSync(CLI)],
    ['a built @gjsify/adwaita-core', existsSync(BUILT_ACCENT)],
]);

/** Build one probe and return the bundle's source. */
function bundle(entry) {
    const outfile = join(PROBE_DIR, `${entry}.bundle.mjs`);
    execFileSync(
        CLI,
        ['build', join(PROBE_DIR, `${entry}.ts`), '--app', 'browser', '--no-minify', '--outfile', outfile],
        {
            cwd: REPO_ROOT,
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 4 * 60 * 1000,
        },
    );
    return readFileSync(outfile, 'utf-8');
}

/**
 * Evaluate one bundle TWICE in one realm — what an injected page script does on
 * every request. The second evaluation is the one that used to throw.
 */
async function evaluateTwice(source) {
    const payload = Buffer.from(source).toString('base64');
    await import(`data:text/javascript;base64,${payload}#first`);
    await import(`data:text/javascript;base64,${payload}#second`);
}

describe('an accent-only bundle carries no Gio resource registry (E2E)', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    before(() => {
        if (SKIP) return;
        mkdirSync(PROBE_DIR, { recursive: true });
        writeFileSync(
            join(PROBE_DIR, 'barrel.ts'),
            "import { adwaitaAccentBgColor } from '@gjsify/adwaita-core';\nconsole.log(adwaitaAccentBgColor('blue'));\n",
        );
        writeFileSync(
            join(PROBE_DIR, 'accent.ts'),
            "import { adwaitaAccentBgColor } from '@gjsify/adwaita-core/accent';\nconsole.log(adwaitaAccentBgColor('blue'));\n",
        );
        writeFileSync(
            join(PROBE_DIR, 'registry.ts'),
            "import { resources_register } from '@gjsify/adwaita-core';\nconsole.log(typeof resources_register);\n",
        );
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && !SKIP) rmSync(PROBE_DIR, { recursive: true, force: true });
    });

    it('the barrel import of one accent colour carries no registry claim', () => {
        const out = bundle('barrel');
        assert.ok(out.includes(BLUE), 'the accent colour must survive — the bundle is measured, not emptied');
        assert.ok(
            !out.includes(CLAIM),
            `a bundle that imports one accent colour must not carry ${CLAIM} — it is the module that throws on a second evaluation (#2321)`,
        );
    });

    it('the ./accent SUBPATH import carries no registry claim either', () => {
        const out = bundle('accent');
        assert.ok(out.includes(BLUE), 'the accent colour must survive — the bundle is measured, not emptied');
        assert.ok(!out.includes(CLAIM), `the ./accent subpath must stay side-effect-free (#2321)`);
    });

    it('a bundle that USES the registry still carries the claim (ADR 0116 § 3 survives)', () => {
        const out = bundle('registry');
        assert.ok(
            out.includes(CLAIM),
            `a consumer of the registry must keep the claim — two copies answering differently is what ADR 0116 § 3 catches`,
        );
    });

    it('evaluating the accent-only bundle twice in one realm does not throw', async () => {
        await evaluateTwice(bundle('barrel'));
    });
});
