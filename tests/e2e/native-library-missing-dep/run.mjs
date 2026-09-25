#!/usr/bin/env node
// E2E: a native bridge whose library cannot be loaded is REPORTED, by name.
//
// A typelib that resolves while its library does not load fails at the first
// class access with GJS's "Unsupported type void, deriving from fundamental
// void" — measured on macOS 27 arm64 with Homebrew json-glib absent, where the
// rolldown engine is `gjsify build` itself. `probeNativeLibrary()`
// (`@gjsify/utils/core`) is the one place that turns that into the file and the
// dependency the loader could not find, and `loadOptionalNativeModule()` — what
// every optional bridge loader calls — carries that same error instead of
// silently reading the bridge as absent.
//
// The missing dependency is REAL, not simulated: the committed rolldown prebuild
// for this host is copied WITHOUT its cargo sibling (`libgjsify_rolldown`), which
// the Vala library links and resolves only from its own directory. That needs no
// compiler, no `install_name_tool`/`patchelf`, and holds the same on Linux (ELF
// `$ORIGIN`) and macOS (`@loader_path`). The control run copies the sibling too
// and must report nothing — a probe that always fails would pass the first half.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    cleanupTestEnvironment,
    e2eSkipReason,
    hasCommand,
    HOST_TARGET,
    MONOREPO_ROOT,
    prebuildDir,
} from '../helpers.mjs';

const SUITE = 'native-library-missing-dep';
const PREBUILD = prebuildDir('infra', 'rolldown-native', HOST_TARGET);
const PROBE_MODULE = join(MONOREPO_ROOT, 'packages', 'gjs', 'utils', 'lib', 'esm', 'native-library.js');
const EXT = process.platform === 'darwin' ? 'dylib' : 'so';
const VALA_LIB = `libgjsifyrolldown.${EXT}`;
const CARGO_LIB = `libgjsify_rolldown.${EXT}`;

const skip = e2eSkipReason(SUITE, [
    ['`gjs` on PATH', hasCommand('gjs')],
    [`a committed rolldown-native prebuild for ${HOST_TARGET}`, existsSync(join(PREBUILD, VALA_LIB))],
    ['@gjsify/utils built (lib/esm/native-library.js)', existsSync(PROBE_MODULE)],
]);

/** Stage the typelib + Vala library (and optionally the cargo sibling) into a fresh dir; run the probe there. */
function probe(root, name, { withSibling }) {
    const dir = join(root, name);
    mkdirSync(dir);
    const wanted = readdirSync(PREBUILD).filter(
        (f) => f.endsWith('.typelib') || f === VALA_LIB || (withSibling && f === CARGO_LIB),
    );
    for (const f of wanted) copyFileSync(join(PREBUILD, f), join(dir, f));

    const script = join(dir, 'probe.mjs');
    writeFileSync(
        script,
        [
            `import { loadOptionalNativeModule, probeNativeLibrary, NativeLibraryLoadError } from ${JSON.stringify(pathToFileURL(PROBE_MODULE).href)};`,
            'const repository = imports.gi.GIRepository.Repository.dup_default();',
            `repository.prepend_search_path(${JSON.stringify(dir)});`,
            `repository.prepend_library_path(${JSON.stringify(dir)});`,
            'void imports.gi.GjsifyRolldown;',
            "const failure = probeNativeLibrary('GjsifyRolldown');",
            "const load = loadOptionalNativeModule('GjsifyRolldown', ['Bundler']);",
            'print(JSON.stringify({',
            '    failure,',
            '    message: failure ? new NativeLibraryLoadError(failure).message : null,',
            '    loaded: load.module !== null,',
            '    loadError: load.error && { name: load.error.name, message: load.error.message },',
            '}));',
        ].join('\n'),
    );
    // No inherited search path may reach the REAL prebuild directory, or the
    // loader finds the sibling there and the missing dependency is not missing.
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key === 'GI_TYPELIB_PATH' || key === 'LD_LIBRARY_PATH' || key.startsWith('DYLD_')) delete env[key];
    }
    // girepository's own warning goes to stderr; only the JSON line is the result.
    const out = execFileSync('gjs', ['-m', script], {
        env,
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const line = out
        .split('\n')
        .reverse()
        .find((l) => l.startsWith('{'));
    assert.ok(line, `no JSON line from the probe:\n${out}`);
    return { dir, ...JSON.parse(line) };
}

describe('probeNativeLibrary names the library and its missing dependency', { skip }, () => {
    // realpath: macOS hands out /var/… for /private/var/…, and the typelib path
    // girepository reports is the one it was given.
    const root = skip ? '' : realpathSync(mkdtempSync(join(tmpdir(), 'gjsify-e2e-native-lib-')));

    after(() => root && cleanupTestEnvironment(root));

    it('reports the colocated library and the dependency the loader could not find', () => {
        const { dir, failure, message, loaded, loadError } = probe(root, 'missing', { withSibling: false });
        assert.ok(failure, 'the probe reported no failure for a library whose dependency is absent');
        assert.equal(failure.namespace, 'GjsifyRolldown');
        assert.equal(failure.library, join(dir, VALA_LIB));
        assert.equal(failure.missingDependency, CARGO_LIB);
        assert.ok(failure.reason.includes(CARGO_LIB), failure.reason);
        assert.ok(message.includes(`the native library ${join(dir, VALA_LIB)} could not be loaded`), message);
        assert.ok(message.includes(`It needs ${CARGO_LIB}`), message);
        // The optional-loader path reads the bridge as absent AND keeps the diagnosis.
        assert.equal(loaded, false);
        assert.deepEqual(loadError, { name: 'NativeLibraryLoadError', message });
    });

    it('reports nothing when the dependency is present', () => {
        const { failure, loaded, loadError } = probe(root, 'complete', { withSibling: true });
        assert.equal(failure, null);
        assert.equal(loaded, true);
        assert.equal(loadError, null);
    });
});
