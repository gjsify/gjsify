// "Evaluated once at connect time", driven over EVERY element the package registers.
//
// THE INCIDENT, in two shapes
//
//   1. `<adw-toolbar-view>` documents `topBar` as the imperative append point and then
//      derives `topEl.hidden = childElementCount === 0` inside the `_initialized` guard,
//      never again. A header bar appended AFTER connect therefore sits in the DOM with
//      the right classes at offsetHeight 0 — the compiled sheet ends with a global
//      `[hidden] { display: none !important }`, so the widget's own `display: flex` does
//      not win — while the IDENTICAL declared bar renders at 48px. Six getters across
//      three files had it.
//   2. Most element classes open `connectedCallback` with an `_initialized` early
//      return. For the ones that also tear something down in `disconnectedCallback`, a
//      bare re-parent — a slideshow slide, a client-side route, moving a node between
//      two containers — dropped the outside binding and never restored it.
//
// A per-widget spec is one more spec per widget to forget, and both shapes were found
// by reading rather than by a failing test. So neither list here is written down:
// {@link registeredElements} reads the CustomElementRegistry and {@link containerGetters}
// reads the accessor shape, so a container written in that shape enrols itself.
//
// Its static sibling is `scripts/check-adwaita-connect-rebind.mjs`, which holds shape 2
// at the source level, where a missing rebind is visible without a widget that shows it.
import { describe, expect, it } from '@gjsify/unit';

import * as adwaitaWeb from './index.js';

/**
 * Elements that cannot RENDER a child, however the DOM lets you append one. A container
 * getter returning one of these is an imperative handle (`<adw-entry>.input`, for
 * focus and selection), not an append point, and appending to it measures 0 forever.
 * The HTML void-element set, not a per-widget ledger — a new container still enrols
 * itself; only a new void element in the spec would need a line here.
 */
const NON_RENDERING = new Set([
    'input',
    'img',
    'br',
    'hr',
    'area',
    'base',
    'col',
    'embed',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
]);

/**
 * Undo the two states in which a correctly-built widget legitimately reads
 * `display: none`, so the driver measures the widget and not the state. Both cost a
 * reviewer real time: a driver without this goes red on correct code, which is worse
 * than the bug it hunts.
 *
 * Asked of the ELEMENT, not looked up per tag: every dialog answers `present()`, so a
 * fifth one enrols itself instead of failing the day it grows a container getter. The
 * expander is keyed by tag because "collapsed" is its own idea and nothing else has it.
 *
 * Everything else is expected to lay a child out with no setup at all, which is what
 * "append here imperatively" promises.
 */
function reveal(el: HTMLElement): void {
    // `<adw-dialog>.contentArea` and every dialog after it are merely not PRESENTED —
    // `display: none` until `present()`, exactly as `Adw.Dialog` is until it is pushed.
    const dialog = el as HTMLElement & { present?: () => void };
    if (typeof dialog.present === 'function') dialog.present();
    // `<adw-expander-row>.contentSection` is merely COLLAPSED — it is the disclosure.
    if (el.localName === 'adw-expander-row') el.setAttribute('expanded', '');
}

/**
 * Every tag the package registers, asked of the registry that registered them, next to
 * every exported element class the registry does NOT know.
 *
 * The second half is a `define` that was dropped or renamed: those tags would silently
 * leave this whole driver. It is REPORTED rather than asserted here, because this runs
 * at namespace level — an `expect` that throws out here escapes `runTests`, and the
 * runner's promise chain never reaches `browserSignalDone()`, so the page never sets
 * `data-tests-done` and Playwright kills the leg on a timeout naming no test. This
 * namespace is registered FIRST, so that would take all of adwaita-web's browser
 * assertions with it and report none of them.
 */
function registeredElements(): { tags: string[]; unregistered: string[] } {
    const tags: string[] = [];
    const unregistered: string[] = [];
    for (const exported of Object.values(adwaitaWeb)) {
        if (typeof exported !== 'function' || !(exported.prototype instanceof HTMLElement)) continue;
        const tag = customElements.getName(exported as CustomElementConstructor);
        if (tag === null) unregistered.push(exported.name);
        else tags.push(tag);
    }
    return { tags: tags.sort(), unregistered: unregistered.sort() };
}

/**
 * The containers a consumer is invited to append into, derived from the accessor SHAPE:
 * a getter with NO setter whose value is an element this one already CONTAINS.
 *
 * Each half earns its place. No setter, because a container you append into is not one
 * you replace by assignment — that is what separates `topBar` from `anchor` and
 * `activatableWidget`. Contained, because the handle has to be part of THIS widget's
 * own subtree — `<adw-popover>.anchor` defaults to `parentElement` and is not. And a
 * value that is not an element at all (`items`, `groups`, a `null` slot on an empty
 * widget) is nothing to append to.
 *
 * So this enrols the SHAPE the six containers of the incident have, not every possible
 * one: a container exposed as a get/set pair, or one the widget only attaches once it
 * has children, is invisible here and needs its own coverage.
 */
