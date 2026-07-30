// Coverage for the SHARED root-relative rewrite (utils/root-relative.ts).
//
// The regression it pins: fetch and XHR used to carry two hand-written copies
// of this rewrite, and the fetch copy drifted (reading the GJS-only
// `globalThis.imports.system`) — every root-relative `fetch()` then died with
// `ERR_INVALID_URL` on the node-gi reverse bridge while XHR kept working
// (#869). One function, consumed by both, tested here on gjs AND node.

import { describe, expect, it } from '@gjsify/unit';
import { resolveRootRelativeUrl } from './utils/root-relative.js';

export default async () => {
    await describe('fetch.resolveRootRelativeUrl', async () => {
        await it('maps a root-relative URL to file:// under the program dir', async () => {
            const rewritten = resolveRootRelativeUrl('/res/tilemaps/level1.tmx');
            // The program path differs per runtime (test bundle path on gjs,
            // `process.argv[1]` on node) — assert the CONTRACT, not the host.
            expect(rewritten.startsWith('file:///')).toBe(true);
            expect(rewritten.endsWith('/res/tilemaps/level1.tmx')).toBe(true);
        });

        await it('leaves a protocol-relative URL (//host/...) untouched', async () => {
            expect(resolveRootRelativeUrl('//cdn.example.com/x.png')).toBe('//cdn.example.com/x.png');
        });

        await it('leaves absolute and relative URLs untouched', async () => {
            expect(resolveRootRelativeUrl('https://example.com/a')).toBe('https://example.com/a');
            expect(resolveRootRelativeUrl('res/local.png')).toBe('res/local.png');
        });
    });
};
