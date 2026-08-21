// SPDX-License-Identifier: MIT
// What a user is told when the addon FILE is there and still will not load.
//
// The report (#1063), from a clean Windows VM running the published 0.31.0:
//
//   Error: Das angegebene Modul wurde nicht gefunden.
//   \\?\C:\...\@gjsify\node-gi\prebuilds\win32-x64\node_gi.node
//     code: 'ERR_DLOPEN_FAILED'
//
// An OS error, in the OS's language, naming a file that plainly exists — and no
// mention of GTK, of the bundle that would fix it, or of the MSVC runtime. The
// loader already had a careful message for "addon missing" and none at all for
// "addon present, closure missing", which is the case users actually hit.
//
// Same class as PR #994, where a missing load-time library surfaced as
// "Unsupported type void, deriving from fundamental void".
//
// These assertions run anywhere because the platform and the decided GTK source
// are parameters. The Windows wording in particular has never been printed by any
// job in this repository.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { describeAddonLoadFailure } from '../load-diagnostics.js';
import { nativeCandidates } from '../native-paths.js';

const dlopenError = new Error('Das angegebene Modul wurde nicht gefunden.');
const addon = 'C:\\app\\node_modules\\@gjsify\\node-gi\\prebuilds\\win32-x64\\node_gi.node';

/** The error Node raises when `require()` cannot RESOLVE a specifier. */
function moduleNotFound(specifier) {
    const err = new Error(`Cannot find module '${specifier}'\nRequire stack:\n- /app/node-gi/index.js`);
    err.code = 'MODULE_NOT_FOUND';
    return err;
}

describe('describeAddonLoadFailure', () => {
    it('keeps the original cause verbatim — it is still the only ground truth', () => {
        const msg = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'none',
            target: 'win32-x64',
        });
        assert.match(msg, /Das angegebene Modul wurde nicht gefunden\./);
        assert.ok(msg.includes(addon), 'must name the addon it tried to load');
    });

    it('says the file is present and points at the dependency closure', () => {
        const msg = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'none',
            target: 'win32-x64',
        });
        assert.match(msg, /exists but could not be loaded/);
        assert.match(msg, /dependency closure/);
    });

    it('names the package that fixes it when no bundle was selected', () => {
        const msg = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'none',
            target: 'win32-x64',
        });
        assert.match(msg, /@gjsify\/gtk-runtime-win32-x64/);
        assert.match(msg, /GJSIFY_GTK_RUNTIME/);
    });

    it('mentions the MSVC runtime on win32, the prerequisite that is easy to miss', () => {
        // #997 already taught `gjsify system-check` about it; the loader is where
        // a user actually meets the failure.
        const msg = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'none',
            target: 'win32-x64',
        });
        assert.match(msg, /vcruntime140/);
        assert.match(msg, /system-check/);
    });

    it('gives DIFFERENT advice when a bundle WAS selected and still failed', () => {
        // "Install the bundle" is useless if the bundle is what just failed. Then
        // the actionable move is to reinstall it or step around it.
        const msg = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'bundle',
            target: 'win32-x64',
        });
        assert.match(msg, /likely incomplete/);
        assert.match(msg, /GJSIFY_GTK_PREFER=system/);
    });

    it('reports which GTK source the policy picked, so the state is not guesswork', () => {
        const bundle = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'bundle',
            target: 'win32-x64',
        });
        const system = describeAddonLoadFailure(addon, dlopenError, {
            platform: 'win32',
            source: 'system',
            target: 'win32-x64',
        });
        assert.match(bundle, /GTK source selected for this process: bundle/);
        assert.match(system, /GTK source selected for this process: system/);
    });

    it('speaks of dylibs and the darwin bundle on macOS', () => {
        const msg = describeAddonLoadFailure('/app/node_gi.node', dlopenError, {
            platform: 'darwin',
            source: 'none',
            target: 'darwin-arm64',
        });
        assert.match(msg, /dylibs/);
        assert.match(msg, /@gjsify\/gtk-runtime-darwin-arm64/);
        assert.doesNotMatch(msg, /vcruntime140/, 'the MSVC hint is win32-only');
    });

    it('points a linux user at their package manager, not at a bundle we do not ship', () => {
        const msg = describeAddonLoadFailure('/app/node_gi.node', dlopenError, {
            platform: 'linux',
            source: 'system',
            target: 'linux-x64',
        });
        assert.match(msg, /gtk4/);
        assert.doesNotMatch(msg, /@gjsify\/gtk-runtime-linux-x64/, 'no such package exists');
    });

    it('survives a non-Error thrown value', () => {
        const msg = describeAddonLoadFailure(addon, 'boom', {
            platform: 'win32',
            source: 'none',
            target: 'win32-x64',
        });
        assert.match(msg, /boom/);
    });
});

// --- the RESOLUTION half (#996 / PR #1239) ---------------------------------
//
// The incident is written down once, in load-diagnostics.js `isResolutionFailure`. It
// left two defects and these are their two fixes: the pinned path is resolved where it
// enters the package, and a resolution failure no longer wears a GTK diagnosis.

