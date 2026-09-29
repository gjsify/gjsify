// SPDX-License-Identifier: MIT
// @gjsify/gl-runtime-win32-x64 — the optional Mesa package (#1097), checked on any host.
//
// Its payload is fetched, never committed, so what can go wrong in a checkout is the part
// that IS committed: the pin, the licence texts taken for that pin, and the manifest that
// decides what npm installs where.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MESA_DIST_WIN } from '../../scripts/fetch-gl-implementation.mjs';
import { glRuntimePackageName } from '../gtk-runtime.js';

const pkgDir = fileURLToPath(new URL('../../gl-runtime-win32-x64/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${pkgDir}package.json`, 'utf8'));
const provenance = JSON.parse(readFileSync(`${pkgDir}licenses/provenance.json`, 'utf8'));

test('the loader looks for exactly the name this package publishes', () => {
    assert.equal(manifest.name, glRuntimePackageName('win32-x64'));
    assert.deepEqual([manifest.os, manifest.cpu], [['win32'], ['x64']]);
});

test('the licence texts are the ones taken for the pinned mesa-dist-win release', () => {
    // Move the pin alone and these texts describe another release; nothing else would notice.
    assert.equal(provenance.mesaDistWin, MESA_DIST_WIN.version);
    const dirs = readdirSync(`${pkgDir}licenses`, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    assert.deepEqual(dirs, Object.keys(provenance.components).sort());
});

test('the tarball carries the payload and the notice its licence field names', () => {
    assert.ok(manifest.files.includes('bin'));
    assert.equal(manifest.license, 'SEE LICENSE IN bin/THIRD-PARTY-NOTICES.md');
});

test('node-gi never depends on it — it is resolved by name, like the GTK bundle (ADR 0023)', () => {
    const nodeGi = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        assert.equal(nodeGi[field]?.[manifest.name], undefined, `${field} names ${manifest.name}`);
    }
});
