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

import { describeAddonLoadFailure } from '../load-diagnostics.js';

const dlopenError = new Error('Das angegebene Modul wurde nicht gefunden.');
const addon = 'C:\\app\\node_modules\\@gjsify\\node-gi\\prebuilds\\win32-x64\\node_gi.node';

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
