// E2E guard: a `--app gjs` bundle of a suite that never imports `@gjsify/unit/gl` must carry no
// `gi://Gtk`/`gi://Gdk` specifier — the consumer-side incident this prevents is a headless test
// bundle tripping a GUI-typelib guard (e.g. `projects/buchhaltung/app/dev/check-test-bundle.js`)
// for a toolkit import no test in the suite ever reaches. Before the fix, `@gjsify/unit`'s GL
// probe lived in `index.ts` itself, so its `gi://Gtk`/`gi://Gdk` import landed in EVERY consumer's
// bundle unconditionally; this is red against that shape and green once the probe moves behind
// `@gjsify/unit/gl`, imported only by suites that use `on('Gl', …)`.
//
// Both fixtures are asserted, for the reason `unit-axis-declaration/run.mjs` gives: a suite that
// only checked the no-gl fixture would pass just as happily against a build that stripped the
// specifier text unconditionally, which would be a lie about the Gl axis actually working.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliEntry = join(repoRoot, 'packages/infra/cli/lib/index.js');
const fixtureDir = fileURLToPath(new URL('./fixture/', import.meta.url));

let outDir;

/** Build one fixture for `--app gjs` and return the bundle path. */
function build(name) {
    const outfile = join(outDir, `${name}.gjs.mjs`);
    execFileSync(
        process.execPath,
        [cliEntry, 'build', join(fixtureDir, `${name}.mts`), '--app', 'gjs', '--outfile', outfile],
        { cwd: repoRoot, stdio: 'pipe', timeout: 5 * 60 * 1000 },
    );
    return outfile;
}

describe(
    '@gjsify/unit — the Gl probe stays out of a bundle that never asks for it',
    { timeout: 10 * 60 * 1000 },
    () => {
        before(() => {
            outDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-unit-gl-lazy-'));
        });

        after(() => {
            rmSync(outDir, { recursive: true, force: true });
        });

        it('carries no gi://Gtk / gi://Gdk specifier when no suite imports @gjsify/unit/gl', () => {
            const bundle = readFileSync(build('no-gl'), 'utf-8');
            assert.doesNotMatch(bundle, /gi:\/\/Gtk/, 'a headless suite bundle must not reach for Gtk');
            assert.doesNotMatch(bundle, /gi:\/\/Gdk/, 'a headless suite bundle must not reach for Gdk');
        });

        it('still carries gi://Gtk / gi://Gdk, and the Gl axis still works, when a suite imports @gjsify/unit/gl', () => {
            const outfile = build('with-gl');
            const bundle = readFileSync(outfile, 'utf-8');
            assert.match(bundle, /gi:\/\/Gtk/);
            assert.match(bundle, /gi:\/\/Gdk/);

            const { status, output } = (() => {
                const r = execFileSync('gjs', ['-m', outfile], { encoding: 'utf-8' });
                return { status: 0, output: r };
            })();
            assert.equal(status, 0, `expected a clean exit:\n${output}`);
        });
    },
);
