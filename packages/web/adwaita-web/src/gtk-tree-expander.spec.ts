// DOM-level tests for <gtk-tree-expander>: the nodes it puts in front of its child, the
// arrow that toggles, the shortcuts, and the ARIA a tree row owes a screen reader. The
// arithmetic itself is `tree-expander.spec.ts` in @gjsify/adwaita-core; what is asserted
// here is that the element draws what the arithmetic says.
import { describe, expect, it } from '@gjsify/unit';

import { TREE_EXPANDER_LAYOUT_VECTORS, TREE_EXPANDER_SHORTCUT_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkTreeExpander } from './elements/gtk-tree-expander.js';

function mount(attrs: Record<string, string> = {}): { el: GtkTreeExpander; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-tree-expander') as GtkTreeExpander;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    const child = document.createElement('gtk-label');
    child.setAttribute('label', 'Row');
    el.appendChild(child);
    host.appendChild(el);
    return { el, host };
}

const indents = (el: GtkTreeExpander): number => el.querySelectorAll('.adw-tree-expander-indent').length;
const icon = (el: GtkTreeExpander): HTMLElement | null => el.querySelector('.adw-tree-expander-icon');

export const GtkTreeExpanderTest = async () => {
    await describe('<gtk-tree-expander> drives the layout vectors as real nodes', async () => {
        // The ONE row with no counterpart here is `row: null`: upstream an expander exists
        // before a `Gtk.TreeListRow` is assigned to it, and on this port the row IS the
        // three attributes, so an expander with none of them is a root leaf rather than a
        // rowless widget. The element header records the same divergence.
        for (const vector of TREE_EXPANDER_LAYOUT_VECTORS.filter((candidate) => candidate.row !== null)) {
            await it(vector.rule, () => {
                const row = vector.row!;
                const attrs: Record<string, string> = { depth: String(row.depth) };
                if (row.expandable) attrs.expandable = '';
                if (row.expanded) attrs.expanded = '';
                if (vector.options.hideExpander === true) attrs['hide-expander'] = '';
                if (vector.options.indentForDepth === false) attrs['indent-for-depth'] = 'false';
                if (vector.options.indentForIcon === false) attrs['indent-for-icon'] = 'false';
                const { el, host } = mount(attrs);

                expect(indents(el)).toBe(vector.indents);
                expect(
                    icon(el) === null ? 'none' : el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed',
                ).toBe(vector.expander);
                expect(el.getAttribute('aria-level')).toBe(String(vector.level));
                host.remove();
            });
        }
    });

    await describe('<gtk-tree-expander> drives the shortcut vectors as real key presses', async () => {
        for (const vector of TREE_EXPANDER_SHORTCUT_VECTORS) {
            await it(vector.rule, () => {
                // Every row is driven from BOTH starting states, so "the key did nothing"
                // and "the key asked for the state it was already in" cannot be confused.
                for (const before of [false, true]) {
                    const attrs: Record<string, string> = { expandable: '' };
                    if (before) attrs.expanded = '';
                    // The locale half of the arrow rule is the COMPUTED direction, which
                    // is what the element reads and what `dir` is the markup for.
                    if (vector.state.rtl === true) attrs.dir = 'rtl';
                    const { el, host } = mount(attrs);
                    el.dispatchEvent(
                        new KeyboardEvent('keydown', {
                            key: vector.key,
                            ctrlKey: vector.state.ctrlKey === true,
                            shiftKey: vector.state.shiftKey === true,
                            bubbles: true,
                        }),
                    );
                    const expected =
                        vector.action === 'expand'
                            ? true
                            : vector.action === 'collapse'
                              ? false
                              : vector.action === 'toggle'
                                ? !before
                                : before;
                    expect(el.expanded).toBe(expected);
                    host.remove();
                }
            });
        }
    });

    await describe('<gtk-tree-expander> nodes', async () => {
        await it('draws one indent per level and an arrow for an expandable row', () => {
            const { el, host } = mount({ depth: '2', expandable: '' });
            expect(indents(el)).toBe(2);
            expect(icon(el)).not.toBe(null);
            expect(el.getAttribute('aria-expanded')).toBe('false');
            expect(el.getAttribute('aria-level')).toBe('3');
            host.remove();
        });

        await it('gives a LEAF one more indent instead of the arrow', () => {
            const { el, host } = mount({ depth: '1' });
            expect(indents(el)).toBe(2);
            expect(icon(el)).toBe(null);
            expect(el.hasAttribute('aria-expanded')).toBe(false);
            host.remove();
        });

        await it('keeps the ornaments IN FRONT of the child, as insert_before does', () => {
            const { el, host } = mount({ depth: '1', expandable: '' });
            const names = [...el.children].map((child) => child.tagName.toLowerCase());
            expect(names).toStrictEqual(['span', 'gtk-image', 'gtk-label']);
            host.remove();
        });

        await it('hides the expander on request and indents like a leaf instead', () => {
            const { el, host } = mount({ depth: '1', expandable: '', 'hide-expander': '' });
            expect(icon(el)).toBe(null);
            expect(indents(el)).toBe(2);
            host.remove();
        });

        await it('stops indenting with indent-for-depth="false" but keeps the arrow', () => {
            const { el, host } = mount({ depth: '3', expandable: '', 'indent-for-depth': 'false' });
            expect(indents(el)).toBe(0);
            expect(icon(el)).not.toBe(null);
            host.remove();
        });

        await it('rebuilds when the row changes under it', () => {
            const { el, host } = mount({ depth: '0', expandable: '' });
            expect(indents(el)).toBe(0);
            el.depth = 2;
            expect(indents(el)).toBe(2);
            el.expandable = false;
            expect(icon(el)).toBe(null);
            expect(indents(el)).toBe(3);
            host.remove();
        });
    });

    await describe('<gtk-tree-expander> expansion', async () => {
        await it('toggles on the ARROW and notifies on every change', () => {
            const { el, host } = mount({ expandable: '' });
            const seen: boolean[] = [];
            el.addEventListener('notify::expanded', (event) => {
                seen.push((event as CustomEvent).detail.expanded as boolean);
            });
            icon(el)!.click();
            expect(el.expanded).toBe(true);
            expect(icon(el)!.classList.contains('expanded')).toBe(true);
            el.expanded = false;
            expect(seen).toStrictEqual([true, false]);
            host.remove();
        });

        await it('does not let the arrow click reach the row around it', () => {
            // Upstream the gesture sits on the expander icon, so the list view's own row
            // click never sees it.
            const { el, host } = mount({ expandable: '' });
            let reachedHost = false;
            host.addEventListener('click', () => (reachedHost = true));
            icon(el)!.click();
            expect(reachedHost).toBe(false);
            host.remove();
        });

        await it('expands on + and collapses on -', () => {
            const { el, host } = mount({ expandable: '' });
            el.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
            expect(el.expanded).toBe(true);
            el.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
            expect(el.expanded).toBe(false);
            host.remove();
        });

        await it('toggles on Ctrl+Space and ignores a bare Space', () => {
            const { el, host } = mount({ expandable: '' });
            el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            expect(el.expanded).toBe(false);
            el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }));
            expect(el.expanded).toBe(true);
            host.remove();
        });

        await it('needs Shift for the arrow keys', () => {
            const { el, host } = mount({ expandable: '' });
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            expect(el.expanded).toBe(false);
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
            expect(el.expanded).toBe(true);
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
            expect(el.expanded).toBe(false);
            host.remove();
        });

        await it('is a focusable button, which is what carries the shortcuts', () => {
            const { el, host } = mount({ expandable: '' });
            expect(el.getAttribute('role')).toBe('button');
            expect(el.tabIndex).toBe(0);
            host.remove();
        });
    });
};
