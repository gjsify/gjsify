// E2E test for the `bundled-license` conformance rule — "a package that ships OTHER
// projects' binaries may not declare only its own licence" — and, above all, for the
// question a rule is rarely asked: WHICH PACKAGES DID IT LOOK AT.
//
// WHY IT EXISTS. The rule's trigger is `files` naming a payload directory, and `files`
// is an ordinary edit. Narrowing a bundle's from `gtk` to `gtk/bin` + `gtk/lib` +
// `gtk/share` — a plausible way to trim a tarball — took the package out of the rule at
// exit 0 with the payload, the notice and the relocated LGPL/MPL/GPL libraries all still
// in it. Measured on this repository with the same edit: `media-capabilities` failed by
// name and `bundled-license` printed NOTHING, having quietly audited one package fewer
// than the repository publishes. `field-coverage` cannot see it either — it matches key
// NAMES across the tree, so the packages that stayed satisfy coverage for the one that
// left.
//
// A rule that can be switched off by editing the manifest it audits is worse than a
// missing rule, because a green run then reads as a pass. So the trigger is held against
// itself: a `license` deferring to a notice INSIDE a payload directory is the package's
// own statement that it redistributes one, it survives the narrowing, and it collects
// the package so the audit can fail it by name. Same mechanism `media-capabilities` uses
// with `gjsify.mediaCapabilities`, against the same edit.
//
// AND THE REAL TREE IS ASSERTED TOO, at the end. A rule driven only by fixtures it wrote
// itself can be correct about nothing: the last suite names every bundling package this
// repository publishes and re-runs the narrowing against the REAL win32 manifest — the
// real `files`, the real `license` — so the escape route is proven closed on the artifact
// it was measured on rather than on a fixture shaped to fail.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CONFORMANCE = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs');

const { auditBundledLicense, collectBundlingPackages, createContext } = await import(`file://${CONFORMANCE}`);

/** Every package this repository publishes with a third-party payload inside it. */
const BUNDLING_PACKAGES = [
    '@gjsify/gtk-runtime-darwin-arm64',
    '@gjsify/gtk-runtime-darwin-x64',
    '@gjsify/gtk-runtime-win32-x64',
    '@gjsify/node-runtime-darwin-arm64',
    '@gjsify/node-runtime-darwin-x64',
    '@gjsify/node-runtime-win32-x64',
];

/** The narrowing that measured the escape route — the payload still ships, entry by entry. */
const NARROWED_FILES = ['index.js', 'index.d.ts', 'gtk/bin', 'gtk/lib', 'gtk/share'];

/** The notice a runtime bundle defers its terms to, at the path it really uses. */
const NOTICE = 'gtk/THIRD-PARTY-NOTICES.md';

/**
 * A package record in the shape `collectBundlingPackages` produces, so the audit is
 * driven with exactly what the rule hands it and no adapter sits between the two.
 */
function packageRecord(name, { files = ['index.js', 'gtk'], license = `SEE LICENSE IN ${NOTICE}` } = {}) {
    const payload = files.filter((f) => f === 'gtk' || f === 'bin');
    return { name, path: `packages/node-gi/${name.replace('@gjsify/', '')}`, license, files, payload };
}

/** A context in the shape the rule reads — `allPackages` is the whole of what it touches. */
function contextOf(manifests) {
    return { allPackages: manifests.map((manifest, i) => ({ manifest, rel: `packages/fixture-${i}` })) };
}

/** Every failure line, joined — asserted on by substring, never by index. */
const text = (result) => result.failures.join('\n');

describe('bundled-license — the licence field against the payload', () => {
    it('passes a bundle deferring to a notice it ships', () => {
        const result = auditBundledLicense([packageRecord('@gjsify/gtk-runtime-a')]);
        assert.deepEqual(result.failures, []);
        assert.equal(result.stats.seeLicenseIn, 1);
    });

    it('fails the defect itself: MIT over a tarball of relocated LGPL libraries', () => {
        const result = auditBundledLicense([packageRecord('@gjsify/gtk-runtime-a', { license: 'MIT' })]);
        assert.match(text(result), /declares `"license": "MIT"` while shipping a third-party payload/);
    });

    it('fails a payload directory that is not `gtk/`', () => {
        // `bin` had to be added after `gtk`: a package redistributing a 120 MB interpreter
        // declared MIT at exit 0 while only `gtk` was known. The set is literal, so the
        // suite holds both members rather than only the one the rule was written for.
        const result = auditBundledLicense([
            packageRecord('@gjsify/node-runtime-a', { files: ['index.js', 'bin'], license: 'MIT' }),
        ]);
        assert.match(text(result), /while shipping a third-party payload \(bin\)/);
    });

    it('fails a bundle that declares no licence at all', () => {
        const result = auditBundledLicense([packageRecord('@gjsify/gtk-runtime-a', { license: null })]);
        assert.match(text(result), /declares no `license`/);
    });

    it('fails a notice the tarball does not ship, so the field cannot point at nothing', () => {
        // Outside a payload directory, so the trigger is satisfied and the licence is
        // judged rather than the trigger: the field names a file no consumer receives.
        const result = auditBundledLicense([
            packageRecord('@gjsify/gtk-runtime-a', { license: 'SEE LICENSE IN legal/NOTICES.md' }),
        ]);
        assert.match(text(result), /`files` does not ship "legal\/NOTICES\.md"/);
    });

    it('accepts a compound SPDX expression, which acknowledges the other terms too', () => {
        const result = auditBundledLicense([
            packageRecord('@gjsify/gtk-runtime-a', { license: 'MIT AND LGPL-2.1-or-later' }),
        ]);
        assert.deepEqual(result.failures, []);
        assert.equal(result.stats.compound, 1);
    });
});

