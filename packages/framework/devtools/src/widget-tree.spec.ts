// @gjsify/devtools — widget-path parse/build tests (pure logic).

import { describe, expect, it } from '@gjsify/unit';
import type Gtk from 'gi://Gtk?version=4.0';
import {
    activateWidget,
    buildWidgetPath,
    DEFAULT_DUMP_DEPTH,
    dumpTree,
    findWidgetPath,
    parseWidgetPath,
    parseWidgetSelector,
    sendKeyToWidget,
    widgetType,
} from './widget-tree.js';

// widgetType() is duck-typed on purpose (it reads runtime-provided accessors that
// differ per runtime), so the specs feed it plain shapes cast to Gtk.Widget.
const asWidget = (shape: object): Gtk.Widget => shape as unknown as Gtk.Widget;

export default async () => {
    await describe('parseWidgetPath', async () => {
        await it('parses a toplevel-only path', async () => {
            expect(parseWidgetPath('toplevel:0')).toStrictEqual({ toplevel: 0, children: [] });
        });

        await it('parses a nested path', async () => {
            expect(parseWidgetPath('toplevel:2/child:0/child:3')).toStrictEqual({ toplevel: 2, children: [0, 3] });
        });

        await it('rejects malformed paths', async () => {
            expect(parseWidgetPath('')).toBeNull();
            expect(parseWidgetPath('child:0')).toBeNull();
            expect(parseWidgetPath('toplevel:x')).toBeNull();
            expect(parseWidgetPath('toplevel:0/nope:1')).toBeNull();
        });
    });

    await describe('buildWidgetPath', async () => {
        await it('round-trips with parseWidgetPath', async () => {
            const path = buildWidgetPath(2, [0, 3]);
            expect(path).toBe('toplevel:2/child:0/child:3');
            expect(parseWidgetPath(path)).toStrictEqual({ toplevel: 2, children: [0, 3] });
        });

        await it('builds a toplevel-only path', async () => {
            expect(buildWidgetPath(0, [])).toBe('toplevel:0');
        });
    });

    await describe('widgetType', async () => {
        await it('reads the concrete runtime type off GJS constructor.$gtype.name', async () => {
            // GJS downcasts a returned widget to its concrete class.
            expect(widgetType(asWidget({ constructor: { $gtype: { name: 'AdwBin' } } }))).toBe('AdwBin');
        });

        await it('reads the node-gi wrapper runtime type off $typeName', async () => {
            // node-gi returns a generic wrapper; the runtime GType is on $typeName.
            expect(widgetType(asWidget({ $typeName: 'AdwBreakpointBin' }))).toBe('AdwBreakpointBin');
        });

        await it('prefers $typeName over the generic wrapper constructor', async () => {
            // On node-gi the generic wrapper's constructor.$gtype.name would be the
            // static declared type (or absent) — $typeName must win.
            expect(
                widgetType(asWidget({ $typeName: 'FireworksWindow', constructor: { $gtype: { name: 'GtkWidget' } } })),
            ).toBe('FireworksWindow');
        });

        await it('falls back to GtkWidget when no type is resolvable', async () => {
            // A genuinely type-less object: no constructor chain (so no
            // constructor.$gtype) and no $typeName. (A plain `{}` is unsuitable
            // here: GJS defines Object.$gtype.name === 'JSObject', but a real
            // widget's constructor is always its concrete class, never Object.)
            expect(widgetType(asWidget(Object.create(null)))).toBe('GtkWidget');
            // An empty $typeName must not be treated as a type.
            const noType = Object.create(null) as { $typeName?: string };
            noType.$typeName = '';
            expect(widgetType(asWidget(noType))).toBe('GtkWidget');
        });
    });

    await describe('parseWidgetSelector', async () => {
        await it('splits type and css class', async () => {
            expect(parseWidgetSelector('GtkButton:suggested-action')).toStrictEqual({
                type: 'GtkButton',
                cssClass: 'suggested-action',
            });
            expect(parseWidgetSelector('GtkButton')).toStrictEqual({ type: 'GtkButton', cssClass: '' });
            expect(parseWidgetSelector(':pill')).toStrictEqual({ type: '', cssClass: 'pill' });
        });

        await it('rejects a selector that would match everything', async () => {
            // A selector with neither half is not "match anything" — it is a caller mistake, and
            // answering it with the first widget in the window would be a confident wrong answer.
            expect(parseWidgetSelector('')).toBe(null);
            expect(parseWidgetSelector(':')).toBe(null);
            expect(parseWidgetSelector('  :  ')).toBe(null);
        });
    });

    await describe('findWidgetPath', async () => {
        // A node shape with the four accessors findWidgetPath reads.
        const node = (
            type: string,
            opts: { classes?: string[]; visible?: boolean; mapped?: boolean; children?: object[] } = {},
        ): object => {
            const kids = (opts.children ?? []) as Array<Record<string, unknown>>;
            for (let i = 0; i < kids.length; i++) {
                kids[i].get_next_sibling = () => kids[i + 1] ?? null;
            }
            return {
                constructor: { $gtype: { name: type } },
                get_visible: () => opts.visible !== false,
                get_mapped: () => opts.mapped !== false,
                get_css_classes: () => opts.classes ?? [],
                get_first_child: () => kids[0] ?? null,
                get_next_sibling: () => null,
            };
        };

        await it('returns the path of the first depth-first match', async () => {
            const tree = node('GtkBox', {
                children: [
                    node('GtkLabel'),
                    node('GtkBox', { children: [node('GtkButton', { classes: ['pill'] })] }),
                    node('GtkButton'),
                ],
            });
            expect(findWidgetPath(asWidget(tree), { type: 'GtkButton', cssClass: '' }, 'toplevel:0')).toBe(
                'toplevel:0/child:1/child:0',
            );
        });

        await it('matches on css class alone, and on both halves together', async () => {
            const tree = node('GtkBox', {
                children: [node('GtkButton'), node('GtkButton', { classes: ['suggested-action'] })],
            });
            expect(findWidgetPath(asWidget(tree), { type: '', cssClass: 'suggested-action' }, 'toplevel:0')).toBe(
                'toplevel:0/child:1',
            );
            expect(
                findWidgetPath(asWidget(tree), { type: 'GtkButton', cssClass: 'suggested-action' }, 'toplevel:0'),
            ).toBe('toplevel:0/child:1');
        });

        await it('skips invisible and unmapped widgets — and their children', async () => {
            // The other pages of a stack are full of real, matching widgets nobody can click.
            // Descending into them would hand back a path that activates nothing visible.
            const hiddenPage = node('GtkBox', { visible: false, children: [node('GtkButton')] });
            const unmappedPage = node('GtkBox', { mapped: false, children: [node('GtkButton')] });
            const shown = node('GtkBox', { children: [node('GtkButton')] });
            const tree = node('GtkStack', { children: [hiddenPage, unmappedPage, shown] });
            expect(findWidgetPath(asWidget(tree), { type: 'GtkButton', cssClass: '' }, 'toplevel:0')).toBe(
                'toplevel:0/child:2/child:0',
            );
        });

        await it('returns null when nothing matches', async () => {
            const tree = node('GtkBox', { children: [node('GtkLabel')] });
            expect(findWidgetPath(asWidget(tree), { type: 'GtkButton', cssClass: '' }, 'toplevel:0')).toBe(null);
        });

        await it('matches the root itself', async () => {
            expect(findWidgetPath(asWidget(node('GtkWindow')), { type: 'GtkWindow', cssClass: '' }, 'toplevel:0')).toBe(
                'toplevel:0',
            );
        });
    });

    await describe('activateWidget', async () => {
        await it('calls activate() and returns true for an activatable widget', async () => {
            let called = 0;
            const btn = asWidget({
                activate() {
                    called++;
                    return true;
                },
            });
            expect(activateWidget(btn)).toBe(true);
            expect(called).toBe(1);
        });

        await it('returns false when the widget is not activatable', async () => {
            // gtk_widget_activate() returns false for a plain container.
            expect(activateWidget(asWidget({ activate: () => false }))).toBe(false);
        });

        await it('returns false when the shape has no activate() accessor', async () => {
            expect(activateWidget(asWidget(Object.create(null)))).toBe(false);
        });

        await it('coerces a non-boolean activate() result to false', async () => {
            // Only a strict true counts as activated.
            expect(activateWidget(asWidget({ activate: () => undefined as unknown as boolean }))).toBe(false);
        });

        // A GtkListBoxRow / AdwActionRow is NOT activatable via gtk_widget_activate()
        // (activate() → false); the fallback reproduces a real click on the parent
        // GtkListBox: select the row (row-selected) AND emit row-activated.
        await it('selects + activates a row via its parent GtkListBox', async () => {
            let selected: unknown = null;
            const emitted: Array<{ signal: string; row: unknown }> = [];
            const listbox = {
                constructor: { $gtype: { name: 'GtkListBox' } },
                select_row: (row: unknown) => {
                    selected = row;
                },
                emit: (signal: string, row: unknown) => emitted.push({ signal, row }),
            };
            const row = { activate: () => false, get_parent: () => listbox };
            expect(activateWidget(asWidget(row))).toBe(true);
            expect(selected).toBe(row); // select_row(row) → row-selected (selection nav)
            expect(emitted.length).toBe(1);
            expect(emitted[0].signal).toBe('row-activated');
            expect(emitted[0].row).toBe(row);
        });

        await it('does NOT drive the row when the parent is not a GtkListBox', async () => {
            let touched = false;
            const box = {
                constructor: { $gtype: { name: 'GtkBox' } },
                select_row: () => {
                    touched = true;
                },
                emit: () => {
                    touched = true;
                },
            };
            const row = { activate: () => false, get_parent: () => box };
            expect(activateWidget(asWidget(row))).toBe(false);
            expect(touched).toBe(false);
        });

        await it('prefers direct activation and never consults the parent when activate() succeeds', async () => {
            let touched = false;
            const btn = {
                activate: () => true,
                get_parent: () => ({
                    constructor: { $gtype: { name: 'GtkListBox' } },
                    select_row: () => {
                        touched = true;
                    },
                    emit: () => {
                        touched = true;
                    },
                }),
            };
            expect(activateWidget(asWidget(btn))).toBe(true);
            expect(touched).toBe(false);
        });
    });

    await describe('sendKeyToWidget', async () => {
        // Duck-typed like the rest of this module: a controller is identified by its GType NAME,
        // not by instanceof — see gtypeName for why that matters under node-gi.
        const controller = (type: string, onEmit?: (...a: unknown[]) => void): object => ({
            constructor: { $gtype: { name: type } },
            emit: (...a: unknown[]) => onEmit?.(...a),
        });
        const withControllers = (items: object[]): Gtk.Widget =>
            asWidget({
                observe_controllers: () => ({
                    get_n_items: () => items.length,
                    get_item: (i: number) => items[i] ?? null,
                }),
            });

        await it('emits key-pressed on every key controller of the widget', async () => {
            const seen: unknown[][] = [];
            const one = controller('GtkEventControllerKey', (...a) => seen.push(a));
            const two = controller('GtkEventControllerKey', (...a) => seen.push(a));
            expect(sendKeyToWidget(withControllers([one, two]), 0xffff, 4)).toBe(true);
            expect(seen).toStrictEqual([
                ['key-pressed', 0xffff, 0, 4],
                ['key-pressed', 0xffff, 0, 4],
            ]);
        });

        await it('reports false when the widget has no key controller', async () => {
            // The honest answer to "does this widget handle keys": no, rather than a silent success
            // that reads as a working keyboard.
            expect(sendKeyToWidget(withControllers([]), 0xffff, 0)).toBe(false);
        });

        await it('ignores controllers that are not key controllers', async () => {
            const gesture = controller('GtkGestureClick', () => {
                throw new Error('a click gesture must never be sent a key');
            });
            expect(sendKeyToWidget(withControllers([gesture]), 0xffff, 0)).toBe(false);
        });
    });

    await describe('dumpTree', async () => {
        /**
         * One widget, sized. `measure` answers per orientation, and the VERTICAL answer
         * is a function of the width it is asked for — which is the only reason the
         * geometry half of the dump exists.
         *
         * This suite runs on plain gjs with NO DISPLAY (see `peer-transport.spec.ts`), so
         * a real mapped widget is out of reach and this shape is the whole model of GTK
         * the geometry vectors get. It therefore models GTK's boxes as GTK has them,
         * measured on 4.22.4, rather than as the code happens to read them — the previous
         * version modelled only the two the implementation touched, and the box it was
         * missing was the one the implementation got wrong.
         */
        interface Sized {
            /**
             * The CSS MARGIN box, which is what `get_allocation` answers: content plus CSS
             * padding, border AND CSS margin. NOT what `compute_bounds` answers.
             */
            width?: number;
            height?: number;
            /**
             * How much of {@link Sized.width} is CSS margin. A stylesheet margin is inside
             * the allocation and outside `compute_bounds`, and NO `get_margin_*()` reports
             * it — which is exactly the gap that made a correctly-sized widget read as
             * clipped.
             */
            cssMargin?: { start: number; end: number; top: number; bottom: number };
            /**
             * The `margin-*` PROPERTIES, which sit outside the allocation and inside what
             * `measure` speaks, so they are the half that has to be added back.
             */
            margin?: { start: number; end: number; top: number; bottom: number };
            widthRequest?: [number, number];
            /** Called with the width `dumpTree` measured at, so a spec can vary on it. */
            heightRequest?: (forWidth: number) => [number, number];
        }

        const sizedWidget = (name: string, child: Gtk.Widget | null, size: Sized = {}): Gtk.Widget => {
            const margin = size.margin ?? { start: 0, end: 0, top: 0, bottom: 0 };
            const cssMargin = size.cssMargin ?? { start: 0, end: 0, top: 0, bottom: 0 };
            const allocated = { width: size.width ?? 100, height: size.height ?? 20 };
            return asWidget({
                constructor: { $gtype: { name } },
                get_name: () => '',
                get_css_classes: () => [],
                get_mapped: () => true,
                get_visible: () => true,
                get_first_child: () => child,
                get_next_sibling: () => null,
                get_allocation: () => ({ x: 0, y: 0, ...allocated }),
                // The BORDER box, which nothing here should read. Present so that a
                // rewrite reaching for it again fails on the CSS-margin vector below
                // instead of being right for every widget whose margins happen to come
                // from a property.
                compute_bounds: () => [
                    true,
                    {
                        get_width: () => allocated.width - cssMargin.start - cssMargin.end,
                        get_height: () => allocated.height - cssMargin.top - cssMargin.bottom,
                    },
                ],
                get_margin_start: () => margin.start,
                get_margin_end: () => margin.end,
                get_margin_top: () => margin.top,
                get_margin_bottom: () => margin.bottom,
                measure: (orientation: number, forSize: number) =>
                    orientation === 0 ? (size.widthRequest ?? [10, 100]) : (size.heightRequest?.(forSize) ?? [20, 20]),
            });
        };

        /** A chain of `depth` widgets, each the only child of the one above. */
        const chain = (depth: number): Gtk.Widget => {
            let node: Gtk.Widget | null = null;
            for (let i = depth; i > 0; --i) {
                node = sizedWidget(`GtkLevel${i}`, node);
            }
            return node as Gtk.Widget;
        };

        await it('marks a node whose children the bound cut off', async () => {
            // The pair that made this expensive: the bound is right, and it left no
            // trace — so a caller reading zero children could not tell "nothing
            // there" from "I stopped looking" (#1553).
            const dumped = dumpTree(chain(3), 1, 'toplevel:0');
            expect(dumped.truncated).toBe(undefined);
            expect(dumped.children[0]?.truncated).toBe(true);
            expect(dumped.children[0]?.children).toStrictEqual([]);
        });

        await it('does NOT mark a leaf that ends exactly at the bound', async () => {
            // A complete answer must not read as a partial one, or the marker means
            // "deep" rather than "there is more" and every caller has to guess.
            const dumped = dumpTree(chain(2), 1, 'toplevel:0');
            expect(dumped.children[0]?.truncated).toBe(undefined);
        });

        await it('reaches an ordinary window with the default depth', async () => {
            // 8 was the old default and an `AdwHeaderBar` under a routed
            // `AdwToolbarView` sits below it, so the dump answered zero header bars
            // for a window that drew one.
            const deep = dumpTree(chain(12), DEFAULT_DUMP_DEPTH, 'toplevel:0');
            let node = deep;
            let levels = 1;
            while (node.children[0]) {
                node = node.children[0];
                levels += 1;
            }
            expect(levels).toBe(12);
            expect(node.truncated).toBe(undefined);
        });

        await it('reports what a widget was given beside what it asked for', async () => {
            const dumped = dumpTree(
                sizedWidget('GtkLabel', null, {
                    width: 170,
                    height: 23,
                    widthRequest: [78, 206],
                    heightRequest: () => [17, 17],
                }),
                1,
                'toplevel:0',
            );
            expect(dumped.geometry).toStrictEqual({
                width: 170,
                height: 23,
                widthRequest: [78, 206],
                heightRequest: [17, 17],
            });
        });

        await it('measures the height AT THE ALLOCATED WIDTH, not at the natural one', async () => {
            // The whole point of the field. A wrapping label answers one line at its
            // natural width and two at the width it actually got; a dump that asked
            // `-1` would report the number that agrees with the allocation and hide
            // exactly the case worth finding.
            let askedFor: number | null = null;
            const dumped = dumpTree(
                sizedWidget('GtkLabel', null, {
                    width: 170,
                    height: 23,
                    widthRequest: [78, 206],
                    heightRequest: (forWidth) => {
                        askedFor = forWidth;
                        return forWidth >= 206 ? [17, 17] : [40, 40];
                    },
                }),
                1,
                'toplevel:0',
            );
            expect(askedFor).toBe(170);
            expect(dumped.geometry?.heightRequest).toStrictEqual([40, 40]);
            expect(dumped.geometry?.short).toBe(true);
        });

        await it('works in the margin box, which is the one measure() speaks', async () => {
            // Measured on GTK 4.22.4: `get_allocation` stops at the CSS margin box and
            // `measure` speaks the box outside the `margin-*` PROPERTIES too, so a widget
            // carrying those compares two different rectangles unless they are added
            // back. The first version of this compared against `get_width()` — the
            // CONTENT box — and called 116 of 293 widgets in a real window clipped.
            let askedFor: number | null = null;
            const dumped = dumpTree(
                sizedWidget('GtkLabel', null, {
                    width: 68,
                    height: 17,
                    margin: { start: 7, end: 7, top: 4, bottom: 4 },
                    widthRequest: [49, 82],
                    heightRequest: (forWidth) => {
                        askedFor = forWidth;
                        return [25, 25];
                    },
                }),
                1,
                'toplevel:0',
            );
            expect(dumped.geometry?.width).toBe(82);
            expect(dumped.geometry?.height).toBe(25);
            expect(askedFor).toBe(82);
            // 82x25 against a request of 82x25 is exactly met, so nothing is flagged.
            expect(dumped.geometry?.short).toBe(undefined);
        });

        await it('counts a CSS margin, which no get_margin_*() reports', async () => {
            // The regression that rewrote this function. `get_margin_start()` answers the
            // margin-start PROPERTY; a margin from a stylesheet is invisible to it and
            // shows up only inside the allocation. Measured on GTK 4.22.4, a `Gtk.Label`
            // with CSS `margin: 4px 7px` over a 306x18 content box: border box 306x18,
            // allocation 320x26, natural request 320x26. So reading the border box makes
            // an exactly-met request look 14x8 short — and, worse, measures its height at
            // 306, where the text wraps and asks for 44. That version called 12 of 127
            // mapped widgets in an ordinary Adwaita preferences window clipped, 11 of
            // them wrongly, and GTK printed a warning for three of the twelve.
            let askedFor: number | null = null;
            const dumped = dumpTree(
                sizedWidget('GtkLabel', null, {
                    width: 320,
                    height: 26,
                    cssMargin: { start: 7, end: 7, top: 4, bottom: 4 },
                    widthRequest: [143, 320],
                    heightRequest: (forWidth) => {
                        askedFor = forWidth;
                        return forWidth >= 320 ? [26, 26] : [44, 44];
                    },
                }),
                1,
                'toplevel:0',
            );
            expect(dumped.geometry?.width).toBe(320);
            expect(dumped.geometry?.height).toBe(26);
            expect(askedFor).toBe(320);
            expect(dumped.geometry?.short).toBe(undefined);
        });

        await it('never measures below the minimum width, which GTK warns about', async () => {
            // A genuinely clipped widget is the case this whole field exists to find, and
            // it is also the case where `measure(VERTICAL, allocated)` would hand GTK a
            // width below the minimum: `Trying to measure GtkBox … for width of 34, but
            // it needs at least 40`, once per clipped widget per dump. GTK clamps to the
            // minimum and answers anyway, so clamping first costs no accuracy — the
            // reported height is the same number — and the dump stops making the toolkit
            // complain on its behalf. `short` is still set: it compares the ALLOCATION,
            // not the width the measurement was taken at.
            let askedFor: number | null = null;
            const dumped = dumpTree(
                sizedWidget('GtkBox', null, {
                    width: 34,
                    height: 34,
                    widthRequest: [40, 60],
                    heightRequest: (forWidth) => {
                        askedFor = forWidth;
                        return [34, 34];
                    },
                }),
                1,
                'toplevel:0',
            );
            expect(askedFor).toBe(40);
            expect(dumped.geometry?.width).toBe(34);
            expect(dumped.geometry?.short).toBe(true);
        });

        await it('measures at -1 when a mapped widget has no allocation yet', async () => {
            // `measure(VERTICAL, 0)` is a legal call that answers about a zero-width
            // widget, so a width of 0 has to become "no constraint" rather than a
            // constraint of nothing.
            let askedFor: number | null = null;
            dumpTree(
                sizedWidget('GtkBox', null, {
                    width: 0,
                    height: 0,
                    heightRequest: (forWidth) => {
                        askedFor = forWidth;
                        return [0, 0];
                    },
                }),
                1,
                'toplevel:0',
            );
            expect(askedFor).toBe(-1);
        });

        await it('leaves an unmapped widget without geometry at all', async () => {
            // An unmapped widget has no allocation, so its two zeros beside a request
            // would read as "clipped to nothing" for every page of a stack that is not
            // the visible one.
            const unmapped = asWidget({
                constructor: { $gtype: { name: 'GtkLabel' } },
                get_name: () => '',
                get_css_classes: () => [],
                get_mapped: () => false,
                get_visible: () => true,
                get_first_child: () => null,
                get_next_sibling: () => null,
            });
            const dumped = dumpTree(unmapped, 1, 'toplevel:0');
            expect(dumped.geometry).toBe(undefined);
            expect(dumped.mapped).toBe(false);
        });
    });
};
