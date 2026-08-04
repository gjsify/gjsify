// E2E test for the two halves of the GTK-runtime release gate:
// `packages/node-gi/scripts/verify-bundle-manifest.mjs` (the gate itself) and
// `scripts/check-workflow-inline-scripts.mjs` (the guard that keeps it a script).
//
// WHY THIS SUITE EXISTS
//
// `release.yml` triggers on `release` / `workflow_dispatch` only. Nothing on a pull
// request has ever executed its steps, which is how the bundle gate shipped DEAD: two
// inline `node -e '…'` blocks — one bash, one pwsh — each ending in
//
//     … data sets ${verified.map((v) => v.id).join('+')}`);
//
// inside a single-quoted shell string. The shell closed the body at the quote before
// `+`, node received `join(+)` and died with `SyntaxError: Unexpected token ')'`
// before evaluating one assertion. All three v0.28.0 `@gjsify/gtk-runtime-*` publish
// legs failed there while every bundle they gated was CORRECT (darwin-arm64
// `windowing: true`, `dataBytes: 20247017`, 25 backed typelibs, 65 license texts;
// win32-x64 the same shape at 5628218 / 37). `cli`, `node-gi` and `napi` went out at
// 0.28.0; the three bundles stayed at 0.27.1 — the one version whose defects that
// gate had just been written to prevent shipping.
//
// So this suite IS the pre-release coverage: it is the only place either script runs
// before a release exercises it for real. It deliberately asserts the FAILURE paths,
// because a gate that cannot fail is what 0.27.1 shipped behind.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/release-bundle-gate/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const VERIFY = join(MONOREPO_ROOT, 'packages', 'node-gi', 'scripts', 'verify-bundle-manifest.mjs');
const GUARD = join(MONOREPO_ROOT, 'scripts', 'check-workflow-inline-scripts.mjs');

/** The measured shape of a good v0.28.0 darwin-arm64 bundle manifest. */
function goodManifest(overrides = {}) {
    return {
        platform: `${process.platform}-${process.arch}`,
        windowing: true,
        dataBytes: 20247017,
        typelibSymmetry: { backed: 25, dropped: 6 },
        licenses: { texts: 65 },
        windowingData: {
            verified: [
                { id: 'schemas', files: 1 },
                { id: 'icons', files: 863 },
                { id: 'gtksource', files: 6 },
            ],
        },
        ...overrides,
    };
}

function runVerify(manifest, extraArgs = []) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-bundle-gate-'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, [VERIFY, '--bundle', dir, ...extraArgs], {
        encoding: 'utf8',
    });
    return { ...result, output: `${result.stdout}${result.stderr}` };
}

function runGuard(workflowFiles) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-inline-guard-'));
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(workflowFiles)) writeFileSync(join(dir, name), body);
    const result = spawnSync(process.execPath, [GUARD, '--root', root], { encoding: 'utf8' });
    return { ...result, output: `${result.stdout}${result.stderr}` };
}

describe('verify-bundle-manifest: the release gate', () => {
    it('accepts a complete windowing bundle', () => {
        const result = runVerify(goodManifest());
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /clean — windowing superset/);
        assert.match(result.stdout, /25 backed typelibs/);
        assert.match(result.stdout, /65 license texts/);
    });

    it('rejects the v0.27.1 display-free bundle on every count it shipped wrong', () => {
        // Verbatim the shape published as 0.27.1: display-free, so no runtime data, no
        // recorded typelib symmetry (it shipped Adw-1.typelib with no libadwaita) and
        // no license texts beside 37-45 relocated LGPL/MPL/GPL libraries.
        const result = runVerify({ platform: `${process.platform}-${process.arch}`, windowing: false, dataBytes: 0 });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /FAILED 4 check\(s\)/);
        assert.match(result.stderr, /windowing=false dataBytes=0/);
        assert.match(result.stderr, /no verified typelib symmetry/);
        assert.match(result.stderr, /no license texts/);
        assert.match(result.stderr, /no verified windowing data sets/);
    });

    it('rejects a declared data set that holds no files', () => {
        // A directory that exists and is empty is the same missing signal as an absent
        // one — and is what 0.27.1's `share/` would have been had it existed at all.
        const result = runVerify(goodManifest({ windowingData: { verified: [{ id: 'icons', files: 0 }] } }));
        assert.equal(result.status, 1);
        assert.match(result.stderr, /verified windowing data sets with no files/);
        assert.match(result.stderr, /"id":"icons"/);
    });

    it('rejects a bundle built for another architecture than the host', () => {
        const result = runVerify(goodManifest({ platform: 'darwin-ppc64' }), [
            '--expect-host-target',
            process.platform,
        ]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /manifest says platform=darwin-ppc64/);
    });

    it('rejects verifying a foreign-OS bundle on this runner', () => {
        const foreign = process.platform === 'win32' ? 'darwin' : 'win32';
        const result = runVerify(goodManifest(), ['--expect-host-target', foreign]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`--expect-host-target ${foreign} but this runner is`));
    });

    it('fails loudly on a missing manifest instead of passing vacuously', () => {
        const result = spawnSync(process.execPath, [VERIFY, '--bundle', join(tmpdir(), 'gjsify-no-such-bundle')], {
            encoding: 'utf8',
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /cannot read/);
    });

    it('requires --bundle', () => {
        const result = spawnSync(process.execPath, [VERIFY], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /--bundle <dir> is required/);
    });
});

describe('check-workflow-inline-scripts: the regrow guard', () => {
    it('rejects the exact body that failed the v0.28.0 release', () => {
        const result = runGuard({
            'broken.yml': [
                'jobs:',
                '  gate:',
                '    steps:',
                '      - run: |',
                "          node -e '",
                '            const m = require("./manifest.json");',
                "            console.log(`sets ${m.verified.map((v) => v.id).join('+')}`);",
                "          '",
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /1 broken inline script body/);
        assert.match(result.stderr, /broken\.yml:7/);
        assert.match(result.stderr, /the shell closes the string here/);
    });

    it('accepts a multi-line body that keeps the other quote inside', () => {
        // The shape of the CORRECT cli-cross-platform.yml block: a single-quoted body
        // using only double quotes internally, closed by `')"` rather than a bare `'`.
        // A first draft of the guard flagged this — a check with false positives gets
        // switched off, and then it guards nothing.
        const result = runGuard({
            'ok.yml': [
                'jobs:',
                '  probe:',
                '    steps:',
                '      - run: |',
                '          OUT="$(node -e \'',
                '            const parse = (v) => v.split("-")[0].split(".").map(Number);',
                '            process.stdout.write(parse(process.env.V)[0] >= 1 ? "1" : "0");',
                '          \')"',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /1 workflow\(s\) clean/);
    });

    it('leaves single-line invocations alone even when the quote recurs', () => {
        // `echo "… $(node -p "require('./p.json').version")"` is correct: the second
        // double quote closes the node body, the third belongs to the enclosing echo.
        const result = runGuard({
            'inline.yml': [
                'jobs:',
                '  v:',
                '    steps:',
                '      - run: |',
                '          echo "cli: $(node -p "require(\'./package.json\').version")"',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
    });

    it('reports an unterminated body rather than scanning to end of file', () => {
        const result = runGuard({
            'open.yml': [
                'jobs:',
                '  x:',
                '    steps:',
                '      - run: |',
                "          node -e '",
                '            1 + 1;',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /no line closing it was found/);
    });

    it("holds for this repo's own workflows", () => {
        const result = spawnSync(process.execPath, [GUARD, '--root', MONOREPO_ROOT], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.output);
    });
});
