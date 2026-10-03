// DOM-level tests for <gtk-flow-box>: the cells it collects, the four state flags it derives
// for each, the horizontal-by-default orientation, and the property doors the flex layout reads.
//
// The SELECTION RULES are the same core module `<gtk-list-box>` drives and
// `box-selection.spec.ts` holds them to, so this suite does not re-run the tables — it runs
// the two places the flow box is its OWN code: the orientation, which flips the line the
// primary arrows walk, and the layout properties, which are what the arrows' visual step is
// measured against.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkFlowBox } from './elements/gtk-flow-box.js';
import type { GtkFlowBoxChild } from './elements/gtk-flow-box-child.js';

const CELLS = 9;

function mount(attrs: Record<string, string> = {}): { el: GtkFlowBox; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-flow-box') as GtkFlowBox;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    for (let index = 0; index < CELLS; index++) {
        const child = document.createElement('gtk-flow-box-child') as GtkFlowBoxChild;
        const text = document.createElement('span');
        text.textContent = `cell ${index}`;
        child.appendChild(text);
        el.appendChild(child);
    }
    host.appendChild(el);
    return { el, host };
}

const childrenOf = (el: GtkFlowBox): GtkFlowBoxChild[] =>
    [...el.querySelectorAll('gtk-flow-box-child')] as GtkFlowBoxChild[];
const selectedFlags = (el: GtkFlowBox): boolean[] =>
    childrenOf(el).map((child) => child.classList.contains('selected'));