describe('a pinned NODE_GI_NATIVE path', () => {
    it('resolves to something require() can actually load', () => {
        // The shape that shipped, reproduced exactly: a MULTI-SEGMENT relative path that
        // EXISTS relative to the cwd — `prebuilds/<target>/node_gi.node`, the tail of the
        // `--stage` argument node-gi.yml passes. Both questions `loadNative()` asks (does
        // the file exist, can it be required) must land on the SAME file, and only an
        // absolute path makes that true.
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-native-pin-'));
        const rel = join('prebuilds', 'darwin-arm64', 'node_gi.node');
        mkdirSync(join(dir, 'prebuilds', 'darwin-arm64'), { recursive: true });
        writeFileSync(join(dir, rel), Buffer.alloc(4)); // not a real addon; only dlopen sees it
        const cwd = process.cwd();
        process.chdir(dir);
        try {
            assert.ok(!isAbsolute(rel) && !rel.startsWith('.'), `fixture must be a bare relative path: ${rel}`);
            assert.ok(existsSync(rel), 'existsSync reads it against the cwd — this is why the bug got through');

            const [candidate] = nativeCandidates({ NODE_GI_NATIVE: rel });
            assert.ok(isAbsolute(candidate), `candidate must be absolute, got ${candidate}`);
            assert.equal(candidate, resolve(rel));
            assert.ok(existsSync(candidate), 'the existence check and the load must name one file');

            // And the load now gets as far as the OS: ERR_DLOPEN_FAILED is dlopen
            // refusing 4 bytes, which is the proof that RESOLUTION succeeded — all this
            // case claims. The require anchor sits beside the fixture, i.e. as far from
            // the cwd as index.js is from a builder's.
            const require = createRequire(join(dir, 'anchor.cjs'));
            assert.throws(
                () => require(candidate),
                (err) => err.code === 'ERR_DLOPEN_FAILED',
                'a resolved path must fail at dlopen, never at module resolution',
            );

            // The un-resolved spelling is the one require() could never load, cwd or no
            // cwd. Asserting it keeps the reason for resolve() attached to what it prevents.
            assert.throws(
                () => require(rel),
                (err) => err.code === 'MODULE_NOT_FOUND',
                'the bare relative spelling must still be the one that fails',
            );
        } finally {
            process.chdir(cwd);
        }
    });

    it('leaves an absolute pin and the two keywords byte-identical', () => {
        const abs = process.platform === 'win32' ? 'C:\\a\\node_gi.node' : '/a/node_gi.node';
        assert.deepEqual(nativeCandidates({ NODE_GI_NATIVE: abs }), [abs]);
        // `build` and `prebuild` are keywords, not paths — resolve() must not touch them.
        for (const keyword of ['build', 'prebuild']) {
            for (const candidate of nativeCandidates({ NODE_GI_NATIVE: keyword })) {
                assert.ok(isAbsolute(candidate), `${keyword} -> ${candidate}`);
                assert.doesNotMatch(candidate, /[\\/]node_gi\.node[\\/]/);
            }
        }
        assert.equal(nativeCandidates({ NODE_GI_NATIVE: 'build' }).length, 3);
        assert.equal(nativeCandidates({ NODE_GI_NATIVE: 'prebuild' }).length, 1);
    });
});

describe('describeAddonLoadFailure discriminates the CAUSE', () => {
    const relSpecifier = 'packages/node-gi/node-gi/prebuilds/darwin-arm64/node_gi.node';

    it('calls a Cannot-find-module a RESOLUTION failure, not a GTK one', () => {
        const msg = describeAddonLoadFailure(relSpecifier, moduleNotFound(relSpecifier), {
            platform: 'darwin',
            source: 'bundle',
            target: 'darwin-arm64',
        });
        assert.match(msg, /could not be RESOLVED/);
        assert.match(msg, /module-RESOLUTION failure/);
        assert.match(msg, /NODE_GI_NATIVE=\/absolute\/path/);
        assert.match(msg, /Cannot find module/, 'the original cause stays verbatim');
    });

    it('does NOT send the reader after the dependency closure or the bundle', () => {
        // The advice that shipped: "A bundle WAS selected, so it is likely incomplete for
        // this target. Reinstall @gjsify/gtk-runtime-darwin-arm64, or set
        // GJSIFY_GTK_PREFER=system." Nothing about it was true of a relative path, and it
        // is the sentence a stranger would have acted on.
        const msg = describeAddonLoadFailure(relSpecifier, moduleNotFound(relSpecifier), {
            platform: 'darwin',
            source: 'bundle',
            target: 'darwin-arm64',
        });
        assert.doesNotMatch(msg, /dependency closure/);
        assert.doesNotMatch(msg, /likely incomplete/);
        assert.doesNotMatch(msg, /@gjsify\/gtk-runtime-darwin-arm64/);
        assert.doesNotMatch(msg, /GJSIFY_GTK_PREFER/);
    });

    it('recognises the condition by CODE and by wording, on every runtime', () => {
        // Node raises MODULE_NOT_FOUND / ERR_MODULE_NOT_FOUND; Bun, Deno and the GJS napi
        // shim raise the same condition with no code at all, so the text is the fallback.
        const byCode = Object.assign(new Error('nope'), { code: 'ERR_MODULE_NOT_FOUND' });
        const byText = new Error("Cannot find module 'some/relative/node_gi.node'");
        for (const err of [byCode, byText]) {
            const msg = describeAddonLoadFailure(relSpecifier, err, { platform: 'win32', source: 'none' });
            assert.match(msg, /could not be RESOLVED/, JSON.stringify(String(err)));
            assert.doesNotMatch(msg, /vcruntime140/, 'the MSVC hint answers a dlopen failure, not this');
        }
    });

    it('still gives the dependency-closure answer to a real dlopen failure', () => {
        // The half that must NOT change: #1063's ERR_DLOPEN_FAILED is exactly the case the
        // long GTK explanation was written for.
        const err = Object.assign(new Error('Das angegebene Modul wurde nicht gefunden.'), {
            code: 'ERR_DLOPEN_FAILED',
        });
        const msg = describeAddonLoadFailure(addon, err, {
            platform: 'win32',
            source: 'bundle',
            target: 'win32-x64',
        });
        assert.match(msg, /dependency closure/);
        assert.match(msg, /likely incomplete/);
        assert.doesNotMatch(msg, /could not be RESOLVED/);
    });
});
