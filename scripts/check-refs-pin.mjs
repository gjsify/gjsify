#!/usr/bin/env node
/**
 * Build-step entry: verify ONE package's `refs/` provenance before it produces
 * a prebuild.
 *
 * The check and its rationale live in the `refs-pin` rule
 * (`scripts/manifest-conformance/rules/refs-pin.mjs`), registered so
 * `field-coverage` sees an owner for `gjsify.refsLockstep`. This file stays for the
 * SECOND job the registry run does not do: wired into every `build:meson`, it runs
 * for one package before the build and writes the build-directory stamp that makes a
 * stale `build/` loud instead of silent.
 *
 * Usage:  node scripts/check-refs-pin.mjs <package-dir>
 * Escape: GJSIFY_ALLOW_REFS_DRIFT=1 — for a DELIBERATE upstream bump, where
 *         the new commit is committed as the new pin in the same change.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectRefsPin, writeStamp } from './manifest-conformance/rules/refs-pin.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = resolve(process.argv[2] ?? process.cwd());

const { problems, stampFile, stampNow, skipped } = inspectRefsPin(repoRoot, pkgDir);
if (skipped) process.exit(0);

if (problems.length > 0) {
    const allowDrift = process.env.GJSIFY_ALLOW_REFS_DRIFT === '1';
    const header = `[check-refs-pin] ${pkgDir.slice(repoRoot.length + 1)}: refs/ sources are not in the state this repository pins:`;
    const body = problems.map((p) => `  - ${p}`).join('\n');
    if (allowDrift) {
        console.warn(
            `${header}\n${body}\n  GJSIFY_ALLOW_REFS_DRIFT=1 — continuing. Commit the new pin in the same change.`,
        );
        writeStamp(stampFile, stampNow);
        process.exit(0);
    }
    console.error(
        `${header}\n${body}\n\n` +
            'A committed prebuild built from a drifted checkout ships that drift to every\n' +
            'consumer and to CI, while the npm engine stays on the pinned line. Restore the\n' +
            'pin and rebuild, or — for a deliberate upstream bump — set\n' +
            'GJSIFY_ALLOW_REFS_DRIFT=1 and commit the new submodule pin in the same change.\n',
    );
    process.exit(1);
}

writeStamp(stampFile, stampNow);
