// DOM-level tests for <gtk-list-view>: the two model doors, the factory, the
// click-and-modifier selection, and the one thing a pure core test cannot reach — that a
// splice leaves the OTHER rows standing, which is what the whole items-changed path
// exists for.
//
// The THIRD model door, the string-list child a `.blp` authors (ADR 0072), has no case
// here for the reason `<gtk-drop-down>`'s has none: the tag it is written as is markup
// the shared-tree builder emits and no `customElements.define` registers, so a spec that
// constructed one would be asserting against an inert `HTMLElement`. It is covered where
// that markup is produced, in `value-lists.spec.ts`.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwListItemContext } from '@gjsify/adwaita-core';
import { LIST_VIEW_SELECT_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkListView } from './elements/gtk-list-view.js';

function mount(attrs: Record<string, string> = {}): { el: GtkListView; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-list-view') as GtkListView;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const rows = (el: GtkListView): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.adw-list-view-row')];
const labels = (el: GtkListView): string[] => rows(el).map((row) => row.textContent ?? '');

const click = (row: HTMLElement, init: MouseEventInit = {}) =>
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));

export const GtkListViewTest = async () => {
    await describe('<gtk-list-view> model', async () => {
        await it('draws one row per item from the JSON attribute', () => {
            const { el, host } = mount({ model: '["Alpha","Beta","Gamma"]' });
            expect(labels(el)).toStrictEqual(['Alpha', 'Beta', 'Gamma']);
            expect(el.getAttribute('role')).toBe('listbox');
            host.remove();
        });

        await it('takes the property too, in every item spelling the port accepts', () => {
            const { el, host } = mount();
            el.model = ['Alpha', { label: 'Beta' }, { value: 'c', label: 'Gamma' }];
            expect(labels(el)).toStrictEqual(['Alpha', 'Beta', 'Gamma']);
            expect(el.model[2]!.value).toBe('c');
            host.remove();
        });

        await it('survives a malformed attribute instead of failing to upgrade', () => {
            const { el, host } = mount({ model: '{' });
            expect(labels(el)).toStrictEqual([]);
            host.remove();
        });

        await it('SPLICES: an appended item leaves the existing row nodes identical', () => {
            const { el, host } = mount({ model: '["Alpha","Beta"]' });
            const before = rows(el);
            el.model = ['Alpha', 'Beta', 'Gamma'];
            const after = rows(el);
            expect(after.length).toBe(3);
            expect(after[0]).toBe(before[0]);
            expect(after[1]).toBe(before[1]);
            host.remove();
        });
    });

    await describe('<gtk-list-view> factory', async () => {
        await it('draws the item label when no factory was set', () => {
            const { el, host } = mount({ model: '["Alpha"]' });
            expect(el.querySelector('.adw-list-item-label')?.textContent).toBe('Alpha');
            host.remove();
        });

        await it('hands a factory the item, its position and its selected state', () => {
            const { el, host } = mount({ model: '["Alpha","Beta"]' });
            const seen: AdwListItemContext[] = [];
            el.factory = (context) => {
                seen.push(context);
                const node = document.createElement('b');
                node.textContent = `${context.position}:${context.item.label}`;
                return node;
            };
            expect(labels(el)).toStrictEqual(['0:Alpha', '1:Beta']);
            expect(seen[1]!.selected).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-list-view> drives the selection vectors with real clicks', async () => {
        // The core suite drives the same rows through `ListViewState`; this is the half
        // that proves the ELEMENT reads the two modifiers off the event and routes them to
        // it, which no pure test of the rules can reach.
        for (const vector of LIST_VIEW_SELECT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({
                    model: JSON.stringify(Array.from({ length: vector.length }, (_, i) => `${i}`)),
                    'selection-mode': vector.mode,
                });
                for (const step of vector.clicks) {
                    const row = rows(el)[step.position];
                    if (row !== undefined) click(row, { ctrlKey: step.modify, shiftKey: step.extend });
                }
                expect(el.selected).toStrictEqual([...vector.selection]);
                host.remove();
            });
        }
    });

    await describe('<gtk-list-view> selection', async () => {
        await it('selects on click and notifies once per change', () => {
            const { el, host } = mount({ model: '["Alpha","Beta","Gamma"]' });
            const notified: number[][] = [];
            el.addEventListener('notify::selected', (event) => {
                notified.push((event as CustomEvent).detail.selected as number[]);
            });
            click(rows(el)[1]!);
            click(rows(el)[1]!);
            expect(el.selected).toStrictEqual([1]);
            expect(notified).toStrictEqual([[1]]);
            expect(rows(el)[1]!.getAttribute('aria-selected')).toBe('true');
            host.remove();
        });

        await it('Ctrl and Shift add and extend in multiple mode', () => {
            const { el, host } = mount({ model: '["A","B","C","D"]', 'selection-mode': 'multiple' });
            expect(el.getAttribute('aria-multiselectable')).toBe('true');
            click(rows(el)[0]!);
            click(rows(el)[2]!, { ctrlKey: true });
            expect(el.selected).toStrictEqual([0, 2]);
            click(rows(el)[0]!);
            click(rows(el)[2]!, { shiftKey: true });
            expect(el.selected).toStrictEqual([0, 1, 2]);
            host.remove();
        });

        await it('selects nothing at all in none mode, and says so to assistive technology', () => {
            const { el, host } = mount({ model: '["A","B"]', 'selection-mode': 'none' });
            click(rows(el)[1]!);
            expect(el.selected).toStrictEqual([]);
            expect(el.getAttribute('role')).toBe('list');
            expect(rows(el)[1]!.getAttribute('role')).toBe('listitem');
            host.remove();
        });

        await it('drops a selected position the replaced model no longer has', () => {
            const { el, host } = mount({ model: '["A","B","C"]' });
            click(rows(el)[2]!);
            el.model = ['A'];
            expect(el.selected).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('<gtk-list-view> activation and keyboard', async () => {
        await it('activates on double click, and on a single one only when asked', () => {
            const { el, host } = mount({ model: '["A","B"]' });
            const activated: number[] = [];
            el.addEventListener('activate', (event) => {
                activated.push((event as CustomEvent).detail.position as number);
            });
            click(rows(el)[1]!);
            expect(activated).toStrictEqual([]);
            rows(el)[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            el.singleClickActivate = true;
            click(rows(el)[0]!);
            expect(activated).toStrictEqual([1, 0]);
            host.remove();
        });

        await it('hands out a roving tabindex for tab-behavior item, and every stop for all', () => {
            const { el, host } = mount({ model: '["A","B","C"]', 'tab-behavior': 'item' });
            expect(rows(el).map((row) => row.tabIndex)).toStrictEqual([0, -1, -1]);
            click(rows(el)[2]!);
            expect(rows(el).map((row) => row.tabIndex)).toStrictEqual([-1, -1, 0]);
            el.tabBehavior = 'all';
            expect(rows(el).map((row) => row.tabIndex)).toStrictEqual([0, 0, 0]);
            host.remove();
        });

        await it('moves the selection with ArrowDown, which is what the roving tabindex needs', () => {
            const { el, host } = mount({ model: '["A","B","C"]', 'tab-behavior': 'item' });
            click(rows(el)[0]!);
            // Dispatched ON THE ROW: `attachRovingFocus` listens on the host and finds the
            // item the key came from, so a press with the host itself as the target is one
            // no user can produce and the helper correctly ignores.
            rows(el)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            expect(el.selected).toStrictEqual([1]);
            host.remove();
        });
    });

    await describe('<gtk-list-view> separators', async () => {
        await it('carries the .separators class only while show-separators is set', () => {
            const { el, host } = mount({ model: '["A","B"]' });
            expect(el.classList.contains('separators')).toBe(false);
            el.showSeparators = true;
            expect(el.classList.contains('separators')).toBe(true);
            expect(getComputedStyle(rows(el)[0]!).borderBottomWidth).toBe('1px');
            host.remove();
        });
    });
};
