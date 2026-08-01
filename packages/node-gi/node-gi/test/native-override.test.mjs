// SPDX-License-Identifier: MIT
// NODE_GI_NATIVE pins which native binary index.js loads (build | prebuild |
// explicit path). Regression guard for the stale-prebuild footgun: the test
// scripts pin `build`, so local verification always runs the just-built addon
// instead of a stale staged prebuilds/<platform>-<arch>/node_gi.node.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function loadWith(nativeEnv) {
    return spawnSync(process.execPath, ['-e', "import('./index.js').then(() => console.log('LOADED'))"], {
        cwd: pkgRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_GI_NATIVE: nativeEnv },
    });
}

test('NODE_GI_NATIVE=build loads the locally built addon', () => {
    const res = loadWith('build');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /LOADED/);
});

test('NODE_GI_NATIVE=<bogus path> fails loudly instead of falling back', () => {
    const res = loadWith(join(pkgRoot, 'no', 'such', 'node_gi.node'));
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /native addon not found/);
});
