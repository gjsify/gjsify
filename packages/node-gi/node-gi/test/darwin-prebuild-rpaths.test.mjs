// SPDX-License-Identifier: MIT
// The LC_RPATH list the staged darwin addon carries — ADR 0023's precedence, encoded
// in the artifact.
//
// Runs on ANY host: `darwinAddonRpaths` takes the target as an argument, so both
// arches are checkable from a Linux runner. That is deliberate — the behaviour this
// protects is a macOS one, and an unexecutable branch is how the bug below shipped.
//
// The incident being encoded (#1120): node-gi's `stage-prebuild.mjs` only ever
// `copyFileSync`'d the addon, so the published darwin prebuild kept the BUILD HOST's
// absolute Homebrew paths (`/usr/local/opt/glib/lib/libgobject-2.0.0.dylib`) while
// every other darwin prebuild in the repo was relocated to `@rpath` by
// `scripts/relocate-macho.mjs` (#1102). On a Homebrew host those paths resolve, and
// `DYLD_FALLBACK_LIBRARY_PATH` — which node-gi's re-exec sets to point at the bundle —
// is consulted ONLY for a path that fails to resolve. So the addon bound Homebrew's
// libgobject while the bundle's libgtk/libadwaita bound the bundle's through their own
// `@loader_path`: two GObject type registries in one process. `g_object_class_find_
// property` then answered from the registry the types were not registered in and
// returned NULL for everything — `Adw.Application has no property 'application-id'`,
// and a composite template warning claiming an `Adw.ApplicationWindow` subclass was
// not a `Gtk.Widget`. Same two-GTKs-in-one-process failure #910 paid for.
//
// ORDER, not set membership, is what these assertions are about: dyld tries entries in
// the order they appear, so the list IS the policy. Set-equality is blind to exactly
// the regression that matters (a linker-baked entry keeping its position ahead of the
// bundle, inverting ADR 0023).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { darwinAddonRpaths } from '../scripts/stage-prebuild.mjs';

describe('darwinAddonRpaths: the bundle is searched before the system', () => {
    for (const target of ['darwin-x64', 'darwin-arm64']) {
        it(`orders ${target} as loader_path → sibling bundle → npm bundle → Homebrew`, () => {
            const rpaths = darwinAddonRpaths(target);
            const arch = target.slice('darwin-'.length);
            assert.deepEqual(rpaths, [
                '@loader_path',
                '@loader_path/gtk/lib',
                `@loader_path/../../../gtk-runtime-${target}/gtk/lib`,
                `${arch === 'x64' ? '/usr/local' : '/opt/homebrew'}/lib`,
            ]);
        });

        it(`puts every bundle entry ahead of the Homebrew prefix on ${target}`, () => {
            const rpaths = darwinAddonRpaths(target);
            const lastBundle = rpaths.findLastIndex((p) => p.includes('gtk/lib'));
            const system = rpaths.findIndex((p) => !p.startsWith('@'));
            assert.ok(lastBundle < system, `bundle entries must precede ${rpaths[system]}`);
        });

        it(`keeps the Homebrew fallback LAST on ${target}, never dropped`, () => {
            // An absolute LC_RPATH is a SEARCH path: dyld silently skips a missing one,
            // so keeping the build host's prefix last is a working fallback rather than
            // the "loads on the build host only" defect an absolute LC_LOAD_DYLIB is.
            // Dropping it would strand the Homebrew-only host that works today.
            const rpaths = darwinAddonRpaths(target);
            assert.equal(rpaths.at(-1), `${target === 'darwin-x64' ? '/usr/local' : '/opt/homebrew'}/lib`);
        });
    }

    it('refuses a target it has no Homebrew prefix for, rather than emitting undefined', () => {
        assert.throws(() => darwinAddonRpaths('darwin-ppc'), /no Homebrew prefix/);
    });
});