const click = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }));
const key = (target: Element, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

export const GtkFlowBoxTest = async () => {
    await describe('<gtk-flow-box> orientation, and the default nobody expects', async () => {
        await it('is HORIZONTAL by default, where a GtkListBase is vertical', async () => {
            // gtkflowbox.c:3981 — `priv->orientation = GTK_ORIENTATION_HORIZONTAL`, against
            // gtklistbase.c:2070 which answers VERTICAL for every list view.
            const { el, host } = mount();
            expect(el.orientation).toBe('horizontal');
            expect(el.classList.contains('vertical')).toBe(false);
            expect(globalThis.getComputedStyle(el).flexDirection).toBe('row');
            el.orientation = 'vertical';
            expect(el.classList.contains('vertical')).toBe(true);
            host.remove();
        });

        await it('declares a grid of gridcells, and multiselectable only in multiple', () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('grid');
            expect(childrenOf(el)[0]!.getAttribute('role')).toBe('gridcell');
            expect(el.getAttribute('aria-multiselectable')).toBe(null);
            el.selectionMode = 'multiple';
            expect(el.getAttribute('aria-multiselectable')).toBe('true');
            host.remove();
        });

        await it('is a readonly grid in selection-mode none', () => {
            const { el, host } = mount({ 'selection-mode': 'none' });
            expect(el.getAttribute('aria-readonly')).toBe('true');
            expect(childrenOf(el).every((child) => child.hasAttribute('aria-selected'))).toBe(false);
            el.selectionMode = 'single';
            expect(el.hasAttribute('aria-readonly')).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-flow-box> the layout properties the flex rules read', async () => {
        await it("defaults max-children-per-line to GTK's own seven", () => {
            // DEFAULT_MAX_CHILDREN_PER_LINE (gtkflowbox.c:728, :3985).
            const { el, host } = mount();
            expect(el.maxChildrenPerLine).toBe(7);
            host.remove();
        });

        await it('never lets max-children-per-line fall below the ParamSpec minimum of 1', () => {
            const { el, host } = mount();
            el.maxChildrenPerLine = 0;
            expect(el.maxChildrenPerLine).toBe(1);
            el.setAttribute('max-children-per-line', 'not-a-number');
            expect(el.maxChildrenPerLine).toBe(7);
            host.remove();
        });

        await it('keeps min-children-per-line at zero unless asked, which is the GIR default', () => {
            const { el, host } = mount();
            expect(el.minChildrenPerLine).toBe(0);
            expect(el.style.getPropertyValue('--adw-flow-box-min-children-per-line')).toBe('');
            el.minChildrenPerLine = 3;
            expect(el.style.getPropertyValue('--adw-flow-box-min-children-per-line')).toBe('3');
            host.remove();
        });

        await it('writes the two spacings as custom properties, in pixels', () => {
            const { el, host } = mount({ 'row-spacing': '6', 'column-spacing': '12' });
            expect(el.rowSpacing).toBe(6);
            expect(el.columnSpacing).toBe(12);
            expect(el.style.getPropertyValue('--adw-flow-box-row-spacing')).toBe('6px');
            expect(el.style.getPropertyValue('--adw-flow-box-column-spacing')).toBe('12px');
            host.remove();
        });

        await it('reads a broken spacing as the GIR default of zero', () => {
            const { el, host } = mount();
            el.setAttribute('row-spacing', '-4');
            expect(el.rowSpacing).toBe(0);
            el.setAttribute('row-spacing', '');
            expect(el.rowSpacing).toBe(0);
            host.remove();
        });

        await it('caps a cell at its share of the line, so max-children-per-line caps the line', () => {
            const { el, host } = mount({ 'max-children-per-line': '3' });
            const child = childrenOf(el)[0]!;
            // The stylesheet computes `max-width: calc(100% / 3)` from the custom property, so
            // the resolved value on the cell is what the count produced.
            expect(el.style.getPropertyValue('--adw-flow-box-max-children-per-line')).toBe('3');
            expect(child.style.getPropertyValue('--adw-flow-box-max-children-per-line')).toBe('');
            host.remove();
        });
    });

    await describe('<gtk-flow-box> selection', async () => {
        await it('a click selects and the class follows the selection', () => {
            const { el, host } = mount();
            click(childrenOf(el)[3]!);
            expect(el.selectedChildren).toStrictEqual([3]);
            expect(selectedFlags(el)).toStrictEqual([false, false, false, true, false, false, false, false, false]);
            expect(childrenOf(el)[3]!.getAttribute('aria-selected')).toBe('true');
            host.remove();
        });

        await it('Ctrl+click toggles in multiple mode and keeps the anchor', () => {
            const { el, host } = mount({ 'selection-mode': 'multiple' });
            click(childrenOf(el)[1]!);
            click(childrenOf(el)[5]!, { ctrlKey: true });
            expect(el.selectedChildren).toStrictEqual([1, 5]);
            click(childrenOf(el)[5]!, { ctrlKey: true });
            expect(el.selectedChildren).toStrictEqual([1]);
            host.remove();
        });

        await it('Shift+click takes the span and keeps the anchor, as the C does', () => {
            const { el, host } = mount({ 'selection-mode': 'multiple' });
            click(childrenOf(el)[2]!);
            click(childrenOf(el)[6]!, { shiftKey: true });
            expect(el.selectedChildren).toStrictEqual([2, 3, 4, 5, 6]);
            // A second extend grows the range from the FIRST click, because
            // `priv->selected_child` is left where it was (gtkflowbox.c:1113).
            click(childrenOf(el)[8]!, { shiftKey: true });
            expect(el.selectedChildren).toStrictEqual([2, 3, 4, 5, 6, 7, 8]);
            host.remove();
        });

        await it('clears the selection on Ctrl+click of the selected row in single mode', () => {
            const { el, host } = mount();
            click(childrenOf(el)[4]!);
            click(childrenOf(el)[4]!, { ctrlKey: true });
            expect(el.selectedChildren).toStrictEqual([]);
            host.remove();
        });

        await it('browse keeps a row selected under Ctrl+click, because it has no toggle', () => {
            const { el, host } = mount({ 'selection-mode': 'browse' });
            click(childrenOf(el)[4]!);
            click(childrenOf(el)[4]!, { ctrlKey: true });
            expect(el.selectedChildren).toStrictEqual([4]);
            host.remove();
        });

        await it('select_all is refused outside multiple, and unselect_all in browse', () => {
            const { el, host } = mount();
            el.selectChild(childrenOf(el)[1]!);
            el.selectAll();
            expect(el.selectedChildren).toStrictEqual([1]);
            el.selectionMode = 'browse';
            el.selectChild(childrenOf(el)[2]!);
            el.unselectAll();
            expect(el.selectedChildren).toStrictEqual([2]);
            host.remove();
        });

        await it('toggles on Ctrl+Space, the toggle-cursor-child binding', () => {
            const { el, host } = mount({ 'selection-mode': 'multiple' });
            const child = childrenOf(el)[2]!;
            child.focus();
            key(child, { key: ' ', ctrlKey: true });
            expect(el.selectedChildren).toStrictEqual([2]);
            key(child, { key: ' ', ctrlKey: true });
            expect(el.selectedChildren).toStrictEqual([]);
            host.remove();
        });

        await it('emits child-activated and activate on one click by default', () => {
            const { el, host } = mount();
            let activated = 0;
            let childActivated = 0;
            el.addEventListener('child-activated', () => {
                childActivated++;
            });
            childrenOf(el)[1]!.addEventListener('activate', () => {
                activated++;
            });
            click(childrenOf(el)[1]!);
            expect(activated).toBe(1);
            expect(childActivated).toBe(1);
            host.remove();
        });

        await it('waits for a double click when activate-on-single-click is off', () => {
            const { el, host } = mount({ 'activate-on-single-click': 'false' });
            let activated = 0;
            childrenOf(el)[1]!.addEventListener('activate', () => {
                activated++;
            });
            click(childrenOf(el)[1]!, { detail: 1 });
            expect(activated).toBe(0);
            click(childrenOf(el)[1]!, { detail: 2 });
            expect(activated).toBe(1);
            host.remove();
        });

        await it('emits selected-children-changed on every change', () => {
            const { el, host } = mount();
            let changes = 0;
            el.addEventListener('selected-children-changed', () => {
                changes++;
            });
            click(childrenOf(el)[0]!);
            click(childrenOf(el)[1]!);
            expect(changes).toBe(2);
            host.remove();
        });

        await it('every cell is its own tab stop, and the arrows walk the line', () => {
            const { el, host } = mount();
            expect(childrenOf(el).every((child) => child.tabIndex === 0)).toBe(true);
            childrenOf(el)[0]!.focus();
            key(childrenOf(el)[0]!, { key: 'ArrowRight' });
            expect(el.selectedChildren).toStrictEqual([1]);
            host.remove();
        });

        await it('takes a cell appended after connect into the selection', async () => {
            const { el, host } = mount();
            const child = document.createElement('gtk-flow-box-child');
            el.appendChild(child);
            await Promise.resolve();
            expect(el.children).toHaveLength(CELLS + 1);
            host.remove();
        });
    });

    await describe('<gtk-flow-box-child> on its own', async () => {
        await it('is a gridcell and a tab stop, with its authored child inside', async () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const child = document.createElement('gtk-flow-box-child') as GtkFlowBoxChild;
            const text = document.createElement('span');
            text.textContent = 'only';
            child.appendChild(text);
            host.appendChild(child);
            expect(child.getAttribute('role')).toBe('gridcell');
            expect(child.tabIndex).toBe(0);
            expect(child.child).toBe(text);
            expect(child.selected).toBe(false);
            child.classList.add('selected');
            expect(child.selected).toBe(true);
            host.remove();
        });

        await it('answers its index from the DOM, so a move reports where it IS', async () => {
            const { el, host } = mount();
            const moved = childrenOf(el)[7]!;
            el.prepend(moved);
            await Promise.resolve();
            expect(moved.index).toBe(0);
            expect(el.children[0]).toBe(moved);
            host.remove();
        });
    });
};
