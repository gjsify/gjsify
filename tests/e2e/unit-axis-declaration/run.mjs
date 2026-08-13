// E2E guard for `@gjsify/unit`'s `requireAxes` declaration.
//
// THE INCIDENT THIS PREVENTS
//
// `on()` returns silently when the host is not on the named axis, which is correct.
// What was missing is that a gate which SHOULD have fired and did not looked exactly
// the same: a miss did `++countTestsIgnored`, the count was printed, and the exit
// code read `countTestsFailed` alone — so an axis whose tests had stopped being
// registered left nothing behind and never once stopped a merge.
//
// `requireAxes` turns that into a verdict. The verdict is one line in `run()`, and a
// declaration whose enforcement has been removed is INVISIBLE from inside a run: the
// declaring entry keeps passing, just without gating anything. That is the shape of
// the two inline `node -e` release gates which shipped dead on arrival and cost all
// three v0.28.0 publish legs. So the wiring is asserted from OUTSIDE, on exit codes.
//
// Both directions are asserted on purpose. A suite that only checked the failing
// fixture would pass just as happily against a runner that failed EVERY run.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliEntry = join(repoRoot, 'packages/infra/cli/lib/index.js');
const fixtureDir = fileURLToPath(new URL('./fixture/', import.meta.url));

/** `true` when a usable `gjs` is on PATH — the gjs leg can only run there. */
function hasGjs() {
    return spawnSync('gjs', ['--version'], { encoding: 'utf-8' }).status === 0;
}

let outDir;

/** Build one fixture for one target and return the bundle path. */
function build(name, app) {
    const outfile = join(outDir, `${name}.${app}.mjs`);
    execFileSync(
        process.execPath,
        [cliEntry, 'build', join(fixtureDir, `${name}.mts`), '--app', app, '--outfile', outfile],
        { cwd: repoRoot, stdio: 'pipe', timeout: 5 * 60 * 1000 },
    );
    return outfile;
}

/** Run a built bundle on the given interpreter and return `{ status, output }`. */
function runBundle(argv0, args) {
    const r = spawnSync(argv0, args, { encoding: 'utf-8', timeout: 2 * 60 * 1000 });
    return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('@gjsify/unit requireAxes declaration', { timeout: 15 * 60 * 1000 }, () => {
    before(() => {
        outDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-axis-decl-'));
    });

    after(() => {
        rmSync(outDir, { recursive: true, force: true });
    });

    it('fails the node leg when a declared axis exercised nothing', () => {
        const { status, output } = runBundle(process.execPath, [build('unexercised', 'node')]);
        assert.equal(status, 1, `expected a non-zero exit, got ${status}:\n${output}`);
        assert.match(output, /declared axis 'Node\.js' ran on this host but exercised nothing/);
    });

    it('passes the node leg when the declared axis executed a test', () => {
        const { status, output } = runBundle(process.execPath, [build('exercised', 'node')]);
        assert.equal(status, 0, `expected a clean exit, got ${status}:\n${output}`);
    });

    it("says NOTHING about 'Gjs' on the node leg — an unmatched axis claims nothing", () => {
        // The declaration is host-conditional, and this is the half that makes one
        // built entry usable on every leg: the node run declares 'Gjs' too and must
        // not be held to it.
        const { output } = runBundle(process.execPath, [build('unexercised', 'node')]);
        assert.doesNotMatch(output, /declared axis 'Gjs'/);
    });

    it('fails the gjs leg when a declared axis exercised nothing', { skip: !hasGjs() && 'no gjs on PATH' }, () => {
        const { status, output } = runBundle('gjs', ['-m', build('unexercised', 'gjs')]);
        assert.equal(status, 1, `expected a non-zero exit, got ${status}:\n${output}`);
        assert.match(output, /declared axis 'Gjs' ran on this host but exercised nothing/);
    });

    it('passes the gjs leg when the declared axis executed a test', { skip: !hasGjs() && 'no gjs on PATH' }, () => {
        const { status, output } = runBundle('gjs', ['-m', build('exercised', 'gjs')]);
        assert.equal(status, 0, `expected a clean exit, got ${status}:\n${output}`);
    });
});
