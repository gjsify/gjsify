// Ported from `@gjsify/adwaita-nativescript`'s index.spec.ts alongside the
// module move (ADR 0004) — the NS package keeps only the `addBreakpoints`
// view-binding spec (its remaining NS-specific piece).

import { describe, it, expect } from '@gjsify/unit';

import { AdwBreakpoint, evaluateBreakpointCondition, parseBreakpointCondition } from './breakpoint.js';
import type { BreakpointConditionGroup, BreakpointConditionLeaf } from './breakpoint.js';

export default async () => {
    await describe('breakpoint condition parsing (Adw.BreakpointCondition)', async () => {
        await it('parses a single max-width leaf (sp unit read as DIPs)', () => {
            const node = parseBreakpointCondition('max-width: 720sp') as BreakpointConditionLeaf;
            expect(node).not.toBe(null);
            expect(node.dimension).toBe('width');
            expect(node.bound).toBe('max');
            expect(node.value).toBe(720);
        });

        await it('parses min-height and bare px/no-unit values', () => {
            expect((parseBreakpointCondition('min-height: 480px') as BreakpointConditionLeaf).value).toBe(480);
            const leaf = parseBreakpointCondition('min-width:600') as BreakpointConditionLeaf;
            expect(leaf.bound).toBe('min');
            expect(leaf.value).toBe(600);
        });

        await it('returns null for an unparseable condition', () => {
            expect(parseBreakpointCondition('garbage')).toBe(null);
            expect(parseBreakpointCondition('')).toBe(null);
            expect(parseBreakpointCondition('max-depth: 5px')).toBe(null);
        });

        await it('parses an and-group with the operator as the root', () => {
            const node = parseBreakpointCondition('max-width: 720sp and max-height: 480sp') as BreakpointConditionGroup;
            expect(node.op).toBe('and');
            expect((node.left as BreakpointConditionLeaf).dimension).toBe('width');
            expect((node.right as BreakpointConditionLeaf).dimension).toBe('height');
        });

        await it('parses parenthesised groups', () => {
            const node = parseBreakpointCondition('(min-width: 360px)') as BreakpointConditionLeaf;
            expect(node.dimension).toBe('width');
            expect(node.bound).toBe('min');
        });

        await it('or binds looser than and (A or B and C → A or (B and C))', () => {
            const node = parseBreakpointCondition(
                'max-width: 360sp or min-width: 1200sp and min-height: 800sp',
            ) as BreakpointConditionGroup;
            expect(node.op).toBe('or');
            expect((node.left as BreakpointConditionLeaf).value).toBe(360);
            expect((node.right as BreakpointConditionGroup).op).toBe('and');
        });
    });

    await describe('breakpoint condition evaluation', async () => {
        await it('evaluates max-width: true when narrow, false when wide', () => {
            const node = parseBreakpointCondition('max-width: 720sp')!;
            expect(evaluateBreakpointCondition(node, { width: 411, height: 900 })).toBe(true); // phone
            expect(evaluateBreakpointCondition(node, { width: 928, height: 1280 })).toBe(false); // tablet
            expect(evaluateBreakpointCondition(node, { width: 720, height: 900 })).toBe(true); // boundary inclusive
        });

        await it('evaluates and/or combinations', () => {
            const and = parseBreakpointCondition('max-width: 720sp and max-height: 480sp')!;
            expect(evaluateBreakpointCondition(and, { width: 600, height: 400 })).toBe(true);
            expect(evaluateBreakpointCondition(and, { width: 600, height: 900 })).toBe(false);
            const or = parseBreakpointCondition('max-width: 360sp or min-width: 1200sp')!;
            expect(evaluateBreakpointCondition(or, { width: 300, height: 900 })).toBe(true);
            expect(evaluateBreakpointCondition(or, { width: 1300, height: 900 })).toBe(true);
            expect(evaluateBreakpointCondition(or, { width: 700, height: 900 })).toBe(false);
        });
    });

    await describe('AdwBreakpoint apply/unapply state machine', async () => {
        await it('fires apply/unapply only on transitions', () => {
            let applies = 0;
            let unapplies = 0;
            const bp = new AdwBreakpoint('max-width: 720sp', {
                onApply: () => applies++,
                onUnapply: () => unapplies++,
            });
            expect(bp.applied).toBe(false);
            bp.evaluate({ width: 411, height: 900 }); // narrow → apply
            expect(bp.applied).toBe(true);
            expect(applies).toBe(1);
            bp.evaluate({ width: 400, height: 900 }); // still narrow → no re-fire
            expect(applies).toBe(1);
            bp.evaluate({ width: 928, height: 1280 }); // wide → unapply
            expect(bp.applied).toBe(false);
            expect(unapplies).toBe(1);
            bp.evaluate({ width: 1000, height: 1280 }); // still wide → no re-fire
            expect(unapplies).toBe(1);
        });

        await it('accepts a pre-parsed condition node', () => {
            const node = parseBreakpointCondition('min-width: 1200sp')!;
            let applies = 0;
            const bp = new AdwBreakpoint(node, { onApply: () => applies++ });
            expect(bp.condition).toBe(node);
            expect(bp.evaluate({ width: 1300, height: 900 })).toBe(true);
            expect(applies).toBe(1);
        });

        await it('with an invalid condition never applies', () => {
            let applies = 0;
            const bp = new AdwBreakpoint('not a condition', { onApply: () => applies++ });
            expect(bp.condition).toBe(null);
            expect(bp.evaluate({ width: 100, height: 100 })).toBe(false);
            expect(applies).toBe(0);
        });
    });
};
