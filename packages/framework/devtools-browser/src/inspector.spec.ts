// Tests for the inspector-data expression builders (inspector.ts). WebView-free
// — verify the generated JS (selector escaping, structure, caps). Running them
// against a live page is the browser e2e's job.

import { describe, it, expect } from '@gjsify/unit';

import {
    buildAccessibilityExpression,
    buildDomTreeExpression,
    buildInspectElementExpression,
    buildNetworkExpression,
} from './inspector.js';

export default async () => {
    await describe('buildInspectElementExpression', async () => {
        await it('embeds the JSON-escaped selector + box-model/computed gathering', async () => {
            const expr = buildInspectElementExpression('.card > a');
            expect(expr).toContain(JSON.stringify('.card > a'));
            expect(expr).toContain('getComputedStyle(el)');
            expect(expr).toContain('getBoundingClientRect');
            expect(expr).toContain('boxModel');
            expect(expr).toContain('computedStyle');
        });

        await it('escapes a selector with quotes (no breakout)', async () => {
            const expr = buildInspectElementExpression('a[data-x="y"]');
            expect(expr).toContain(JSON.stringify('a[data-x="y"]'));
        });

        await it('is a self-invoking expression', async () => {
            const expr = buildInspectElementExpression('a');
            expect(expr.startsWith('(function(){')).toBe(true);
            expect(expr.endsWith('})()')).toBe(true);
        });
    });

    await describe('buildDomTreeExpression', async () => {
        await it('uses documentElement when no selector + embeds caps', async () => {
            const expr = buildDomTreeExpression(undefined, 2, 10);
            expect(expr).toContain('document.documentElement');
            expect(expr).toContain('node(root,2)');
            expect(expr).toContain('i<10');
        });

        await it('uses querySelector when a selector is given', async () => {
            const expr = buildDomTreeExpression('main', 1);
            expect(expr).toContain(`document.querySelector(${JSON.stringify('main')})`);
        });

        await it('floors/clamps depth and child cap', async () => {
            const expr = buildDomTreeExpression(undefined, -1, 0);
            expect(expr).toContain('node(root,0)');
            expect(expr).toContain('i<1');
        });
    });

    await describe('buildNetworkExpression', async () => {
        await it('reads navigation + resource timing', async () => {
            const expr = buildNetworkExpression();
            expect(expr).toContain('getEntriesByType("navigation")');
            expect(expr).toContain('getEntriesByType("resource")');
            expect(expr).toContain('transferSize');
        });
    });

    await describe('buildAccessibilityExpression', async () => {
        await it('defaults to body + gathers role/name/aria', async () => {
            const expr = buildAccessibilityExpression();
            expect(expr).toContain('document.body');
            expect(expr).toContain('aria-label');
            expect(expr).toContain('"aria-"');
        });

        await it('escapes the selector', async () => {
            const expr = buildAccessibilityExpression('#main "x"');
            expect(expr).toContain(JSON.stringify('#main "x"'));
        });
    });
};
