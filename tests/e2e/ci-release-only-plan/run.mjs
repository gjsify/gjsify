// E2E for scripts/release-only-plan.mjs — what `release.yml` runs for a given `only`.
//
// To run: node --test tests/e2e/ci-release-only-plan/run.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JOBS, checkJobs, planOnly, readTree } from '../../../scripts/release-only-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'release-only-plan.mjs');

const tree = {
    workspaceNames: ['@gjsify/adwaita-fonts', '@gjsify/adwaita-core', '@gjsify/example-dom-a'],
    dedicatedNames: Object.values(JOBS).flat(),
};
const running = (plan) => Object.keys(JOBS).filter((j) => plan[j] === 'true');

describe('release-only-plan', () => {
    it('empty only runs everything and sweeps everything', () => {
        const plan = planOnly('', tree);
        assert.equal(plan.all, 'true');
        assert.equal(plan.sweep, '');
        assert.deepEqual(running(plan), Object.keys(JOBS));
    });

    it('a dedicated package skips the sweep and runs only its own job', () => {
        const plan = planOnly('@gjsify/gi-runtime-android', tree);
        assert.equal(plan.sweep, '');
        assert.equal(plan.all, 'false');
        assert.deepEqual(running(plan), ['gi_android']);
    });

    it('a workspace package runs no dedicated job', () => {
        const plan = planOnly('@gjsify/adwaita-fonts', tree);
        assert.equal(plan.sweep, '@gjsify/adwaita-fonts');
        assert.deepEqual(running(plan), []);
    });

    it('a mix splits between the sweep and the jobs', () => {
        const plan = planOnly('@gjsify/node-gi @gjsify/adwaita-core', tree);
        assert.equal(plan.sweep, '@gjsify/adwaita-core');
        assert.deepEqual(running(plan), ['node_gi']);
    });

    it('globs select dedicated packages', () => {
        assert.deepEqual(running(planOnly('@gjsify/napi-*', tree)), ['napi']);
        assert.deepEqual(running(planOnly('@gjsify/*-runtime-*', tree)).sort(), [
            'gi_android',
            'gtk_darwin',
            'gtk_win32',
            'node_runtime',
        ]);
    });

    it('a pattern matching nothing is an error, as in foreach', () => {
        assert.throws(() => planOnly('@gjsify/nope', tree), /matched no publishable package/);
    });

    it('checkJobs reports an unowned and a stale package', () => {
        assert.deepEqual(checkJobs(Object.values(JOBS).flat()), []);
        assert.match(
            checkJobs([...Object.values(JOBS).flat(), '@gjsify/new']).join('\n'),
            /@gjsify\/new is published by no job/,
        );
        assert.match(checkJobs(['@gjsify/node-gi']).join('\n'), /not a dedicated package/);
    });

    it('JOBS matches the real tree', () => {
        assert.deepEqual(checkJobs(readTree(ROOT).dedicatedNames), []);
    });

    it('CLI exits 1 on an unmatched pattern and 0 on --check', () => {
        const bad = spawnSync('node', [SCRIPT, '--only', '@gjsify/nope'], { encoding: 'utf8' });
        assert.equal(bad.status, 1);
        execFileSync('node', [SCRIPT, '--check']);
    });
});
