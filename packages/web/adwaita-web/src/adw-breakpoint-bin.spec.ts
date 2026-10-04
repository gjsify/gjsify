// DOM-level tests for `<adw-breakpoint-bin>`, driven by the SAME breakpoint-bin
// vectors the core suite asserts (`@gjsify/adwaita-core/conformance`).
//
// Every row runs against a real element in a real document, resized by a real
// `ResizeObserver`, and read back off the DOM — not off `BreakpointBinState`, which a
// renderer could call without ever wiring it to a size. That matters most for these two
// tables: the pick order (the LAST match wins, not the narrowest) and the restore order
// (a property both breakpoints set is written ONCE) are the two rules a port gets wrong
// by reading the source the intuitive way.
//
// HOW A VECTOR READS BACK. The tables name objects and properties; here an object is a
// labelled `<gtk-label id="…">` inside the bin and a property is an ATTRIBUTE on it,
// which is the form the `breakpoints` attribute writes and therefore the only thing
// observable. Every original starts ABSENT, so `orig:<object>.<property>` in a table —
// the value `adw_breakpoint_add_setter` captures — means "the attribute is gone again",
// which is `removeAttribute` and is half the behaviour under test.
import { describe, expect, it } from '@gjsify/unit';

import { BREAKPOINT_PICK_VECTORS, BREAKPOINT_TRANSITION_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { AdwBreakpointBin } from './elements/adw-breakpoint-bin.js';

/** Two frame callbacks — where a `ResizeObserver` delivery lands. */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/** One `[object, property]` per pair any setter in `breakpoints` names. */
function universe(
    breakpoints: readonly (readonly [string, readonly (readonly [string, string, string])[]])[],
): string[] {
    const keys = new Set<string>();
    for (const [, setters] of breakpoints) for (const [object, property] of setters) keys.add(`${object}.${property}`);
    return [...keys].sort();
}

/** `obj.prop=value`, or `obj.prop=<absent>` when the element does not carry it. */
function read(objects: ReadonlyMap<string, Element>, keys: readonly string[]): string[] {
    return keys.map((key) => {
        const dot = key.lastIndexOf('.');
        const value = objects.get(key.slice(0, dot))?.getAttribute(key.slice(dot + 1));
        return value === undefined ? key : `${key}=${value ?? '<absent>'}`;
    });
}

/**
 * The state a transition is expected to leave, over the whole universe of pairs.
 *
 * Read as a STATE rather than replayed as writes, because that is the only way the skip
 * shows up at all: restoring `title` and then setting it again lands on the same value as
 * setting it once, and only the pair LIST says which happened — every pair the transition
 * did not write is at its original, which is absent here.
 */
function spell(row: (typeof BREAKPOINT_TRANSITION_VECTORS)[number], step: number): string[] {
    const written = new Map<string, string>();
    for (const write of row.writes[step] ?? []) {
        const equals = write.indexOf('=');
        const value = write.slice(equals + 1);
        written.set(write.slice(0, equals), value.startsWith('orig:') ? '<absent>' : value);
    }
    return universe(row.breakpoints)
        .map((key) => `${key}=${written.get(key) ?? '<absent>'}`)
        .sort();
}

/**
 * Mount one bin filling a host of the given size, with these breakpoints and one child
 * per object.
 *
 * The bin FILLS its host: a GTK widget takes the allocation its parent gives it, and a
 * block-level div only fills the width. Both axes of the pick table are measured, so the
 * stage has to hand over a height as well — which is the C's own advice to set
 * `width-request`/`height-request` on a bin that carries breakpoints.
 */
async function mount(
    width: number,
    height: number,
    breakpoints: string,
    objects: readonly string[],
): Promise<{ bin: AdwBreakpointBin; host: HTMLElement; children: Map<string, Element> }> {
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    document.body.appendChild(host);
    const bin = document.createElement('adw-breakpoint-bin') as AdwBreakpointBin;
    bin.style.height = '100%';
    bin.setAttribute('breakpoints', breakpoints);
    host.appendChild(bin);
    const children = new Map<string, Element>();
    for (const name of objects) {
        const el = document.createElement('gtk-label');
        el.id = name;
        bin.appendChild(el);
        children.set(name, el);
    }
    await settle();
    return { bin, host, children };
}

/** `breaks` as the attribute takes it, with each target a selector on its object. */
const authored = (
    breakpoints: readonly (readonly [string, readonly (readonly [string, string, string])[]])[],
): string =>
    JSON.stringify(
        breakpoints.map(([condition, setters]) => ({
            condition,
            setters: setters.map(([target, property, value]) => ({ target: `#${target}`, property, value })),
        })),
    );

export const AdwBreakpointBinTest = async () => {
    for (const row of BREAKPOINT_PICK_VECTORS) {
        await it(`picks the right breakpoint — ${row.rule}`, async () => {
            // No setters at all: this table is about WHICH condition wins, and a setter
            // would add a second thing the row could be failing at.
            // One child, because a bin with no child picks nothing at all
            // (`adw_breakpoint_bin_size_allocate` returns before the loop, :427) and this
            // table is about WHICH condition wins.
            const { bin, host } = await mount(
                row.size.width,
                row.size.height,
                JSON.stringify(row.conditions.map((condition) => ({ condition, setters: [] }))),
                ['child'],
            );
            await settle();
            const picked = bin.currentBreakpoint;
            host.remove();
            expect(`[${row.conditions.join(' | ')}] @ ${row.size.width}×${row.size.height} → ${picked ?? 'none'}`).toBe(
                `[${row.conditions.join(' | ')}] @ ${row.size.width}×${row.size.height} → ${row.pick ?? 'none'}`,
            );
        });
    }

    for (const row of BREAKPOINT_TRANSITION_VECTORS) {
        await it(`transitions — ${row.rule}`, async () => {
            const keys = universe(row.breakpoints);
            const names = [...new Set(row.breakpoints.flatMap(([, setters]) => setters.map(([o]) => o)))].sort();
            const { host, children } = await mount(800, 600, authored(row.breakpoints), names);
            let previous = read(children, keys);
            const observed: string[][] = [];
            const wanted: string[][] = [];
            for (const [at, size] of row.sizes.entries()) {
                // A `null` step means NO transition at all, so the state after it is the
                // state before it — which is the assertion, not a copy of what was read.
                if (row.writes[at] === null) wanted.push(previous);
                else wanted.push(spell(row, at));
                host.style.width = `${size.width}px`;
                host.style.height = `${size.height}px`;
                await settle();
                const now = read(children, keys);
                observed.push(now);
                previous = now;
            }
            host.remove();
            for (let at = 0; at < observed.length; at++) {
                expect(`${row.rule} step ${at}: ${JSON.stringify(observed[at])}`).toBe(
                    `${row.rule} step ${at}: ${JSON.stringify(wanted[at])}`,
                );
            }
        });
    }

    await describe('<adw-breakpoint-bin> the bin itself', async () => {
        await it('has no minimum size while it holds breakpoints, and clips like the C', async () => {
            const { bin, host } = await mount(
                400,
                600,
                JSON.stringify([{ condition: 'max-width: 720px', setters: [] }]),
                [],
            );
            const style = getComputedStyle(bin);
            const report = `min-width:${style.minWidth} overflow:${style.overflow}`;
            host.remove();
            expect(report).toBe('min-width:0px overflow:hidden');
        });

        await it('signals unapply BEFORE the writes and apply AFTER them', async () => {
            // Mounted WIDE and listening before the first write, so the apply is in the
            // log rather than already done.
            const { bin, host, children } = await mount(
                900,
                600,
                JSON.stringify([
                    {
                        condition: 'max-width: 720px',
                        setters: [{ target: '#caption', property: 'label', value: 'Narrow' }],
                    },
                ]),
                ['caption'],
            );
            const caption = children.get('caption') as Element;
            const log: string[] = [];
            bin.addEventListener('breakpoint-unapply', () => log.push(`unapply:${caption.getAttribute('label')}`));
            bin.addEventListener('breakpoint-apply', () => log.push(`apply:${caption.getAttribute('label')}`));
            bin.addEventListener('notify::current-breakpoint', () => log.push(`notify:${bin.currentBreakpoint}`));
            host.style.width = '400px';
            await settle();
            host.style.width = '900px';
            await settle();
            host.remove();
            // A listener on the APPLY end sees the value its own breakpoint wrote and one
            // on the UNAPPLY end still sees the OUTGOING value — the signal precedes the
            // restore, so neither end observes the restore at all.
            expect(log.join(' | ')).toBe('apply:Narrow | notify:0 | unapply:Narrow | notify:null');
        });

        await it('writes a property both breakpoints set ONCE, not restored and re-set', async () => {
            const { host, children } = await mount(
                500,
                600,
                JSON.stringify([
                    {
                        condition: 'max-width: 720px',
                        setters: [
                            { target: '#view', property: 'title', value: 'narrow' },
                            { target: '#view', property: 'collapsed', value: 'true' },
                        ],
                    },
                    {
                        condition: 'max-width: 400px',
                        setters: [{ target: '#view', property: 'collapsed', value: 'false' }],
                    },
                ]),
                ['view'],
            );
            const view = children.get('view') as Element;
            // 500 is inside the FIRST breakpoint only, so the second is entered by a
            // resize and the skip is the difference between one mutation per property
            // and two on the one both breakpoints set. Without it the restore would write
            // `collapsed` twice — once removing it, once setting `false` — and the final
            // state would be identical either way, which is why the COUNT is the assertion.
            const mutations = new Map<string, number>();
            new MutationObserver((records) => {
                for (const record of records) {
                    mutations.set(record.attributeName, (mutations.get(record.attributeName) ?? 0) + 1);
                }
            }).observe(view, { attributes: true });
            host.style.width = '300px';
            await settle();
            const report = `${[...mutations]
                .sort()
                .map(([k, v]) => `${k}x${v}`)
                .join(' ')} collapsed:${view.getAttribute('collapsed')} title:${view.hasAttribute('title')}`;
            host.remove();
            expect(report).toBe('collapsedx1 titlex1 collapsed:false title:false');
        });

        await it('keeps tracking its conditions after a re-parent', async () => {
            const first = document.createElement('div');
            first.style.width = '400px';
            first.style.height = '600px';
            document.body.appendChild(first);
            const bin = document.createElement('adw-breakpoint-bin') as AdwBreakpointBin;
            bin.setAttribute(
                'breakpoints',
                JSON.stringify([
                    {
                        condition: 'max-width: 720px',
                        setters: [{ target: '#caption', property: 'label', value: 'Narrow' }],
                    },
                ]),
            );
            const caption = document.createElement('gtk-label');
            caption.id = 'caption';
            caption.setAttribute('label', 'Wide');
            bin.appendChild(caption);
            first.appendChild(bin);
            await settle();

            // 800 → 500 → 900 is the cycle `BreakpointBinState.inherit` was added for: a
            // bin rebuilt at "none applied" hears no unapply on the way back to 900px and
            // the caption stays narrow for good.
            const second = document.createElement('div');
            second.style.width = '500px';
            second.style.height = '600px';
            document.body.appendChild(second);
            second.appendChild(bin);
            await settle();
            const narrow = caption.getAttribute('label');

            second.style.width = '900px';
            await settle();
            const wide = caption.getAttribute('label');

            first.remove();
            second.remove();
            expect(`500px:${narrow} → 900px:${wide}`).toBe('500px:Narrow → 900px:Wide');
        });

        await it('picks nothing while it has no child, as `adw_breakpoint_bin_size_allocate` does', async () => {
            const { bin, host } = await mount(
                400,
                600,
                JSON.stringify([
                    {
                        condition: 'max-width: 720px',
                        setters: [{ target: '#caption', property: 'label', value: 'Narrow' }],
                    },
                ]),
                [],
            );
            const childless = bin.currentBreakpoint;
            bin.appendChild(document.createElement('gtk-label'));
            // A child arriving is not a size change, and the C only re-picks on an
            // allocation — so the next allocation is what this test waits for.
            host.style.width = '401px';
            await settle();
            host.style.width = '400px';
            await settle();
            const withChild = bin.currentBreakpoint;
            host.remove();
            expect(`childless:${childless} with:${withChild}`).toBe('childless:null with:0');
        });

        await it('applies nothing from an attribute that is not JSON', async () => {
            const { bin, host } = await mount(400, 600, 'not json', []);
            await settle();
            const dropped = bin.currentBreakpoint;
            host.remove();
            expect(`dropped:${dropped}`).toBe('dropped:null');
        });
    });
};