function containerGetters(el: HTMLElement): Array<[string, HTMLElement]> {
    const found: Array<[string, HTMLElement]> = [];
    for (let proto = Object.getPrototypeOf(el); proto && proto !== HTMLElement.prototype;) {
        for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
            if (typeof descriptor.get !== 'function' || descriptor.set !== undefined) continue;
            const value: unknown = descriptor.get.call(el);
            if (!(value instanceof HTMLElement) || value === el || !el.contains(value)) continue;
            if (NON_RENDERING.has(value.localName)) continue;
            found.push([name, value]);
        }
        proto = Object.getPrototypeOf(proto);
    }
    return found.sort(([a], [b]) => a.localeCompare(b));
}

/** A visible host of a known size, so a collapsed child cannot hide behind a 0-width page. */
function visibleHost(): HTMLElement {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    return host;
}

/** A slotted split-view pane, so the two slot names are spelled once and not inside markup. */
function pane(slot: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('slot', slot);
    el.textContent = slot;
    return el;
}

/** A child with a size of its OWN, so the box measured is the container's answer, not the content's. */
function probe(): HTMLElement {
    const box = document.createElement('div');
    box.style.width = '24px';
    box.style.height = '24px';
    // A flex container would otherwise shrink it to nothing and the measurement would
    // say "collapsed" about a container that is perfectly fine.
    box.style.flex = '0 0 auto';
    return box;
}

