// DOM-level tests for <gtk-level-bar>. The widget is three separable things and each
// gets its own describe: the OFFSETS, which are a runtime list and decide both the
// block's class and nothing else; the BLOCK COUNT, which depends on `mode`; and the
// INTERVAL, whose endpoints drag `value` with them the way the C's setters do.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkLevelBar } from './elements/gtk-level-bar.js';

function mount(attrs: Record<string, string> = {}): { el: GtkLevelBar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-level-bar') as GtkLevelBar;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** The `block` nodes under the trough, in DOM order, with their class names. */
function blocks(el: GtkLevelBar): string[] {
    return [...el.querySelectorAll('.adw-level-bar-block')].map((node) =>
        [...node.classList].filter((name) => name !== 'adw-level-bar-block').join(' '),
    );
}

export const GtkLevelBarTest = async () => {
    await describe('<gtk-level-bar> defaults', async () => {
        await it("is a continuous horizontal bar over 0…1, with GTK's three offsets", () => {
            const { el, host } = mount();
            expect(el.value).toBe(0);
            expect(el.minValue).toBe(0);
            expect(el.maxValue).toBe(1);
            expect(el.mode).toBe('continuous');
            expect(el.orientation).toBe('horizontal');
            expect(el.classList.contains('continuous')).toBe(true);
            expect(el.classList.contains('horizontal')).toBe(true);
            // gtklevelbar.c:1058-1060 — installed before any application code runs.
            expect(el.offsetValue('low')).toBe(0.25);
            expect(el.offsetValue('high')).toBe(0.75);
            expect(el.offsetValue('full')).toBe(1);
            expect(el.getAttribute('role')).toBe('meter');
            expect(el.getAttribute('aria-valuemin')).toBe('0');
            expect(el.getAttribute('aria-valuemax')).toBe('1');
            expect(el.getAttribute('aria-valuenow')).toBe('0');
            host.remove();
        });

        await it('continuous draws an empty level and no filled one at value 0', () => {
            // gtklevelbar.c:429-430 — the filled node is never allocated at 0.
            const { el, host } = mount();
            const filled = el.querySelectorAll('.adw-level-bar-block.filled');
            expect(filled.length).toBe(1);
            expect((filled[0] as HTMLElement).hidden).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-level-bar> offsets', async () => {
        await it('names the block by the first offset at or above the value', () => {
            // gtklevelbar.c:604-625 — and the LOWEST offset wins even below its value.
            const { el, host } = mount({ value: '0.3' });
            expect(blocks(el)).toStrictEqual(['empty', 'filled high']);
            el.value = 0.1;
            expect(blocks(el)).toStrictEqual(['empty', 'filled low']);
            el.value = 0.9;
            expect(blocks(el)).toStrictEqual(['empty', 'filled full']);
            el.value = 1;
            expect(blocks(el)).toStrictEqual(['empty', 'filled full']);
            host.remove();
        });

        await it('above every offset no class is named at all', () => {
            const { el, host } = mount({ value: '1.5' });
            expect(blocks(el)).toStrictEqual(['empty', 'filled']);
            host.remove();
        });

        await it('adds a custom offset, and refuses one outside the interval', () => {
            // gtklevelbar.c:1403 — `g_return_if_fail (gtk_level_bar_value_in_interval)`.
            const { el, host } = mount({ value: '0.5' });
            const changed: unknown[] = [];
            el.addEventListener('offset-changed', (e) => changed.push((e as CustomEvent).detail));
            el.addOffsetValue('my-offset', 0.6);
            expect(el.offsetValue('my-offset')).toBe(0.6);
            // 0.6 is the first offset at or above 0.5 once it is in the list.
            expect(blocks(el)).toStrictEqual(['empty', 'filled my-offset']);
            expect(changed).toStrictEqual([{ name: 'my-offset' }]);

            el.addOffsetValue('outside', 2);
            expect(el.offsetValue('outside')).toBe(null);
            // Re-adding the same value is a no-op and says nothing (gtklevelbar.c:259-260).
            el.addOffsetValue('my-offset', 0.6);
            expect(changed.length).toBe(1);
            host.remove();
        });

        await it('replacing an offset re-sorts the list it is walked in', () => {
            const { el, host } = mount();
            el.addOffsetValue('mid', 0.5);
            expect(el.offsetValue('mid')).toBe(0.5);
            el.addOffsetValue('mid', 0.05);
            // Now the LOWEST offset of all, so it names even a value of 0.
            expect(blocks(el)).toStrictEqual(['empty', 'filled mid']);
            el.value = 0.3;
            expect(blocks(el)).toStrictEqual(['empty', 'filled high']);
            host.remove();
        });

        await it('removes an offset and the class goes with it', () => {
            const { el, host } = mount({ value: '0.9' });
            el.removeOffsetValue('full');
            // Nothing is above 0.9 any more, so nothing names it.
            expect(blocks(el)).toStrictEqual(['empty', 'filled']);
            host.remove();
        });
    });

    await describe('<gtk-level-bar> mode', async () => {
        await it('discrete draws one block per unit of the interval, filled from the left', () => {
            // gtklevelbar.c:285-294 and :630-633.
            const { el, host } = mount({ mode: 'discrete', 'max-value': '5', value: '3' });
            expect(el.classList.contains('discrete')).toBe(true);
            expect(blocks(el)).toStrictEqual(['filled', 'filled', 'filled', 'empty', 'empty']);
            host.remove();
        });

        await it('inverted fills from the far end without reordering the DOM', () => {
            // gtklevelbar.c:637, 648 — the INDEX is reversed, the node order is not.
            const { el, host } = mount({ mode: 'discrete', 'max-value': '4', value: '1', inverted: '' });
            expect(blocks(el)).toStrictEqual(['empty', 'empty', 'empty', 'filled full']);
            host.remove();
        });

        await it('a one-unit interval is one block, and the value fills none of it', () => {
            // `MAX(1, round(max) − round(min))` blocks, but `MIN(blocks, round(value) −
            // round(min))` of them are filled — and for a zero-width interval that second
            // number is 0 (gtklevelbar.c:291, :633).
            const { el, host } = mount({ mode: 'discrete', 'min-value': '3', 'max-value': '3', value: '3' });
            expect(blocks(el)).toStrictEqual(['empty']);
            host.remove();
        });

        await it('carries the orientation the stylesheet selects on', () => {
            const { el, host } = mount({ orientation: 'vertical' });
            expect(el.classList.contains('vertical')).toBe(true);
            expect(el.classList.contains('horizontal')).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-level-bar> interval', async () => {
        await it('raising the minimum drags the value up with it', () => {
            // gtklevelbar.c:1191-1192 — set_min_value moves `value`, then notifies it.
            const { el, host } = mount({ value: '0.1' });
            const events: string[] = [];
            el.addEventListener('notify::value', () => events.push('value'));
            el.minValue = 0.5;
            expect(el.value).toBe(0.5);
            expect(events).toStrictEqual(['value']);
            host.remove();
        });

        await it('lowering the maximum drags the value down AND clamps the offsets', () => {
            // gtklevelbar.c:1229-1234 and gtk_level_bar_ensure_offsets_in_range :667-682.
            const { el, host } = mount({ value: '0.9' });
            el.maxValue = 0.4;
            expect(el.value).toBe(0.4);
            expect(el.offsetValue('high')).toBe(0.4);
            expect(el.offsetValue('full')).toBe(0.4);
            expect(el.getAttribute('aria-valuemax')).toBe('0.4');
            host.remove();
        });

        await it('reports the real interval to assistive technology, not 0…1', () => {
            const { el, host } = mount({ 'min-value': '10', 'max-value': '20', value: '15' });
            expect(el.getAttribute('aria-valuemin')).toBe('10');
            expect(el.getAttribute('aria-valuemax')).toBe('20');
            expect(el.getAttribute('aria-valuenow')).toBe('15');
            expect(
                (el.querySelector('.adw-level-bar-block.filled') as HTMLElement).style.getPropertyValue(
                    '--level-fraction',
                ),
            ).toBe('0.5');
            host.remove();
        });
    });

    await describe('<gtk-level-bar> notification', async () => {
        await it('notifies with the parsed property, and not on a re-render', () => {
            const { el, host } = mount();
            const details: unknown[] = [];
            el.addEventListener('notify::value', (e) => details.push((e as CustomEvent).detail));
            el.value = 0.4;
            el.value = 0.4;
            el.mode = 'discrete';
            expect(details).toStrictEqual([{ value: 0.4 }]);
            host.remove();
        });
    });
};
