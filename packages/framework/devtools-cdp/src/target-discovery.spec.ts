// @gjsify/devtools-cdp — target-discovery — original implementation.
// Headless: parses a captured WebKit `GET /` listing; fetch is injected.

import { describe, expect, it } from '@gjsify/unit';

import { discoverInspectorTargets, type InspectorTarget, parseInspectorTargetsHtml } from './target-discovery.js';

// A representative WebKit remote-inspector landing page (`GET /`). WebKit lists
// each inspectable target as an <a href="/socket/{conn}/{target}/{type}">.
const LISTING_HTML = `<!DOCTYPE html>
<html><head><title>Remote Inspector</title></head>
<body>
  <h1>Inspectable Targets</h1>
  <ul>
    <li><a href="/socket/1/1/web-page">Example &amp; Co — https://example.org/</a></li>
    <li><a href="/socket/1/2/web-page">page:welcome</a></li>
    <li><a href="/socket/1/3/service-worker">sw.js</a></li>
  </ul>
</body></html>`;

const EMPTY_HTML = `<!DOCTYPE html><html><body><h1>Inspectable Targets</h1><p>No targets.</p></body></html>`;

function fakeFetch(html: string, status = 200): typeof fetch {
    return (async () =>
        ({
            ok: status >= 200 && status < 300,
            status,
            statusText: status === 200 ? 'OK' : 'Error',
            text: async () => html,
        }) as Response) as unknown as typeof fetch;
}

export default async () => {
    await describe('parseInspectorTargetsHtml', async () => {
        await it('parses every /socket/ anchor into a target', async () => {
            const targets = parseInspectorTargetsHtml(LISTING_HTML, '127.0.0.1', 9222);
            expect(targets.length).toBe(3);
        });

        await it('extracts connectionId / targetId / targetType', async () => {
            const [first] = parseInspectorTargetsHtml(LISTING_HTML, '127.0.0.1', 9222);
            expect(first.connectionId).toBe('1');
            expect(first.targetId).toBe('1');
            expect(first.targetType).toBe('web-page');
        });

        await it('builds the per-target ws:// URL with host + port', async () => {
            const [first] = parseInspectorTargetsHtml(LISTING_HTML, '127.0.0.1', 9222);
            expect(first.wsUrl).toBe('ws://127.0.0.1:9222/socket/1/1/web-page');
        });

        await it('decodes the anchor text into the title', async () => {
            const [first] = parseInspectorTargetsHtml(LISTING_HTML, '127.0.0.1', 9222);
            expect(first.title).toBe('Example & Co — https://example.org/');
        });

        await it('captures non-web-page target types', async () => {
            const targets = parseInspectorTargetsHtml(LISTING_HTML, '127.0.0.1', 9222);
            const sw = targets.find((t: InspectorTarget) => t.targetType === 'service-worker');
            expect(sw).toBeDefined();
            expect(sw!.targetId).toBe('3');
        });

        await it('returns [] for a listing with no targets', async () => {
            expect(parseInspectorTargetsHtml(EMPTY_HTML, '127.0.0.1', 9222).length).toBe(0);
        });

        await it('dedupes repeated identical anchors', async () => {
            const dup = `${LISTING_HTML}\n<a href="/socket/1/1/web-page">dup</a>`;
            const targets = parseInspectorTargetsHtml(dup, '127.0.0.1', 9222);
            expect(targets.filter((t: InspectorTarget) => t.targetId === '1').length).toBe(1);
        });
    });

    await describe('discoverInspectorTargets', async () => {
        await it('fetches GET / and returns parsed targets', async () => {
            const targets = await discoverInspectorTargets(9222, { fetchImpl: fakeFetch(LISTING_HTML) });
            expect(targets.length).toBe(3);
            expect(targets[1].wsUrl).toBe('ws://127.0.0.1:9222/socket/1/2/web-page');
        });

        await it('honours a custom host', async () => {
            const targets = await discoverInspectorTargets(9333, {
                host: '0.0.0.0',
                fetchImpl: fakeFetch(LISTING_HTML),
            });
            expect(targets[0].wsUrl).toBe('ws://0.0.0.0:9333/socket/1/1/web-page');
        });

        await it('returns [] when the server has no targets yet (race-safe)', async () => {
            expect((await discoverInspectorTargets(9222, { fetchImpl: fakeFetch(EMPTY_HTML) })).length).toBe(0);
        });

        await it('throws on a non-OK response', async () => {
            let threw = false;
            try {
                await discoverInspectorTargets(9222, { fetchImpl: fakeFetch('nope', 500) });
            } catch {
                threw = true;
            }
            expect(threw).toBeTruthy();
        });
    });
};
