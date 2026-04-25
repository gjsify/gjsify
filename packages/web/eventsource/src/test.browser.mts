import { run, describe, it, expect } from '@gjsify/unit';

run({
    async EventSourceTest() {
        await describe('EventSource static constants', async () => {
            await it('CONNECTING = 0', async () => {
                expect(EventSource.CONNECTING).toBe(0);
            });

            await it('OPEN = 1', async () => {
                expect(EventSource.OPEN).toBe(1);
            });

            await it('CLOSED = 2', async () => {
                expect(EventSource.CLOSED).toBe(2);
            });
        });

        await describe('EventSource instance', async () => {
            await it('starts in CONNECTING state', async () => {
                const es = new EventSource('http://localhost:9999/nonexistent');
                expect(es.readyState).toBe(EventSource.CONNECTING);
                es.close();
            });

            await it('close() transitions to CLOSED', async () => {
                const es = new EventSource('http://localhost:9999/nonexistent');
                es.close();
                expect(es.readyState).toBe(EventSource.CLOSED);
            });

            await it('url property matches constructor argument', async () => {
                const url = 'http://localhost:9999/sse';
                const es = new EventSource(url);
                expect(es.url).toBe(url);
                es.close();
            });

            await it('withCredentials is false by default', async () => {
                const es = new EventSource('http://localhost:9999/sse');
                expect(es.withCredentials).toBe(false);
                es.close();
            });

            await it('event handler properties exist and are null', async () => {
                const es = new EventSource('http://localhost:9999/sse');
                expect(es.onopen).toBeNull();
                expect(es.onmessage).toBeNull();
                expect(es.onerror).toBeNull();
                es.close();
            });
        });
    },
});
