// SPDX-License-Identifier: MIT
// @gjsify/node-gi — `GJSIFY_GI_LIBRARY_PATH`, measured at the LOADER.
//
// WHAT THIS ADDS OVER `gi-library-path.test.mjs`. That file asserts our WIRING: the
// variable's directories reach `native.prependLibraryPath`. A wiring assertion
// cannot tell "GI was never given the directory" from "GI was given it and ignored
// it" — both leave the app's library unloaded, and only one is a bug in this
// package. So this file asks the loader instead: it copies a real typelib backer
// into a scratch dir, points the variable at it, and reads back WHICH FILE the
// process actually mapped (`process.report` — `/proc/self/maps` on linux,
// `_dyld_get_image_name()` on darwin). The control run, variable unset, pins the
// other half: the very same probe then maps the SYSTEM copy.
//
// WHAT IT DOES NOT PROVE. On linux it says nothing about a signed macOS `.app`
// reaching its own `Contents/Frameworks` — same assertion, different OS, made by
// the macOS leg in `.github/workflows/node-gi.yml`. It also does not test the ship
// launcher: this package's contract is the variable, not who sets it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE = fileURLToPath(new URL('../fixtures/gi-library-path-probe.mjs', import.meta.url));

/** Run the probe child with an explicit `GJSIFY_GI_LIBRARY_PATH` (or none). */
function probe(libraryPath) {
    const env = { ...process.env };
    delete env.GJSIFY_GI_LIBRARY_PATH;
    if (libraryPath) env.GJSIFY_GI_LIBRARY_PATH = libraryPath;
    const run = spawnSync(process.execPath, [PROBE], { encoding: 'utf8', env });
    assert.equal(run.status, 0, `probe child failed:\n${run.stdout}\n${run.stderr}`);
    const line = run.stdout.trim().split('\n').at(-1);
    return JSON.parse(line);
}

const control = probe(undefined);
const skip = control.skip ?? false;

test('the loader opens the library from the directory the variable names', { skip }, () => {
    assert.ok(control.registered, 'the control run must resolve the GType — otherwise nothing was loaded');
    assert.equal(control.loaded.length, 1, `expected exactly one backer image, got ${JSON.stringify(control.loaded)}`);
    const systemCopy = control.loaded[0];

    // A COPY under the same leaf, in a directory on no loader search path. The leaf
    // is what the typelib records, so this is the file GI will look for.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'node-gi-libpath-')));
    const appCopy = join(dir, basename(systemCopy));
    copyFileSync(systemCopy, appCopy);
    assert.notEqual(dirname(systemCopy), dir, 'the scratch dir must not be where the system copy lives');

    const treatment = probe(dir);
    assert.ok(treatment.registered, 'the GType must still resolve — a loaded-but-broken library is not a pass');
    assert.deepEqual(treatment.loaded, [appCopy], 'GI must open the copy in the named directory, and only that one');
    // And the control is what makes that attributable: same probe, same host, one
    // variable different.
    assert.deepEqual(control.loaded, [systemCopy]);
});