/** Two frames: one for the append to land, one for anything a MutationObserver schedules. */
async function settle(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** `laid out`, or the real numbers — a bare `false` names neither the widget nor the size. */
function verdict(el: HTMLElement): string {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return `collapsed ${Math.round(box.width)}x${Math.round(box.height)}`;
    // A box is not a pixel. `visibility` INHERITS, so a container that hid its subtree
    // that way leaves the child measuring its full 24x24 — one read on the CHILD is
    // enough to tell the two apart, and no walk up the tree is needed.
    if (getComputedStyle(el).visibility === 'hidden') return 'invisible';
    const onScreen = box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
    return onScreen ? 'laid out' : `off-screen at ${Math.round(box.left)},${Math.round(box.top)}`;
}

/** `same box`, or both sizes — the numbers are what says whether a difference is real. */
function boxDelta(a: HTMLElement, b: HTMLElement): string {
    const x = a.getBoundingClientRect();
    const y = b.getBoundingClientRect();
    const same = Math.abs(x.width - y.width) < 1 && Math.abs(x.height - y.height) < 1;
    return same
        ? 'same box'
        : `${x.width.toFixed(2)}x${x.height.toFixed(2)} vs ${y.width.toFixed(2)}x${y.height.toFixed(2)}`;
}

/**
 * The rendered SHAPE of a subtree — tags, classes and what is hidden, no text and no
 * generated ids. It is what a re-parent must not change: two elements built the same
 * way differ here only because one of them derived something from where it was built.
 */
function skeleton(el: Element): string {
    const classes = [...el.classList].sort().join('.');
    const hidden = (el as HTMLElement).hidden ? '[hidden]' : '';
    const children = [...el.children].map(skeleton).join(',');
    return `${el.localName}${classes === '' ? '' : `.${classes}`}${hidden}(${children})`;
}

export const AdwConnectLifecycleTest = async () => {
    const { tags, unregistered } = registeredElements();

    await describe('imperative append points', async () => {
        await it('finds the elements and their containers', async () => {
            // A dropped or renamed `define`, named as ONE failing test: the tags it
            // carries would otherwise leave this driver with nothing going red.
            expect(`unregistered: ${unregistered.join(', ')}`).toBe('unregistered: ');
            // A scan that finds nothing passes vacuously, and every `it` below it would
            // report a green it never earned. Floors, not exact counts: the point of the
            // derivation is that both numbers grow without this file being edited.
            expect(tags.length > 40).toBe(true);
            const containers = tags.flatMap((tag) => {
                const host = visibleHost();
                const el = document.createElement(tag);
                host.appendChild(el);
                reveal(el);
                const names = containerGetters(el).map(([name]) => `${tag}.${name}`);
                host.remove();
                return names;
            });
            expect(containers.length > 5).toBe(true);
        });

        for (const tag of tags) {
            await it(`<${tag}> lays out a child appended after connect`, async () => {
                const host = visibleHost();
                const el = document.createElement(tag);
                host.appendChild(el);
                reveal(el);

                const containers = containerGetters(el);
                const probes = containers.map(([name, container]) => {
                    const child = probe();
                    container.appendChild(child);
                    return [name, child] as const;
                });
                await settle();

                const report = probes.map(([name, child]) => `${name}: ${verdict(child)}`).join(' | ');
                const wanted = probes.map(([name]) => `${name}: laid out`).join(' | ');
                // Measure, THEN tear down, THEN assert: a failing expectation throws, and
                // a host left on the page pushes every later one down until the next
                // widget is measured off-screen. That cascade turned one real failure
                // into four, three of which named the wrong widget.
                host.remove();
                expect(`<${tag}> ${report}`).toBe(`<${tag}> ${wanted}`);
            });
        }
    });

    await describe('re-parent', async () => {
        for (const tag of tags) {
            await it(`<${tag}> survives a move out of a display:none parent`, async () => {
                // The reproduction shape the incident named: built where there is no
                // layout at all, then moved somewhere there is.
                const dark = visibleHost();
                dark.style.display = 'none';
                const moved = document.createElement(tag);
                dark.appendChild(moved);
                reveal(moved);

                // THREE hosts, one widget each. Put the two in one host and the row
                // stylesheets separate them for us: `:last-child` drops the hairline, so
                // the reference row measured 52px and the moved one 51px — a difference
                // in the SETUP, reported against `<adw-expander-row>` and `<adw-spin-row>`.
                const control = visibleHost();
                const fresh = document.createElement(tag);
                control.appendChild(fresh);
                reveal(fresh);

                const light = visibleHost();
                light.appendChild(moved);
                reveal(moved);
                await settle();

                // Built in the dark and moved into the light, a widget must be
                // indistinguishable from one built here — same rendered shape, same box.
                // BOTH skeletons on a mismatch: one of them alone leaves the reader to
                // reproduce the run to find out what actually differed.
                const shape =
                    skeleton(moved) === skeleton(fresh) ? 'same shape' : `${skeleton(moved)} vs ${skeleton(fresh)}`;
                const size = boxDelta(moved, fresh);
                dark.remove();
                control.remove();
                light.remove();
                expect(`<${tag}> ${shape}`).toBe(`<${tag}> same shape`);
                expect(`<${tag}> ${size}`).toBe(`<${tag}> same box`);
            });
        }
    });

    // Shape and box are blind to a binding that reaches OUTSIDE the element — a dead
    // MediaQuery or document listener changes nothing until something fires it. These
    // two fire it. Both split views are driven, the overlay one as the control: it
    // already split `_buildOnce` from `_bindToDocument`, so a probe that cannot tell the
    // two apart is measuring nothing.
    await describe('outside bindings after a re-parent', async () => {
        for (const tag of ['adw-navigation-split-view', 'adw-overlay-split-view']) {
            await it(`<${tag}> still tracks its breakpoint after a move`, async () => {
                const first = visibleHost();
                const view = document.createElement(tag);
                view.setAttribute('breakpoint', 'max-width: 720px');
                view.append(pane('sidebar'), pane('content'));
                first.appendChild(view);
                await settle();
                const wide = view.hasAttribute('collapsed') ? 'collapsed' : 'expanded';

                const second = visibleHost();
                second.appendChild(view);
                second.style.width = '500px';
                await settle();
                const narrow = view.hasAttribute('collapsed') ? 'collapsed' : 'expanded';

                // BOTH directions, because only one of them needs the carried state.
                // Collapsing after a move works off a fresh breakpoint (false → true is a
                // transition); coming back WIDE does not, and a breakpoint rebuilt at
                // `applied = false` matches its own start state and never unapplies. The
                // view stayed collapsed at 900px in both engines until the rebind carried
                // what the last one had set.
                const third = visibleHost();
                third.style.width = '900px';
                third.appendChild(view);
                await settle();
                const again = view.hasAttribute('collapsed') ? 'collapsed' : 'expanded';

                first.remove();
                second.remove();
                third.remove();
                expect(`<${tag}> 800px:${wide} → 500px:${narrow} → 900px:${again}`).toBe(
                    `<${tag}> 800px:expanded → 500px:collapsed → 900px:expanded`,
                );
            });
        }

        await it('<adw-popover> still dismisses on an outside click after a move', async () => {
            const first = visibleHost();
            const popover = document.createElement('adw-popover');
            first.appendChild(popover);
            (popover as HTMLElement & { popup(): void }).popup();

            const second = visibleHost();
            second.appendChild(popover);
            const outside = visibleHost();
            outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const afterClick = popover.hasAttribute('open') ? 'still open' : 'dismissed';

            (popover as HTMLElement & { popup(): void }).popup();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const afterEscape = popover.hasAttribute('open') ? 'still open' : 'dismissed';

            first.remove();
            second.remove();
            outside.remove();
            expect(`click:${afterClick} escape:${afterEscape}`).toBe('click:dismissed escape:dismissed');
        });
    });
};
