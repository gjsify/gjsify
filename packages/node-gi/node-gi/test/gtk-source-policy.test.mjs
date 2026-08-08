// SPDX-License-Identifier: MIT
// Which GTK wins — the policy that replaced "a bundle, if one is present".
//
// Every case here runs on ANY host, because `decideGtkSource` takes platform,
// availability and provenance as arguments. That is the whole point: the two
// behaviours this file has to protect are a Windows one and a macOS one, and no
// job in this repository has ever executed either. An unexecutable branch is how
// the `'dir'` bug in the CLI's dir-link shipped, and it is how #910 shipped.
//
// The incident being encoded: #910 made the bundle a dependency of node-gi, so a
// CI job that had COMPILED the addon against Homebrew GTK re-exec'd onto the
// BUNDLE's typelibs — wrong method entries, then a 29-minute timeout. #920
// reverted it and left Windows with no GTK at all (#1063). The rule that lets
// both work is that a from-source addon never silently gets a bundle.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_GTK_PREFERENCE, decideGtkSource } from '../gtk-runtime.js';

/** Both sources available — the only situation where preference is observable. */
const both = { hasBundle: true, hasSystem: true };

describe('decideGtkSource: per-OS defaults', () => {
    it('prefers the SYSTEM GTK on linux, which the package manager resolved', () => {
        assert.equal(decideGtkSource({ platform: 'linux', ...both }), 'system');
    });

    it('prefers the BUNDLE on win32, where there is no system GTK to speak of', () => {
        assert.equal(decideGtkSource({ platform: 'win32', ...both }), 'bundle');
    });

    it('prefers the BUNDLE on darwin, where Homebrew is present but not findable', () => {
        assert.equal(decideGtkSource({ platform: 'darwin', ...both }), 'bundle');
    });

    it('states each default explicitly, so a future Linux bundle cannot flip Linux', () => {
        // The cheaper rule "prefer a bundle wherever one ships" agrees with this
        // table today and would silently disagree the day a linux bundle exists.
        assert.deepEqual({ ...DEFAULT_GTK_PREFERENCE }, { linux: 'system', win32: 'bundle', darwin: 'bundle' });
    });
});

describe('decideGtkSource: preference is an ORDER, not an exclusion', () => {
    it('falls back to the bundle on linux when no system GTK is usable', () => {
        assert.equal(decideGtkSource({ platform: 'linux', hasBundle: true, hasSystem: false }), 'bundle');
    });

    it('falls back to the system GTK on win32 when no bundle is installed', () => {
        // The gvsbuild host: it kept working before this change and must keep
        // working after it.
        assert.equal(decideGtkSource({ platform: 'win32', hasBundle: false, hasSystem: true }), 'system');
    });

    it('answers "none" when neither is available', () => {
        assert.equal(decideGtkSource({ platform: 'win32', hasBundle: false, hasSystem: false }), 'none');
    });
});

describe('decideGtkSource: the from-source veto (#910)', () => {
    it('refuses a bundle for a from-source addon even where the bundle is the default', () => {
        // THE incident: addon compiled against the host GTK, bundle present.
        assert.equal(decideGtkSource({ platform: 'darwin', ...both, provenance: 'source' }), 'system');
        assert.equal(decideGtkSource({ platform: 'win32', ...both, provenance: 'source' }), 'system');
    });

    it('answers "none" rather than the bundle when a from-source addon has no system GTK', () => {
        // Failing loudly beats loading a mismatched pair: the crash #910 produced
        // was a 29-minute timeout, which is far worse to diagnose than a refusal.
        assert.equal(
            decideGtkSource({ platform: 'win32', hasBundle: true, hasSystem: false, provenance: 'source' }),
            'none',
        );
    });

    it('leaves a PREBUILD addon free to use the bundle', () => {
        // The prebuild and the win32 bundle are built from the same gvsbuild tree,
        // so there is no mismatch for the veto to prevent.
        assert.equal(decideGtkSource({ platform: 'win32', ...both, provenance: 'prebuild' }), 'bundle');
    });

    it('does not veto an explicitly pinned addon of unknown provenance', () => {
        assert.equal(decideGtkSource({ platform: 'win32', ...both, provenance: 'unknown' }), 'bundle');
    });
});

describe('decideGtkSource: GJSIFY_GTK_PREFER', () => {
    it('lets a linux user opt INTO a bundle', () => {
        assert.equal(decideGtkSource({ platform: 'linux', ...both, override: 'bundle' }), 'bundle');
    });

    it('lets a win32/darwin user opt OUT of the bundle', () => {
        assert.equal(decideGtkSource({ platform: 'win32', ...both, override: 'system' }), 'system');
        assert.equal(decideGtkSource({ platform: 'darwin', ...both, override: 'system' }), 'system');
    });

    it('can lift the from-source veto, because an explicit variable is consent', () => {
        // Building against the bundle on purpose is legitimate; what #910 was is
        // an accident nobody chose. Only the DEFAULT has to refuse it.
        assert.equal(
            decideGtkSource({ platform: 'darwin', ...both, provenance: 'source', override: 'bundle' }),
            'bundle',
        );
    });

    it('does NOT lift the veto for the opposite override', () => {
        assert.equal(
            decideGtkSource({ platform: 'darwin', ...both, provenance: 'source', override: 'system' }),
            'system',
        );
    });

    it('ignores a value that is neither bundle nor system, falling back to the default', () => {
        assert.equal(decideGtkSource({ platform: 'linux', ...both, override: 'yes-please' }), 'system');
        assert.equal(decideGtkSource({ platform: 'win32', ...both, override: '' }), 'bundle');
    });
});

describe('decideGtkSource: today’s behaviour is preserved', () => {
    it('is a no-op on a stock linux host: system, exactly as before', () => {
        // No linux bundle ships, so this is every Linux user and every Linux CI
        // job in this repo. The policy must not move them.
        assert.equal(decideGtkSource({ platform: 'linux', hasBundle: false, hasSystem: true }), 'system');
    });

    it('keeps an installed darwin bundle winning for a prebuild, as it did before', () => {
        assert.equal(decideGtkSource({ platform: 'darwin', ...both, provenance: 'prebuild' }), 'bundle');
    });
});
