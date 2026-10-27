// SPDX-License-Identifier: MIT
// PoC harness — a static file server for the browser leg. Two roots, because the
// engine is build output (gitignored, NODE_GI_WASM_DIR) while the harness and the
// package are source:
//
//   /engine/...  -> $NODE_GI_WASM_DIR        (node_gi.mjs, node_gi.wasm, emnapi.mjs)
//   /...         -> the worktree root        (docs/poc/..., packages/node-gi/...)
//
// Deliberately NOT cross-origin isolated: the point of the prototype is that the
// single-threaded build needs no COOP/COEP, so a page can load it from any host.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
};

/**
 * Serve the worktree and the engine directory over one origin.
 * @param {string} root worktree root (source side)
 * @param {string} engineDir directory holding node_gi.mjs / node_gi.wasm / emnapi.mjs
 * @param {number} port 0 to let the OS pick
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serve(root, engineDir, port = 0) {
    const server = createServer(async (req, res) => {
        // A path is resolved against exactly one root and normalized first, so a
        // `..` segment cannot climb out of either.
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const engine = path.startsWith('/engine/');
        const rel = normalize(engine ? path.slice('/engine'.length) : path).replace(/^(\.\.[/\\])+/, '');
        const file = join(engine ? engineDir : root, rel === '/' ? '/docs/poc/gobject-wasm/harness/index.html' : rel);
        try {
            const info = await stat(file);
            if (!info.isFile()) throw new Error('not a file');
            res.writeHead(200, {
                'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
                'content-length': info.size,
                'cache-control': 'no-store',
            });
            createReadStream(file).pipe(res);
        } catch {
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end(`not found: ${path}\n`);
        }
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}