describe('bundled-license — the trigger, held against itself', () => {
    it('FAILS BY NAME the narrowing that used to switch the rule off', () => {
        // THE NEGATIVE CONTROL. The licence still defers to a notice inside `gtk/`, so the
        // package still redistributes the payload; only the `files` entry the trigger keys
        // on is gone. Before this, the package left the rule and the run was green.
        const result = auditBundledLicense([packageRecord('@gjsify/gtk-runtime-a', { files: NARROWED_FILES })]);
        assert.match(text(result), /`files` ships no `gtk` entry/);
        assert.match(text(result), /@gjsify\/gtk-runtime-a/);
    });

    it('collects that package, which is the half a failure message cannot prove', () => {
        // The audit can only fail what it was handed. A suite asserting the message alone
        // would still pass if the collector dropped the package — and the collector IS what
        // the escape route walked out through.
        const collected = collectBundlingPackages(
            contextOf([{ name: '@gjsify/gtk-runtime-a', files: NARROWED_FILES, license: `SEE LICENSE IN ${NOTICE}` }]),
        );
        assert.deepEqual(
            collected.map((pkg) => pkg.name),
            ['@gjsify/gtk-runtime-a'],
        );
    });

    it('leaves an ordinary package deferring to its own LICENSE file alone', () => {
        // `SEE LICENSE IN` is npm's general form and this rule is `portable` — correct in
        // any npm package. Collecting every package that uses it would make the rule fail
        // over dual-licensed sources that redistribute nothing, and a check that fires on
        // innocent packages is one that gets read as noise and then switched off.
        const collected = collectBundlingPackages(
            contextOf([{ name: 'ordinary-package', files: ['dist'], license: 'SEE LICENSE IN LICENSE.md' }]),
        );
        assert.deepEqual(collected, []);
    });

    it('reads the notice path the way a tarball does, not as a string prefix', () => {
        // `gtkfoo/NOTICES.md` is not inside `gtk/`. A bare `startsWith` says it is, and the
        // second way in would then collect packages that ship no payload at all.
        const collected = collectBundlingPackages(
            contextOf([{ name: 'not-a-bundle', files: ['dist'], license: 'SEE LICENSE IN gtkfoo/NOTICES.md' }]),
        );
        assert.deepEqual(collected, []);
    });
});

describe('bundled-license — the packages this repository publishes', () => {
    const ctx = createContext({ root: MONOREPO_ROOT, discoveryRoots: ['packages'] });
    const packages = collectBundlingPackages(ctx);

    it('finds every bundling package, so nothing above was checked over an empty list', () => {
        // The positive fact, and the one this suite exists for: the escape route was a
        // package quietly LEAVING this list, which every assertion about failure messages
        // passes right over.
        assert.deepEqual(
            packages.map((pkg) => pkg.name).sort(),
            BUNDLING_PACKAGES,
            'the packages this repository publishes with a third-party payload are not the ones the rule found',
        );
    });

    it('holds them all — the same audit `audit-runtimes --check` runs on every PR', () => {
        assert.deepEqual(auditBundledLicense(packages).failures, []);
    });

    it('fails the REAL win32 bundle under the narrowing, licence and all', () => {
        // The same edit, applied to the manifest it was measured on rather than to a
        // fixture: the real `files`, the real `SEE LICENSE IN gtk/THIRD-PARTY-NOTICES.md`.
        const win32 = ctx.allPackages.find((pkg) => pkg.manifest.name === '@gjsify/gtk-runtime-win32-x64');
        assert.ok(win32, 'the win32 runtime bundle is not in this tree');
        const narrowed = collectBundlingPackages(contextOf([{ ...win32.manifest, files: NARROWED_FILES }]));
        assert.equal(narrowed.length, 1, 'the narrowed win32 manifest left the rule again');
        assert.match(text(auditBundledLicense(narrowed)), /`files` ships no `gtk` entry/);
    });
});
