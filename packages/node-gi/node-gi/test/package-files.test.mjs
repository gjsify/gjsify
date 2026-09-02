// SPDX-License-Identifier: MIT
// @gjsify/node-gi — every module a consumer can REACH is in the npm payload.
//
// THE DEFECT UNDER TEST, and it shipped. `index.js` gained a static
// `import './native-prebuilds.js'` while the `files` allowlist never listed it, so
// the tarball carried the import and not the module: `import '@gjsify/node-gi'` threw
// ERR_MODULE_NOT_FOUND on every platform and every runtime — the whole package, not
// the one new feature.
//
// WHY NOTHING SAW IT. `packages/node-gi/example` depends on the runtime as
// `file:../node-gi`, which npm SYMLINKS, so `files` is never applied on the one path
// in CI that imports the published shape. `assertTypeDeclarationsShipped` in the
// packer covers `types`/`typings` only. `scripts/verify-tarball-outputs.mjs` covers
// DECLARED entry points — and iterates the workspace globs, which node-gi is
// deliberately outside of (ADR 0031), so it never looks here at all. The first check
// that would have caught it is the cross-platform probe `release.yml` dispatches
// AFTER `publish-node-gi`, by which point the tarball is on npm and the version is
// spent.
//
// So the question this asks is the narrow one nothing else does: starting from what
// `exports` + `main` DECLARE, does the relative-import graph stay inside `files`?
// It is not a second packer — it never enumerates a tarball. It reads the literal
// entries of ONE allowlist and REFUSES rather than guesses if a pattern appears there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

/** Every path `exports` and `main` promise a consumer, as package-relative paths. */
function declaredEntryPoints(pkg) {
    const out = new Set();
    const visit = (value) => {
        if (typeof value === 'string') {
            if (value.startsWith('./')) out.add(value.slice(2));
            return;
        }
        if (value && typeof value === 'object') for (const v of Object.values(value)) visit(v);
    };
    visit(pkg.exports);
    visit(pkg.main);
    return [...out];
}

/**
 * Is `relPath` inside the `files` allowlist?
 *
 * node-gi's allowlist is literal — file names and plain directory names, no patterns —
 * so "equal, or under a listed directory" is the whole rule. A pattern would make that
 * rule a guess, and the assertion below refuses on one instead of quietly widening.
 */
function coveredByFiles(relPath, files) {
    return files.some((entry) => {
        const e = normalize(entry.replace(/^\.\//, ''));
        return relPath === e || relPath.startsWith(`${e}/`);
    });
}

/** Static relative specifiers in a module — `import`, `export … from`, `import()`. */
function relativeSpecifiers(source) {
    const out = [];
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bexport\s*\*\s*from\s*)['"](\.[^'"]*)['"]/g;
    for (const m of source.matchAll(re)) out.push(m[1]);
    return out;
}

test('the files allowlist is literal, so the coverage rule below is exact', () => {
    const files = manifest.files ?? [];
    assert.ok(files.length > 0, 'package.json has no "files" allowlist to check');
    const patterned = files.filter((f) => /[*?[\]{}!]/.test(f));
    assert.deepEqual(
        patterned,
        [],
        'A pattern in "files" makes the literal prefix rule in this test a guess. Teach the ' +
            'rule the pattern, or keep the allowlist literal — do not let it answer approximately.',
    );
});

test('every module reachable from a declared entry point is in the npm payload', () => {
    const files = manifest.files ?? [];
    const entries = declaredEntryPoints(manifest);
    assert.ok(entries.length > 0, 'no entry points declared — nothing to walk');

    const seen = new Set();
    const queue = [...entries];
    /** @type {{ file: string, importedBy: string }[]} */
    const unshipped = [];
    const roots = new Set(entries);

    while (queue.length > 0) {
        const rel = queue.shift();
        if (seen.has(rel)) continue;
        seen.add(rel);

        let source;
        try {
            source = readFileSync(join(packageRoot, rel), 'utf8');
        } catch {
            // Absent on disk is `verify-package-outputs.mjs`'s finding, not this one:
            // claiming it here would red-line a tree whose build has not run.
            continue;
        }
        for (const spec of relativeSpecifiers(source)) {
            const target = relative(packageRoot, resolve(packageRoot, dirname(rel), spec));
            if (target.startsWith('..')) continue; // outside the package; not ours to ship
            if (!coveredByFiles(target, files)) unshipped.push({ file: target, importedBy: rel });
            queue.push(target);
        }
    }

    // The entry points themselves, which is the half `verify-tarball-outputs.mjs`
    // would cover if it could see a non-workspace package.
    for (const rel of roots) {
        if (!coveredByFiles(rel, files)) unshipped.push({ file: rel, importedBy: 'package.json#exports' });
    }

    assert.deepEqual(
        unshipped,
        [],
        `${unshipped.length} module(s) are imported by the published entry graph but are NOT in ` +
            `"files", so the tarball would ship the import and not the module (ERR_MODULE_NOT_FOUND ` +
            `on first import): ${unshipped.map((u) => `${u.file} <- ${u.importedBy}`).join(', ')}`,
    );
});
