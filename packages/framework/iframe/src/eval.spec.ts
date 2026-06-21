// Tests for the pure evaluateJavaScript helpers (eval.ts).
// WebView-free — these exercise the wrapper-build + result-parse pipeline that
// IFrameBridge.evaluateJavaScript composes. The live-WebView round-trip is
// covered separately (needs a GDK display, see the package's testing notes).

import { describe, it, expect } from '@gjsify/unit';

import { buildEvalScript, parseEvalResult } from './eval.js';

export default async () => {
    await describe('buildEvalScript', async () => {
        await it('embeds the expression and the result markers', async () => {
            const script = buildEvalScript('document.title');
            expect(script).toContain('document.title');
            expect(script).toContain('__gjsifyEval');
            expect(script).toContain("'ok'");
            expect(script).toContain("'undefined'");
            expect(script).toContain("'error'");
        });

        await it('produces a self-invoking expression (no statements required)', async () => {
            const script = buildEvalScript('1 + 1');
            expect(script.startsWith('(function(){')).toBe(true);
            expect(script.endsWith('})()')).toBe(true);
        });
    });

    await describe('parseEvalResult', async () => {
        await it('returns the value for an ok envelope', async () => {
            expect(parseEvalResult(JSON.stringify({ __gjsifyEval: 'ok', value: 3 }))).toBe(3);
        });

        await it('returns deep objects for an ok envelope', async () => {
            const json = JSON.stringify({ __gjsifyEval: 'ok', value: { x: [1, 2], y: 'z' } });
            expect(parseEvalResult(json)).toStrictEqual({ x: [1, 2], y: 'z' });
        });

        await it('returns undefined for an undefined envelope', async () => {
            expect(parseEvalResult(JSON.stringify({ __gjsifyEval: 'undefined' }))).toBeUndefined();
        });

        await it('returns undefined for an ok envelope with no value (non-serialisable)', async () => {
            // JSON.stringify({__gjsifyEval:'ok', value: fn}) drops the value key.
            expect(parseEvalResult(JSON.stringify({ __gjsifyEval: 'ok' }))).toBeUndefined();
        });

        await it('throws an EvalError for an error envelope', async () => {
            expect(() => parseEvalResult(JSON.stringify({ __gjsifyEval: 'error', message: 'boom' }))).toThrow();
        });

        await it('returns undefined for malformed JSON', async () => {
            expect(parseEvalResult('not json {')).toBeUndefined();
        });

        await it('returns undefined for null / undefined input', async () => {
            expect(parseEvalResult(null)).toBeUndefined();
            expect(parseEvalResult(undefined)).toBeUndefined();
        });

        await it('returns undefined for a non-envelope JSON value', async () => {
            expect(parseEvalResult(JSON.stringify({ some: 'object' }))).toBeUndefined();
            expect(parseEvalResult(JSON.stringify(42))).toBeUndefined();
        });
    });
};
