// Tests for the DOM-query expression builders (dom-queries.ts). WebView-free —
// these verify the generated JS expression text (selector escaping, limit,
// shape). Running them against a real page is the browser tool's e2e job.

import { describe, it, expect } from '@gjsify/unit';

import { buildClickElementExpression, buildGetLinksExpression, buildQueryDomExpression } from './dom-queries.js';

export default async () => {
    await describe('buildGetLinksExpression', async () => {
        await it('queries a[href] and maps href/text/title', async () => {
            const expr = buildGetLinksExpression();
            expect(expr).toContain("querySelectorAll('a[href]')");
            expect(expr).toContain('href:a.href');
            expect(expr).toContain('title:a.getAttribute');
        });
    });

    await describe('buildQueryDomExpression', async () => {
        await it('embeds the JSON-escaped selector and the limit', async () => {
            const expr = buildQueryDomExpression('.item > a', 50);
            expect(expr).toContain(JSON.stringify('.item > a'));
            expect(expr).toContain('.slice(0,50)');
            expect(expr).toContain('getBoundingClientRect');
        });

        await it('escapes a selector containing quotes (no breakout)', async () => {
            const expr = buildQueryDomExpression('a[data-x="y"]');
            expect(expr).toContain(JSON.stringify('a[data-x="y"]'));
        });

        await it('floors and clamps a non-integer / negative limit', async () => {
            expect(buildQueryDomExpression('a', 12.9)).toContain('.slice(0,12)');
            expect(buildQueryDomExpression('a', -5)).toContain('.slice(0,0)');
        });

        await it('defaults the limit to 200', async () => {
            expect(buildQueryDomExpression('a')).toContain('.slice(0,200)');
        });
    });

    await describe('buildClickElementExpression', async () => {
        await it('embeds the JSON-escaped target and a text fallback', async () => {
            const expr = buildClickElementExpression('Home');
            expect(expr).toContain(JSON.stringify('Home'));
            expect(expr).toContain('querySelector');
            expect(expr).toContain('querySelectorAll("a")');
            expect(expr).toContain('.click()');
        });

        await it('escapes a target containing quotes (no breakout)', async () => {
            const expr = buildClickElementExpression('a[title="Go \'home\'"]');
            expect(expr).toContain(JSON.stringify('a[title="Go \'home\'"]'));
        });

        await it('is a self-invoking expression', async () => {
            const expr = buildClickElementExpression('a');
            expect(expr.startsWith('(function(){')).toBe(true);
            expect(expr.endsWith('})()')).toBe(true);
        });
    });
};
