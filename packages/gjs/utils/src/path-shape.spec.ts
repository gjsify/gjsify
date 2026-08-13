// The win32 cases in here run — and matter — on a LINUX runner. That is the whole
// point of deciding from the path's shape instead of `process.platform` (#1143): the
// four copies of this bug that shipped were each unfailable on Linux, and CI is
// Linux-only. Nothing below is keyed to a host, so nothing below can hide.

import { describe, expect, it } from '@gjsify/unit';
import {
    encodePathForFileUrl,
    isWindowsPath,
    lastPathSeparatorIndex,
    pathToFileUrlHref,
    splitPathComponents,
} from './path-shape.js';

export default async () => {
    await describe('isWindowsPath', async () => {
        await it('should accept a drive-letter path with either separator', async () => {
            expect(isWindowsPath('C:\\app\\dist\\main.js')).toBe(true);
            expect(isWindowsPath('c:/app/dist/main.js')).toBe(true);
            expect(isWindowsPath('Z:\\')).toBe(true);
        });

        await it('should accept a UNC path', async () => {
            expect(isWindowsPath('\\\\server\\share\\app\\main.js')).toBe(true);
        });

        await it('should treat a backslash inside a POSIX path as DATA', async () => {
            // `\` is a legal character in a POSIX filename. Detecting Windows by
            // "contains a backslash" would rewrite this path's separators and hand the
            // caller a different file — hence drive-letter/UNC as the only evidence.
            expect(isWindowsPath('/tmp/we\\ird')).toBe(false);
            expect(isWindowsPath('/tmp/back\\slash/dir')).toBe(false);
        });

        await it('should reject POSIX paths, relative paths and near-misses', async () => {
            expect(isWindowsPath('/opt/app/dist/main.js')).toBe(false);
            expect(isWindowsPath('res/local.png')).toBe(false);
            expect(isWindowsPath('')).toBe(false);
            // A bare `C:` names no directory, and `1:` is not a drive.
            expect(isWindowsPath('C:')).toBe(false);
            expect(isWindowsPath('1:\\x')).toBe(false);
        });
    });

    await describe('lastPathSeparatorIndex', async () => {
        await it('should find a backslash separator in a Windows path', async () => {
            // The measured failure: -1 here is what made `fetch('/res/…')` return
            // unrewritten and die as `Invalid URL` on win32.
            expect(lastPathSeparatorIndex('C:\\app\\dist\\main.js')).toBe(11);
            expect('C:\\app\\dist\\main.js'.slice(0, 11)).toBe('C:\\app\\dist');
        });

        await it('should take the LAST separator when a Windows path mixes both', async () => {
            // Windows accepts both, and a path assembled from a config value plus a
            // literal commonly ends up mixed.
            expect(lastPathSeparatorIndex('C:\\app/dist\\main.js')).toBe(11);
            expect(lastPathSeparatorIndex('C:\\app\\dist/main.js')).toBe(11);
        });

        await it('should ignore a backslash in a POSIX path', async () => {
            expect(lastPathSeparatorIndex('/tmp/back\\slash')).toBe(4);
        });

        await it('should report -1 when there is no separator at all', async () => {
            expect(lastPathSeparatorIndex('main.js')).toBe(-1);
            expect(lastPathSeparatorIndex('')).toBe(-1);
        });

        await it('should report 0 for a path separated only at the root', async () => {
            // Callers distinguish this from -1 themselves — three of the four that
            // share this helper had different, established answers for it.
            expect(lastPathSeparatorIndex('/main.js')).toBe(0);
        });
    });

    await describe('splitPathComponents', async () => {
        await it('should split a Windows path on both separators', async () => {
            expect(splitPathComponents('C:\\app\\dist\\main.js')).toStrictEqual(['C:', 'app', 'dist', 'main.js']);
            expect(splitPathComponents('C:\\app/dist\\main.js')).toStrictEqual(['C:', 'app', 'dist', 'main.js']);
        });

        await it('should keep a backslash as data in a POSIX path', async () => {
            expect(splitPathComponents('/tmp/back\\slash')).toStrictEqual(['', 'tmp', 'back\\slash']);
        });
    });

    await describe('pathToFileUrlHref', async () => {
        await it('should map a POSIX path unchanged in shape', async () => {
            expect(pathToFileUrlHref('/opt/app/dist')).toBe('file:///opt/app/dist');
        });

        await it('should map a drive path to the three-slash empty-host form', async () => {
            expect(pathToFileUrlHref('C:\\app\\dist')).toBe('file:///C:/app/dist');
            expect(pathToFileUrlHref('c:/app/dist')).toBe('file:///c:/app/dist');
        });

        await it('should map a UNC path with the server as the URL HOST', async () => {
            expect(pathToFileUrlHref('\\\\server\\share\\app')).toBe('file://server/share/app');
        });

        await it('should produce hrefs that survive a URL round-trip', async () => {
            // URL parsing is host-independent, so this holds the win32 claim on any
            // runner: whatever `new URL()` does with the drive-letter quirk, the href
            // must come back out unchanged.
            for (const path of ['/opt/app/dist', 'C:\\app\\dist', '\\\\server\\share\\app']) {
                const href = pathToFileUrlHref(path);
                expect(new URL(href).href).toBe(href);
            }
        });

        await it('should be a base a root-relative path can be APPENDED to', async () => {
            // What #1143 needed, and why `@gjsify/fetch` CONCATENATES instead of calling
            // `new URL(url, base)`: resolution drops the program directory, keeping only
            // the root — and the two runtimes do not even agree on what the root is.
            // Measured: Node keeps the drive (`file:///C:/res/…`), GJS/SpiderMonkey does
            // not (`file:///res/…`). So resolution is both wrong for this purpose AND
            // host-dependent; the assertion below is neither.
            const base = pathToFileUrlHref('C:\\app\\dist');
            expect(`${base}/res/tilemaps/level1.tmx`).toBe('file:///C:/app/dist/res/tilemaps/level1.tmx');
            expect(new URL('/res/tilemaps/level1.tmx', base).href).not.toBe(
                'file:///C:/app/dist/res/tilemaps/level1.tmx',
            );
        });

        await it('should keep three slashes for a rooted driveless win32 path', async () => {
            // `\app\dist` is rooted on the CURRENT drive. It already supplies the third
            // slash, and prepending one anyway yields `file:////app/dist`, which parses
            // as a URL with an empty host and a `//app` path.
            expect(pathToFileUrlHref('\\app\\dist', { windows: true })).toBe('file:///app/dist');
            expect(new URL(pathToFileUrlHref('\\app\\dist', { windows: true })).pathname).toBe('/app/dist');
        });

        await it('should honour an explicit windows override either way', async () => {
            expect(pathToFileUrlHref('C:\\app', { windows: false })).toBe('file:///C:%5Capp');
            expect(pathToFileUrlHref('/opt/app', { windows: true })).toBe('file:///opt/app');
        });
    });

    await describe('encodePathForFileUrl', async () => {
        await it('should encode the characters that would otherwise become URL syntax', async () => {
            // `#` and `?` in a FILENAME are data; left intact they silently turn the
            // rest of the path into a fragment or a query.
            expect(encodePathForFileUrl('/t/a#b')).toBe('/t/a%23b');
            expect(encodePathForFileUrl('/t/a?b')).toBe('/t/a%3Fb');
            expect(encodePathForFileUrl('/t/a b')).toBe('/t/a%20b');
            expect(encodePathForFileUrl('/t/100%')).toBe('/t/100%25');
        });

        await it('should match Node character for character', async () => {
            // Measured against `pathToFileURL` over printable ASCII — including the two
            // surprises, `~` and `\`, which Node DOES encode.
            expect(encodePathForFileUrl("/t/!$&'()*+,-.:;=@_")).toBe("/t/!$&'()*+,-.:;=@_");
            expect(encodePathForFileUrl('/t/x~y')).toBe('/t/x%7Ey');
            expect(encodePathForFileUrl('/t/x\\y')).toBe('/t/x%5Cy');
        });

        await it('should encode a non-BMP character instead of throwing', async () => {
            // The index-based `encodeURIComponent` loop this replaced fed the function
            // one half of a surrogate pair and raised `URIError: URI malformed`, so
            // every path containing an emoji threw.
            expect(encodePathForFileUrl('/tmp/😀')).toBe('/tmp/%F0%9F%98%80');
            expect(encodePathForFileUrl('/tmp/𠜎')).toBe('/tmp/%F0%A0%9C%8E');
        });
    });
};
