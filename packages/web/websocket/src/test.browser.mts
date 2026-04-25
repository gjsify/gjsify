// Browser test entry for @gjsify/websocket.
// Uses the browser's native WebSocket, MessageEvent, and CloseEvent —
// no Soup server required. The round-trip and client-options tests
// (which spin up a Soup.Server) are GJS-only and not included here.
import { run, describe, it, expect } from '@gjsify/unit';

const testSuite = async () => {

    await describe('WebSocket (static)', async () => {
        await it('should be a constructor', async () => {
            expect(typeof WebSocket).toBe('function');
        });

        await it('should have readyState constants', async () => {
            expect(WebSocket.CONNECTING).toBe(0);
            expect(WebSocket.OPEN).toBe(1);
            expect(WebSocket.CLOSING).toBe(2);
            expect(WebSocket.CLOSED).toBe(3);
        });
    });

    await describe('MessageEvent', async () => {
        await it('should create with string data', async () => {
            const event = new MessageEvent('message', { data: 'hello' });
            expect(event.type).toBe('message');
            expect(event.data).toBe('hello');
        });

        await it('should create with object data', async () => {
            const event = new MessageEvent('message', {
                data: { key: 'value' },
                origin: 'ws://example.com',
            });
            expect(event.data).toStrictEqual({ key: 'value' });
            expect(event.origin).toBe('ws://example.com');
        });

        await it('should have bubbles false by default', async () => {
            const event = new MessageEvent('message', { data: 'x' });
            expect(event.bubbles).toBe(false);
        });
    });

    await describe('CloseEvent', async () => {
        await it('should create with defaults', async () => {
            const event = new CloseEvent('close');
            expect(event.type).toBe('close');
            expect(event.code).toBe(0);
            expect(event.reason).toBe('');
            expect(event.wasClean).toBe(false);
        });

        await it('should create with options', async () => {
            const event = new CloseEvent('close', { code: 1000, reason: 'done', wasClean: true });
            expect(event.code).toBe(1000);
            expect(event.reason).toBe('done');
            expect(event.wasClean).toBe(true);
        });
    });

    await describe('WebSocket module exports', async () => {
        await it('should export WebSocket class', async () => {
            expect(typeof WebSocket).toBe('function');
        });

        await it('should export MessageEvent class', async () => {
            expect(typeof MessageEvent).toBe('function');
        });

        await it('should export CloseEvent class', async () => {
            expect(typeof CloseEvent).toBe('function');
        });
    });
};

run({ testSuite });
