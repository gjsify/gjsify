// `Gtk.TreeExpander`'s node arithmetic, held to gtktreeexpander.c (ADR 0089).
//
// The two cases worth having a suite for are the ones the C makes easy to get wrong: the
// `indent-for-icon` increment, which only the branch WITHOUT an expander takes, and the
// accessible level, which is computed after it.
import { describe, expect, it } from '@gjsify/unit';

import { TREE_EXPANDER_LAYOUT_VECTORS, TREE_EXPANDER_SHORTCUT_VECTORS } from './conformance/tree-expander.js';
import {
    treeExpanderAction,
    treeExpanderExpanded,
    treeExpanderLayout,
    type AdwTreeExpanderRow,
} from './tree-expander.js';

const row = (depth: number, expandable: boolean, expanded = false): AdwTreeExpanderRow => ({
    depth,
    expandable,
    expanded,
});

export default async () => {
    await describe('the layout vectors, through treeExpanderLayout', async () => {
        for (const vector of TREE_EXPANDER_LAYOUT_VECTORS) {
            await it(vector.rule, () => {
                expect(treeExpanderLayout(vector.row, vector.options)).toStrictEqual({
                    indents: vector.indents,
                    expander: vector.expander,
                    level: vector.level,
                });
            });
        }
    });

    await describe('the shortcut vectors, through treeExpanderAction', async () => {
        for (const vector of TREE_EXPANDER_SHORTCUT_VECTORS) {
            await it(vector.rule, () => {
                expect(treeExpanderAction(vector.key, vector.state)).toBe(vector.action);
            });
        }
    });

    await describe('treeExpanderLayout', async () => {
        await it('draws nothing at all without a list row', () => {
            expect(treeExpanderLayout(null)).toStrictEqual({ indents: 0, expander: 'none', level: 1 });
        });

        await it('indents by the depth and carries the expanded state', () => {
            expect(treeExpanderLayout(row(2, true, true))).toStrictEqual({
                indents: 2,
                expander: 'expanded',
                level: 3,
            });
            expect(treeExpanderLayout(row(2, true))).toStrictEqual({
                indents: 2,
                expander: 'collapsed',
                level: 3,
            });
        });

        await it('gives a LEAF one more indent, so it lines up with its siblings content', () => {
            expect(treeExpanderLayout(row(1, false))).toStrictEqual({ indents: 2, expander: 'none', level: 3 });
        });

        await it('does not add that indent when indent-for-icon is off', () => {
            expect(treeExpanderLayout(row(1, false), { indentForIcon: false })).toStrictEqual({
                indents: 1,
                expander: 'none',
                level: 2,
            });
        });

        await it('takes the leaf branch for a hidden expander too, expandable or not', () => {
            expect(treeExpanderLayout(row(1, true), { hideExpander: true })).toStrictEqual({
                indents: 2,
                expander: 'none',
                level: 3,
            });
        });

        await it('stops indenting with indent-for-depth off, but still draws the expander', () => {
            expect(treeExpanderLayout(row(3, true, true), { indentForDepth: false })).toStrictEqual({
                indents: 0,
                expander: 'expanded',
                level: 1,
            });
        });

        await it('reports a level of at least 1, which is what the ARIA property requires', () => {
            expect(treeExpanderLayout(row(0, true)).level).toBe(1);
            expect(treeExpanderLayout(row(-5, true)).level).toBe(1);
        });
    });

    await describe('treeExpanderAction', async () => {
        await it('maps the four punctuation shortcuts', () => {
            expect(treeExpanderAction('+')).toBe('expand');
            expect(treeExpanderAction('*')).toBe('expand');
            expect(treeExpanderAction('-')).toBe('collapse');
            expect(treeExpanderAction('/')).toBe('collapse');
        });

        await it('toggles on Ctrl+Space and ignores a bare Space', () => {
            expect(treeExpanderAction(' ', { ctrlKey: true })).toBe('toggle');
            expect(treeExpanderAction(' ')).toBe('none');
        });

        await it('needs Shift for the arrows, and reads them in the locale direction', () => {
            expect(treeExpanderAction('ArrowRight')).toBe('none');
            expect(treeExpanderAction('ArrowRight', { shiftKey: true })).toBe('expand');
            expect(treeExpanderAction('ArrowLeft', { shiftKey: true })).toBe('collapse');
            expect(treeExpanderAction('ArrowRight', { shiftKey: true, rtl: true })).toBe('collapse');
            expect(treeExpanderAction('ArrowLeft', { shiftKey: true, rtl: true })).toBe('expand');
        });

        await it('maps an unrelated key to nothing', () => {
            expect(treeExpanderAction('a', { shiftKey: true, ctrlKey: true })).toBe('none');
        });
    });

    await describe('treeExpanderExpanded', async () => {
        await it('applies each action to the flag', () => {
            expect(treeExpanderExpanded(false, 'expand')).toBe(true);
            expect(treeExpanderExpanded(true, 'collapse')).toBe(false);
            expect(treeExpanderExpanded(true, 'toggle')).toBe(false);
            expect(treeExpanderExpanded(true, 'none')).toBe(true);
        });
    });
};
