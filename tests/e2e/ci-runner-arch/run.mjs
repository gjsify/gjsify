// E2E test for the runner-label → `<os>-<arch>` derivation in
// `scripts/manifest-conformance/rules/platforms-ci.mjs`.
//
// The platform audit learns which targets CI PRODUCES by reading each job's
// `runs-on`, and attributes those targets to the packages the job builds. When
// a job declares no `arch:` matrix key the arch comes from the label alone —
// and that is the one input with no second opinion anywhere: the declared,
// built and committed sets can all agree while describing the WRONG
// architecture, because every side is reading the same mistaken derivation.
// Nothing goes red; the promise is simply about a different machine than the
// artifact.
//
// GitHub's macOS labels make this concrete. `macos-15-intel` (the last x86_64
// image Actions offers, until August 2027) and `macos-15` differ by a suffix
// and by architecture, and `-large` vs `-xlarge` differ by ONE CHARACTER while
// meaning opposite architectures. So the derivation is pinned here per label
// rather than left to the OS-keyed default table.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-runner-arch/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const RULE = join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'platforms-ci.mjs');

const { archFromRunner, osFromRunner } = await import(`file://${RULE}`);

/** `<os>-<arch>` exactly as the audit composes it from a bare runner label. */
const target = (runsOn) => `${osFromRunner(runsOn)}-${archFromRunner(runsOn)}`;

describe('runner label → OS', () => {
    it('maps each hosted-runner family', () => {
        assert.equal(osFromRunner('ubuntu-24.04'), 'linux');
        assert.equal(osFromRunner('macos-latest'), 'darwin');
        assert.equal(osFromRunner('macos-15-intel'), 'darwin');
        assert.equal(osFromRunner('windows-latest'), 'win32');
    });
});

describe('runner label → arch', () => {
    it('reads Apple silicon from the bare macOS labels', () => {
        for (const label of ['macos-latest', 'macos-14', 'macos-15', 'macos-26']) {
            assert.equal(target(label), 'darwin-arm64', label);
        }
    });

    it('reads Intel from the `-intel` labels', () => {
        // The regression this file exists for: with the OS-keyed default alone
        // these came back `darwin-arm64`, so an Intel job silently credited the
        // arm64 target and the declared-vs-built check stayed green about the
        // wrong machine.
        for (const label of ['macos-15-intel', 'macos-26-intel']) {
            assert.equal(target(label), 'darwin-x64', label);
        }
    });

    it('distinguishes `-large` (Intel) from `-xlarge` (Apple silicon)', () => {
        // One character apart, opposite architectures — and `-large` contains
        // no substring that would hint at Intel, so an order-dependent read
        // that tests `-large` first would call every `-xlarge` runner x64.
        assert.equal(target('macos-latest-large'), 'darwin-x64');
        assert.equal(target('macos-15-large'), 'darwin-x64');
        assert.equal(target('macos-latest-xlarge'), 'darwin-arm64');
        assert.equal(target('macos-15-xlarge'), 'darwin-arm64');
    });

    it('keeps the Linux arm label working', () => {
        assert.equal(target('ubuntu-24.04-arm'), 'linux-arm64');
        assert.equal(target('ubuntu-24.04'), 'linux-x64');
    });

    it('falls back to the OS default for an unknown label', () => {
        // A label the table does not recognise must not throw — the audit
        // treats an unparsed job as unverified, never as broken.
        assert.equal(target('some-self-hosted-runner'), 'linux-x64');
        assert.equal(target('windows-2025'), 'win32-x64');
    });
});
