import { firefox } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = '/home/jumplink/Projekte/.worktrees/gjsify-gtk-docs';
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
const server = createServer(async (req, res) => {
    try {
        const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
        const buf = await readFile(p);
        res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
        res.end(buf);
    } catch {
        res.writeHead(404).end('no');
    }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await firefox.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/tests/browser/harness/index.html?bundle=${encodeURIComponent('/packages/web/adwaita-web/dist/test.browser.mjs')}`);
await page.waitForSelector('[data-tests-done="true"]', { timeout: 120000 });
const out = await page.evaluate(() => {
    const r = {};
    const probe = (flow) => {
        const host = document.createElement('div');
        host.style.width = '300px';
        document.body.appendChild(host);
        const g = document.createElement('div');
        g.style.display = 'grid';
        g.style.gridAutoFlow = flow;
        for (let i = 0; i < 3; i++) {
            const c = document.createElement('div');
            c.textContent = `cell ${i}`;
            c.style.display = 'flex';
            g.append(c);
        }
        host.appendChild(g);
        const rects = [...g.children].map((c) => {
            const b = c.getBoundingClientRect();
            return `${Math.round(b.left)},${Math.round(b.top)}`;
        });
        host.remove();
        return rects;
    };
    r.row = probe('row');
    r.column = probe('column');
    r.dense = probe('row dense');

    // aspect-ratio serialization in this engine
    const d = document.createElement('div');
    d.style.aspectRatio = '2.5';
    r.aspectRatio = d.style.aspectRatio;
    d.style.aspectRatio = '2.5 / 1';
    r.aspectRatioSlash = d.style.aspectRatio;
    return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();