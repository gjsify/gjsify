// Integration: @gjsify/devtools-cdp's InspectorProtocolClient against a LIVE
// WebKit remote inspector. Ported from refs/webkit/LayoutTests/inspector/{runtime,dom}.
//
// Opt-in + skip-if-unreachable (like tests/integration/autobahn): a real WebKit
// inspector isn't available headlessly/in CI, so this suite SKIPS unless an
// inspector is reachable. Run it against a live browser:
//
//   gjsify browse https://example.org --inspector-port 9222   # terminal 1
//   GJSIFY_CDP_INSPECTOR_PORT=9222 \
//     gjsify workspace @gjsify/integration-devtools-cdp test   # terminal 2
//
// With GJSIFY_CDP_INSPECTOR_PORT unset (CI default), the suite registers a single
// passing "skipped" test and exits 0.

import GLib from '@girs/glib-2.0';
import { describe, expect, it, on } from '@gjsify/unit';

import { type InspectorTarget, InspectorProtocolClient, discoverInspectorTargets } from '@gjsify/devtools-cdp';

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Poll for a reachable web-page target (the browser may still be starting). */
async function reachWebPageTarget(port: number, timeoutMs = 15000): Promise<InspectorTarget | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const targets = await discoverInspectorTargets(port);
            const page = targets.find((t) => t.targetType === 'web-page') ?? targets[0];
            if (page) return page;
        } catch {
            // connection refused while the inspector server is still binding
        }
        await delay(750);
    }
    return null;
}

export default async () => {
    await on('Gjs', async () => {
        const portStr = GLib.getenv('GJSIFY_CDP_INSPECTOR_PORT');
        const port = portStr ? Number.parseInt(portStr, 10) : NaN;
        const target = Number.isFinite(port) ? await reachWebPageTarget(port) : null;

        if (!target) {
            await describe('devtools-cdp live inspector', async () => {
                await it('skipped — no reachable inspector (set GJSIFY_CDP_INSPECTOR_PORT; see README)', async () => {
                    expect(true).toBeTruthy();
                });
            });
            return;
        }

        const client = new InspectorProtocolClient(target.wsUrl);
        await client.connect();
        await client.enableDomains(['Inspector', 'Runtime', 'DOM', 'Console']);

        await describe('devtools-cdp live inspector — Runtime', async () => {
            await it('evaluate "1 + 1" returns 2 by value', async () => {
                const r = (await client.send('Runtime.evaluate', {
                    expression: '1 + 1',
                    returnByValue: true,
                })) as { result: { value: number }; wasThrown?: boolean };
                expect(r.wasThrown).toBeFalsy();
                expect(r.result.value).toBe(2);
            });

            await it('evaluate "({x:1})" yields an object handle', async () => {
                const r = (await client.send('Runtime.evaluate', { expression: '({x:1})' })) as {
                    result: { type: string; objectId?: string };
                };
                expect(r.result.type).toBe('object');
                expect(typeof r.result.objectId).toBe('string');
            });

            await it('evaluating an undefined reference sets wasThrown', async () => {
                const r = (await client.send('Runtime.evaluate', {
                    expression: 'gjsify_cdp_no_such_identifier_xyz',
                })) as { wasThrown?: boolean };
                expect(r.wasThrown).toBeTruthy();
            });
        });

        await describe('devtools-cdp live inspector — DOM', async () => {
            let rootNodeId = 0;

            await it('getDocument returns the #document root', async () => {
                const r = (await client.send('DOM.getDocument', {})) as {
                    root: { nodeId: number; nodeName: string; nodeType: number };
                };
                expect(r.root.nodeName).toBe('#document');
                expect(r.root.nodeType).toBe(9);
                expect(r.root.nodeId).toBeTruthy();
                rootNodeId = r.root.nodeId;
            });

            await it('querySelector finds the body element', async () => {
                const r = (await client.send('DOM.querySelector', { nodeId: rootNodeId, selector: 'body' })) as {
                    nodeId: number;
                };
                expect(r.nodeId).toBeTruthy();
                const html = (await client.send('DOM.getOuterHTML', { nodeId: r.nodeId })) as { outerHTML: string };
                expect(/^<body/i.test(html.outerHTML.trim())).toBeTruthy();
            });

            await it('querySelectorAll returns a nodeIds array', async () => {
                const r = (await client.send('DOM.querySelectorAll', { nodeId: rootNodeId, selector: 'div' })) as {
                    nodeIds: number[];
                };
                expect(Array.isArray(r.nodeIds)).toBeTruthy();
            });
        });

        client.close();
    });
};
