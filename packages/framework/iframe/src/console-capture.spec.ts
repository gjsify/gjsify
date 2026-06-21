// Tests for console capture (console-capture.ts) — host-side parse + buffer +
// the injected-script builder. WebView-free (the live console-mirror round-trip
// is covered by the downstream browser tool's e2e).

import { describe, it, expect } from '@gjsify/unit';

import { buildConsoleCaptureScript, ConsoleBuffer, parseConsoleEnvelope } from './console-capture.js';

export default async () => {
    await describe('parseConsoleEnvelope', async () => {
        await it('parses a valid console envelope', async () => {
            const entry = parseConsoleEnvelope({ __gjsifyConsole: 'warn', args: ['a', 'b'] });
            expect(entry).toStrictEqual({ level: 'warn', args: ['a', 'b'] });
        });

        await it('coerces non-string args to strings', async () => {
            const entry = parseConsoleEnvelope({ __gjsifyConsole: 'log', args: [1, true, null] });
            expect(entry).toStrictEqual({ level: 'log', args: ['1', 'true', 'null'] });
        });

        await it('defaults missing args to an empty array', async () => {
            expect(parseConsoleEnvelope({ __gjsifyConsole: 'error' })).toStrictEqual({ level: 'error', args: [] });
        });

        await it('returns null for non-console envelopes', async () => {
            expect(parseConsoleEnvelope({ data: 'x', targetOrigin: '*', origin: 'y' })).toBeNull();
            expect(parseConsoleEnvelope({ __gjsifyPortMessage: 1, payload: {} })).toBeNull();
            expect(parseConsoleEnvelope(null)).toBeNull();
            expect(parseConsoleEnvelope('string')).toBeNull();
            expect(parseConsoleEnvelope({ __gjsifyConsole: 42 })).toBeNull();
        });
    });

    await describe('buildConsoleCaptureScript', async () => {
        await it('embeds the channel name and wraps each level', async () => {
            const script = buildConsoleCaptureScript('gjsify-iframe');
            expect(script).toContain(`messageHandlers[${JSON.stringify('gjsify-iframe')}]`);
            expect(script).toContain('__gjsifyConsole');
            for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
                expect(script).toContain(level);
            }
        });

        await it('carries an idempotency guard', async () => {
            expect(buildConsoleCaptureScript('ch')).toContain('__gjsifyConsoleHook');
        });

        await it('JSON-escapes the channel name', async () => {
            // A channel containing a quote must not break out of the string literal.
            const script = buildConsoleCaptureScript("a'b");
            expect(script).toContain(JSON.stringify("a'b"));
        });
    });

    await describe('ConsoleBuffer', async () => {
        await it('keeps entries in order', async () => {
            const buf = new ConsoleBuffer();
            buf.push({ level: 'log', args: ['1'] });
            buf.push({ level: 'warn', args: ['2'] });
            expect(buf.list()).toStrictEqual([
                { level: 'log', args: ['1'] },
                { level: 'warn', args: ['2'] },
            ]);
        });

        await it('caps at max, dropping the oldest', async () => {
            const buf = new ConsoleBuffer(2);
            buf.push({ level: 'log', args: ['1'] });
            buf.push({ level: 'log', args: ['2'] });
            buf.push({ level: 'log', args: ['3'] });
            const list = buf.list();
            expect(list.length).toBe(2);
            expect(list[0]!.args).toStrictEqual(['2']);
            expect(list[1]!.args).toStrictEqual(['3']);
        });

        await it('clear() empties the buffer', async () => {
            const buf = new ConsoleBuffer();
            buf.push({ level: 'log', args: ['x'] });
            buf.clear();
            expect(buf.list()).toStrictEqual([]);
        });

        await it('list() returns a copy (mutating it does not affect the buffer)', async () => {
            const buf = new ConsoleBuffer();
            buf.push({ level: 'log', args: ['x'] });
            buf.list().push({ level: 'warn', args: ['y'] });
            expect(buf.list().length).toBe(1);
        });
    });
};
