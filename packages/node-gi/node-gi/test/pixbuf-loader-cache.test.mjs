// SPDX-License-Identifier: MIT
// The win32 bundle's `loaders.cache` — where it says its loader modules are, and the
// assertion that the answer resolves inside the bundle. The defect and the gdk-pixbuf
// source behind it: ../../scripts/pixbuf-loader-cache.mjs.
//
// The fixture is not invented. `RAW_CACHE` below is the shape gdk-pixbuf-query-loaders
// emits, and the leaf spelling the cases feed to `loaderCacheProblems` is byte-for-byte
// what the PUBLISHED gtk-runtime-win32-x64 windowing bundle ships.
//
// Driven from Linux because every function here is pure over its inputs. What CANNOT be
// asserted here is that gdk-pixbuf then LOADS the module; that is the decode probe's
// job, on a Windows runner, and it is what reported the defect in the first place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOADERS_SUBDIR, bundleRelativeLoaderCache, loaderCacheProblems } from '../../scripts/pixbuf-loader-cache.mjs';

/** What gdk-pixbuf-query-loaders.exe emits for a staged bundle: absolute, escaped. */
const RAW_CACHE = [
    '# GdkPixbuf Image Loader Modules file',
    '# Automatically generated file, do not edit',
    '# Created by gdk-pixbuf-query-loaders from gdk-pixbuf-2.44.6',
    '#',
    '"D:\\\\a\\\\gjsify\\\\gjsify\\\\packages\\\\node-gi\\\\gtk-runtime-win32-x64\\\\gtk\\\\lib\\\\gdk-pixbuf-2.0\\\\2.10.0\\\\loaders\\\\pixbufloader_svg.dll"',
    '"svg" 6 "gdk-pixbuf" "Scalable Vector Graphics" "LGPL"',
    '"image/svg+xml" "image/svg" "image/svg-xml" ""',
    '"svg" "svgz" "svg.gz" ""',
    '" <svg" "*    " 100',
    '',
].join('\r\n');

/** A bundle with the loader where the builder stages it. */
function stagedBundle({ loaders = ['pixbufloader_svg.dll'] } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-cache-'));
    mkdirSync(join(dir, ...LOADERS_SUBDIR.split('/')), { recursive: true });
    for (const leaf of loaders) writeFileSync(join(dir, ...LOADERS_SUBDIR.split('/'), leaf), 'MZ');
    return dir;
}

test('the module line is rewritten relative to the bundle TOPLEVEL, not to a leaf', () => {
    const out = bundleRelativeLoaderCache(RAW_CACHE);
    assert.match(out, /^"lib\/gdk-pixbuf-2\.0\/2\.10\.0\/loaders\/pixbufloader_svg\.dll"\r$/m);
    // The leaf is what shipped and what resolved to <bundle>\pixbufloader_svg.dll.
    assert.doesNotMatch(out, /^"pixbufloader_svg\.dll"/m);
    // And no build-host path survives.
    assert.doesNotMatch(out, /D:\\/);
});

test('nothing but the module line is touched', () => {
    const out = bundleRelativeLoaderCache(RAW_CACHE).split('\r\n');
    const raw = RAW_CACHE.split('\r\n');
    assert.equal(out.length, raw.length, 'line count must not move');
    for (const [i, line] of raw.entries()) {
        if (i === 4) continue; // the module line, asserted above
        assert.equal(out[i], line, `line ${i} must be untouched: ${line}`);
    }
    // In particular the format line leads with a quoted token too, and `"svg" 6 …` must
    // not be mistaken for a module path.
    assert.match(bundleRelativeLoaderCache(RAW_CACHE), /^"svg" 6 "gdk-pixbuf"/m);
});

test('forward slashes, because g_strcompress would eat the Windows spelling', () => {
    // `scan_string()` runs the quoted token through g_strcompress, where `\2` opens an
    // OCTAL escape — and the honest path `lib\gdk-pixbuf-2.0\2.10.0\loaders\…` contains
    // exactly that. A single-backslash spelling is silently corrupted, not rejected.
    const out = bundleRelativeLoaderCache(RAW_CACHE);
    const [modulePath] = /^"([^"]+\.dll)"/m.exec(out.split('\r\n').slice(4).join('\r\n')) ?? [];
    assert.ok(modulePath, out);
    assert.doesNotMatch(out, /^"[^"]*\\[^"]*\.dll"$/m, 'no backslash may reach the written cache');
});

test('a bare leaf FAILS the build — the exact cache that shipped', () => {
    const dir = stagedBundle();
    const shipped = RAW_CACHE.replace(/^".*pixbufloader_svg\.dll"$/m, '"pixbufloader_svg.dll"');
    const problems = loaderCacheProblems(shipped, { bundleDir: dir });
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /bare leaf pixbufloader_svg\.dll/);
    assert.match(problems[0], /TOPLEVEL/);
});

test('the un-rewritten absolute build path fails too', () => {
    const problems = loaderCacheProblems(RAW_CACHE, { bundleDir: stagedBundle() });
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /ABSOLUTE path/);
});

test('a cache naming a module the bundle does not ship fails', () => {
    // The class, not the one spelling: a stale subdir, or a loader the copy loop missed.
    const dir = stagedBundle();
    const stale = bundleRelativeLoaderCache(RAW_CACHE, { loadersSubdir: 'lib/gdk-pixbuf-2.0/2.10.0/modules' });
    const problems = loaderCacheProblems(stale, { bundleDir: dir });
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /does not exist under the bundle/);
});

test('a cache with no module at all is a failure, not an empty pass', () => {
    // gdk-pixbuf would fall back to its builtin loaders and decode PNG happily, which is
    // precisely how the SVG gap stayed invisible.
    const problems = loaderCacheProblems('# GdkPixbuf Image Loader Modules file\n#\n', { bundleDir: stagedBundle() });
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /names no loader module at all/);
});

test('the rewritten cache passes against the bundle the builder staged', () => {
    const dir = stagedBundle();
    assert.deepEqual(loaderCacheProblems(bundleRelativeLoaderCache(RAW_CACHE), { bundleDir: dir }), []);
});

test('every module line is read, not just the first', () => {
    // win32 ships one loader today. A second one arriving broken must not hide behind a
    // good first line — the same rule the typelib and license checks here follow.
    const dir = stagedBundle();
    const two = `${bundleRelativeLoaderCache(RAW_CACHE)}\r\n"pixbufloader_ico.dll"\r\n"ico" 4 "gdk-pixbuf" "ICO" "LGPL"\r\n`;
    const problems = loaderCacheProblems(two, { bundleDir: dir });
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /bare leaf pixbufloader_ico\.dll/);
});
