// @gjsify/devtools — widget-path parse/build tests (pure logic).

import { describe, expect, it } from '@gjsify/unit';
import type Gtk from 'gi://Gtk?version=4.0';
import {
    activateWidget,
    buildWidgetPath,
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
};
