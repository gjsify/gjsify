// @gjsify/devtools-cdp — inspectorProtocolExtension — original implementation.
// Headless: an auto-replying mock WebSocket + injected fetch drive the handlers.

import { describe, expect, it } from '@gjsify/unit';

import { inspectorProtocolExtension } from './inspector-protocol-extension.js';
import type { WebSocketLike } from './inspector-protocol-client.js';

const LISTING = `<html><body>
  <a href="/socket/1/1/web-page">page one</a>
  <a href="/socket/1/2/service-worker">sw</a>
</body></html>`;

function fakeFetch(html: string): typeof fetch {
    return (async () =>
        ({ ok: true, status: 200, statusText: 'OK', text: async () => html }) as Response) as unknown as typeof fetch;
}

/** A mock WS that opens on the next microtask and echoes every request as its result. */
class AutoMockWS implements WebSocketLike {
    readyState = 0;
    readonly sent: string[] = [];
    private readonly handlers: Record<string, Array<(arg: unknown) => void>> = {
        open: [],
        message: [],
        close: [],
        error: [],
    };

    constructor() {
        queueMicrotask(() => {
            this.readyState = 1;
            for (const h of this.handlers.open) h(undefined);
        });
    }

    addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (arg: never) => void): void {
        this.handlers[type].push(listener as (arg: unknown) => void);
    }

    send(data: string): void {
        this.sent.push(data);
        const { id, method, params } = JSON.parse(data);
        // Echo the request back as the result, so enable()s + CdpSend round-trip.
        for (const h of this.handlers.message) h({ data: JSON.stringify({ id, result: { method, params } }) });
    }

    close(): void {
        this.readyState = 3;
        for (const h of this.handlers.close) h({});
    }

    emitEvent(method: string, params: unknown): void {
        for (const h of this.handlers.message) h({ data: JSON.stringify({ method, params }) });
    }
}

function makeExtension() {
    const sockets: AutoMockWS[] = [];
    const ext = inspectorProtocolExtension({
        port: 9222,
        createWebSocket: () => {
            const ws = new AutoMockWS();
            sockets.push(ws);
            return ws;
        },
        fetchImpl: fakeFetch(LISTING),
    });
    const h = ext.handlers as {
        CdpDiscoverTargets: () => Promise<string>;
        CdpConnect: (targetJson: string) => Promise<boolean>;
        CdpSend: (method: string, paramsJson: string) => Promise<string>;
        CdpDrainEvents: () => string;
    };
    return { ext, h, sockets };
}

export default async () => {
    await describe('inspectorProtocolExtension shape', async () => {
        await it('declares the four Cdp* methods with correct kinds', async () => {
            const { ext } = makeExtension();
            expect(ext.methodsXml?.length).toBe(4);
            expect(ext.methodKinds.CdpSend).toBe('mutating');
            expect(ext.methodKinds.CdpDiscoverTargets).toBe('read-only');
            expect(ext.methodKinds.CdpConnect).toBe('read-only');
            expect(ext.methodKinds.CdpDrainEvents).toBe('read-only');
        });

        await it('contributeStatus reports inspector{port,host,connected}', async () => {
            const { ext } = makeExtension();
            const status = ext.contributeStatus?.() as {
                inspector: { port: number; host: string; connected: boolean };
            };
            expect(status.inspector.port).toBe(9222);
            expect(status.inspector.host).toBe('127.0.0.1');
            expect(status.inspector.connected).toBeFalsy();
        });
    });

    await describe('CdpDiscoverTargets', async () => {
        await it('returns the parsed targets as JSON', async () => {
            const { h } = makeExtension();
            const targets = JSON.parse(await h.CdpDiscoverTargets());
            expect(targets.length).toBe(2);
            expect(targets[0].wsUrl).toBe('ws://127.0.0.1:9222/socket/1/1/web-page');
        });
    });

    await describe('CdpConnect', async () => {
        await it('connects to the first web-page target and reports connected', async () => {
            const { ext, h } = makeExtension();
            expect(await h.CdpConnect('')).toBeTruthy();
            const status = ext.contributeStatus?.() as { inspector: { connected: boolean; targetCount: number } };
            expect(status.inspector.connected).toBeTruthy();
            expect(status.inspector.targetCount).toBe(1);
        });

        await it('sends the auto-enable domains on connect', async () => {
            const { h, sockets } = makeExtension();
            await h.CdpConnect('');
            const methods = sockets[0].sent.map((s) => JSON.parse(s).method);
            expect(methods).toStrictEqual(['Inspector.enable', 'Runtime.enable', 'DOM.enable', 'Console.enable']);
        });

        await it('honours an explicit target with a wsUrl (no discovery)', async () => {
            const { h, sockets } = makeExtension();
            const ok = await h.CdpConnect(JSON.stringify({ wsUrl: 'ws://127.0.0.1:9222/socket/9/9/web-page' }));
            expect(ok).toBeTruthy();
            // first send goes to the explicit socket
            expect(sockets.length).toBe(1);
        });
    });

    await describe('CdpSend', async () => {
        await it('rejects before connect', async () => {
            const { h } = makeExtension();
            let threw = false;
            try {
                await h.CdpSend('Runtime.evaluate', '{}');
            } catch {
                threw = true;
            }
            expect(threw).toBeTruthy();
        });

        await it('round-trips a command + params to the current target', async () => {
            const { h } = makeExtension();
            await h.CdpConnect('');
            const result = JSON.parse(await h.CdpSend('Runtime.evaluate', JSON.stringify({ expression: '1+1' })));
            // the mock echoes {method, params} as the result
            expect(result.method).toBe('Runtime.evaluate');
            expect(result.params).toStrictEqual({ expression: '1+1' });
        });

        await it('accepts an empty params string', async () => {
            const { h } = makeExtension();
            await h.CdpConnect('');
            const result = JSON.parse(await h.CdpSend('Page.reload', ''));
            expect(result.method).toBe('Page.reload');
        });
    });

    await describe('CdpDrainEvents', async () => {
        await it('returns [] before connect', async () => {
            const { h } = makeExtension();
            expect(JSON.parse(h.CdpDrainEvents())).toStrictEqual([]);
        });

        await it('returns then clears buffered protocol events', async () => {
            const { h, sockets } = makeExtension();
            await h.CdpConnect('');
            sockets[0].emitEvent('Console.messageAdded', { message: { text: 'hi' } });
            sockets[0].emitEvent('Page.frameNavigated', { url: 'https://x' });
            const drained = JSON.parse(h.CdpDrainEvents());
            expect(drained.length).toBe(2);
            expect(drained[0]).toStrictEqual({ method: 'Console.messageAdded', params: { message: { text: 'hi' } } });
            expect(JSON.parse(h.CdpDrainEvents()).length).toBe(0);
        });
    });
};
