// Coverage for the SHARED root-relative rewrite (utils/root-relative.ts).
//
// The regression it pins: fetch and XHR used to carry two hand-written copies
// of this rewrite, and the fetch copy drifted (reading the GJS-only
// `globalThis.imports.system`) — every root-relative `fetch()` then died with
// `ERR_INVALID_URL` on the node-gi reverse bridge while XHR kept working
// (#869). One function, consumed by both, tested here on gjs AND node.
//
// The PURE half (`rewriteRootRelativeUrl(url, programPath)`) is imported
// statically and covered on BOTH runtimes. The `system`-reading wrapper
// (`utils/root-relative-system.ts`) is deliberately NOT imported statically:
// on `--app node` the bare `system` built-in is aliased to
// `@gjsify/node-gi/system` and kept external, so a static import here would
// make the node test bundle hard-require the node-gi bridge — the exact
// cross-platform loadability this split exists to protect. The wrapper is
// instead exercised on gjs via the aliased package root (`import('fetch')`),
// which on node resolves to the harmless native-globals re-export.

import { describe, expect, it, on } from '@gjsify/unit';
import { rewriteRootRelativeUrl } from './utils/root-relative.js';

export default async () => {
    await describe('fetch.rewriteRootRelativeUrl (pure)', async () => {
        await it('maps a root-relative URL to file:// under the program dir', async () => {
            expect(rewriteRootRelativeUrl('/res/tilemaps/level1.tmx', '/opt/app/dist/main.js')).toBe(
                'file:///opt/app/dist/res/tilemaps/level1.tmx',
            );
        });

        await it('leaves a protocol-relative URL (//host/...) untouched', async () => {
            expect(rewriteRootRelativeUrl('//cdn.example.com/x.png', '/opt/app/dist/main.js')).toBe(
                '//cdn.example.com/x.png',
            );
        });

        await it('leaves absolute and relative URLs untouched', async () => {
            expect(rewriteRootRelativeUrl('https://example.com/a', '/opt/app/dist/main.js')).toBe(
                'https://example.com/a',
            );
            expect(rewriteRootRelativeUrl('res/local.png', '/opt/app/dist/main.js')).toBe('res/local.png');
        });

        await it('returns the input when no usable program dir exists', async () => {
            // '' (no program path at all) and a bare name (no directory part).
            expect(rewriteRootRelativeUrl('/res/x.png', '')).toBe('/res/x.png');
            expect(rewriteRootRelativeUrl('/res/x.png', 'main.js')).toBe('/res/x.png');
        });

        // #1143, measured on Windows 11: the program path is `C:\…\dist\main.js`, the old
        // `lastIndexOf('/')` returned -1, the "no program dir" guard swallowed it, and the
        // URL reached the `Request` constructor unrewritten — `Invalid URL` on bun and
        // deno, then a SIGSEGV / 0xC0000005. These run on the LINUX runner: the win32
        // answer is decided from the path's shape, so it needs no win32 host to check.
        await it('maps a root-relative URL under a win32 drive program path', async () => {
            expect(rewriteRootRelativeUrl('/res/tilemaps/level1.tmx', 'C:\\app\\dist\\main.js')).toBe(
                'file:///C:/app/dist/res/tilemaps/level1.tmx',
            );
        });

        await it('maps a root-relative URL under a UNC program path', async () => {
            expect(rewriteRootRelativeUrl('/res/x.png', '\\\\build\\share\\app\\dist\\main.js')).toBe(
                'file://build/share/app/dist/res/x.png',
            );
        });

        await it('keeps the query string a cache-busted asset request carries', async () => {
            // Only the DIRECTORY is percent-encoded. Encoding the URL half would turn
            // `?v=2` into `%3Fv=2` and ask for a file whose name contains a question mark.
            expect(rewriteRootRelativeUrl('/res/x.png?v=2', 'C:\\app\\dist\\main.js')).toBe(
                'file:///C:/app/dist/res/x.png?v=2',
            );
            expect(rewriteRootRelativeUrl('/res/x.png?v=2', '/opt/app/dist/main.js')).toBe(
                'file:///opt/app/dist/res/x.png?v=2',
            );
        });

        await it('percent-encodes a program dir that needs it', async () => {
            // A space in the program directory is ordinary on Windows (`C:\Program Files`)
            // and was previously emitted raw.
            expect(rewriteRootRelativeUrl('/res/x.png', 'C:\\Program Files\\app\\main.js')).toBe(
                'file:///C:/Program%20Files/app/res/x.png',
            );
        });

        await it('treats a backslash in a POSIX program path as part of the name', async () => {
            // `\` is legal in a POSIX filename, so this must NOT be read as a separator.
            expect(rewriteRootRelativeUrl('/res/x.png', '/opt/od\\d/main.js')).toBe('file:///opt/od%5Cd/res/x.png');
        });
    });

    // The `system`-reading wrapper, end to end on gjs — the runtime where the
    // program path is real. Reached through the aliased package root so the
    // node test bundle never links the `system` external (see file header).
    await on('Gjs', async () => {
        await describe('fetch.resolveRootRelativeUrl (system wrapper)', async () => {
            await it('maps a root-relative URL to file:// under the real program dir', async () => {
                // Namespace access (not a destructured binding): on the node
                // build this module is the globals re-export without the
                // wrapper, and only the gjs path ever reaches this line.
                const fetchModule = await import('fetch');
                const rewritten = fetchModule.resolveRootRelativeUrl('/res/tilemaps/level1.tmx');
                // The program path is the test bundle's own path — assert the
                // CONTRACT, not the host.
                expect(rewritten.startsWith('file:///')).toBe(true);
                expect(rewritten.endsWith('/res/tilemaps/level1.tmx')).toBe(true);
            });
        });
    });
};
