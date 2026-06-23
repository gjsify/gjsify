// @gjsify/devtools-cdp — InspectorProtocolClient — original implementation.
// Headless: a mock WebSocket drives the protocol, no real inspector/libsoup.

import { describe, expect, it } from '@gjsify/unit';

import { InspectorProtocolClient, ProtocolError, type WebSocketLike } from './inspector-protocol-client.js';

/** A controllable WebSocket double implementing the WebSocketLike surface. */
class MockWebSocket implements WebSocketLike {
    readyState = 0; // CONNECTING
    readonly sent: string[] = [];
    closed = false;
    private readonly handlers: Record<string, Array<(arg: unknown) => void>> = {
        open: [],
        message: [],
        close: [],
        error: [],
    };

    addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (arg: never) => void): void {
        this.handlers[type].push(listener as (arg: unknown) => void);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
        this.readyState = 3;
        for (const h of this.handlers.close) h({});
    }

    // --- test drivers ---
    emitOpen(): void {
        this.readyState = 1;
        for (const h of this.handlers.open) h(undefined);
    }
    emitMessage(obj: unknown): void {
        for (const h of this.handlers.message) h({ data: JSON.stringify(obj) });
    }
    emitError(): void {
        for (const h of this.handlers.error) h(new Error('mock error'));
    }
    lastSent(): { id?: number; method?: string; params?: unknown } {
        return JSON.parse(this.sent[this.sent.length - 1]);
    }
}

function makeClient(timeoutMs = 0): { client: InspectorProtocolClient; ws: MockWebSocket } {
    const ws = new MockWebSocket();
    const client = new InspectorProtocolClient('ws://test/socket/1/2/web-page', {
        createWebSocket: () => ws,
        requestTimeoutMs: timeoutMs,
    });
    return { client, ws };
}

export default async () => {
    await describe('InspectorProtocolClient.connect', async () => {
        await it('resolves on the open event', async () => {
            const { client, ws } = makeClient();
            const p = client.connect();
            ws.emitOpen();
            await p;
            expect(client.connected).toBeTruthy();
        });

        await it('rejects when the socket closes before opening', async () => {
            const { client, ws } = makeClient();
            const p = client.connect();
            ws.close();
            let threw = false;
            try {
                await p;
            } catch {
                threw = true;
            }
            expect(threw).toBeTruthy();
        });

        await it('connect() is idempotent (same promise)', async () => {
            const { client, ws } = makeClient();
            const a = client.connect();
            const b = client.connect();
            ws.emitOpen();
            await a;
            expect(a).toBe(b);
        });
    });

    await describe('InspectorProtocolClient.send', async () => {
        await it('resolves with the result for a matching id', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const p = client.send('Runtime.evaluate', { expression: '1+1' });
            const req = ws.lastSent();
            expect(req.method).toBe('Runtime.evaluate');
            expect(typeof req.id).toBe('number');
            ws.emitMessage({ id: req.id, result: { value: 2 } });
            expect(await p).toStrictEqual({ value: 2 });
        });

        await it('rejects with a ProtocolError on a protocol error reply', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const p = client.send('DOM.querySelector', { selector: '###' });
            const req = ws.lastSent();
            ws.emitMessage({ id: req.id, error: { code: -32000, message: 'bad selector' } });
            let err: unknown;
            try {
                await p;
            } catch (e) {
                err = e;
            }
            expect(err instanceof ProtocolError).toBeTruthy();
            expect((err as ProtocolError).message).toBe('bad selector');
            expect((err as ProtocolError).code).toBe(-32000);
        });

        await it('correlates concurrent requests to the right results (out-of-order replies)', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const pA = client.send('A.one');
            const idA = ws.lastSent().id;
            const pB = client.send('B.two');
            const idB = ws.lastSent().id;
            expect(idA).not.toBe(idB);
            // reply B first, then A
            ws.emitMessage({ id: idB, result: { who: 'B' } });
            ws.emitMessage({ id: idA, result: { who: 'A' } });
            expect(await pA).toStrictEqual({ who: 'A' });
            expect(await pB).toStrictEqual({ who: 'B' });
        });

        await it('rejects after the request timeout when no reply arrives', async () => {
            const { client, ws } = makeClient(40);
            const c = client.connect();
            ws.emitOpen();
            await c;
            let threw = false;
            try {
                await client.send('Never.replies');
            } catch {
                threw = true;
            }
            expect(threw).toBeTruthy();
        });
    });

    await describe('InspectorProtocolClient events', async () => {
        await it('dispatches a pushed event to on() listeners', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            let got: unknown;
            client.on('Console.messageAdded', (params) => {
                got = params;
            });
            ws.emitMessage({ method: 'Console.messageAdded', params: { message: { text: 'hi' } } });
            expect(got).toStrictEqual({ message: { text: 'hi' } });
        });

        await it('off() / the unsubscribe stops delivery', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            let count = 0;
            const off = client.on('X.evt', () => {
                count++;
            });
            ws.emitMessage({ method: 'X.evt', params: {} });
            off();
            ws.emitMessage({ method: 'X.evt', params: {} });
            expect(count).toBe(1);
        });

        await it('awaitEvent resolves on the next matching event', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const p = client.awaitEvent('Page.frameNavigated');
            ws.emitMessage({ method: 'Page.frameNavigated', params: { url: 'https://x' } });
            expect(await p).toStrictEqual({ url: 'https://x' });
        });

        await it('awaitEvent honours the predicate', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const p = client.awaitEvent('N.tick', (params) => (params as { n: number }).n === 2);
            ws.emitMessage({ method: 'N.tick', params: { n: 1 } });
            ws.emitMessage({ method: 'N.tick', params: { n: 2 } });
            expect(await p).toStrictEqual({ n: 2 });
        });

        await it('drainEvents returns then clears the ring buffer', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            ws.emitMessage({ method: 'E.a', params: { i: 1 } });
            ws.emitMessage({ method: 'E.b', params: { i: 2 } });
            const drained = client.drainEvents();
            expect(drained.length).toBe(2);
            expect(drained[0]).toStrictEqual({ method: 'E.a', params: { i: 1 } });
            expect(client.drainEvents().length).toBe(0);
        });
    });

    await describe('InspectorProtocolClient.enableDomains', async () => {
        await it('sends <Domain>.enable for each domain', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const p = client.enableDomains(['Inspector', 'Runtime', 'DOM']);
            // enableDomains sends sequentially (awaits each reply). Reply to each
            // message by index once it appears, yielding microtasks so the next
            // send's continuation can run.
            for (let i = 0; i < 3; i++) {
                while (ws.sent.length < i + 1) await Promise.resolve();
                const req = JSON.parse(ws.sent[i]);
                ws.emitMessage({ id: req.id, result: {} });
            }
            await p;
            const methods = ws.sent.map((s) => JSON.parse(s).method);
            expect(methods).toStrictEqual(['Inspector.enable', 'Runtime.enable', 'DOM.enable']);
        });
    });

    await describe('InspectorProtocolClient.close', async () => {
        await it('rejects all in-flight requests', async () => {
            const { client, ws } = makeClient();
            const c = client.connect();
            ws.emitOpen();
            await c;
            const p = client.send('Will.beAborted');
            client.close();
            let threw = false;
            try {
                await p;
            } catch {
                threw = true;
            }
            expect(threw).toBeTruthy();
            expect(client.connected).toBeFalsy();
        });
    });
};
