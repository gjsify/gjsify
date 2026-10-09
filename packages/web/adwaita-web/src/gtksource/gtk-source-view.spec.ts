import { describe, expect, it } from '@gjsify/unit';
import {
    GUTTER_PAINT_VECTORS,
    GTKSOURCE_BUFFER_VECTORS,
    GTKSOURCE_VIEW_DEFAULT_VECTORS,
    GTKSOURCE_VIEW_SURFACE_VECTORS,
    type GtkSourceViewSurfaceLike,
    type GtkSourceBufferLike,
    type GutterPaintSurface,
    type ViewLike,
} from '@gjsify/gtksource-core/conformance';

import * as GObject from '../namespace/gobject.js';
import * as Gtk from '../namespace/gtk.js';
import * as GtkSource from '../namespace/gtksource.js';

import './gtk-source-view.js';
import { GtkSourceView } from './gtk-source-view.js';

export const GtkSourceViewTest = async () => {
    await describe('<gtk-source-view>: GtkSource.View', async () => {
        for (const vector of GTKSOURCE_BUFFER_VECTORS) {
            await it(`GtkSource.Buffer: ${vector.rule}`, () => {
                expect(vector.observe(GtkSource as unknown as GtkSourceBufferLike)).toStrictEqual(vector.shows);
            });
        }

        for (const vector of GTKSOURCE_VIEW_DEFAULT_VECTORS) {
            await it(`${vector.property} defaults to ${vector.shows}`, () => {
                const view = new GtkSourceView();
                expect((view as unknown as Record<string, unknown>)[vector.member]).toStrictEqual(vector.shows);
            });
        }

        for (const vector of GTKSOURCE_VIEW_SURFACE_VECTORS) {
            await it(`surface: ${vector.rule}`, () => {
                expect(vector.observe({ Gtk, GtkSource } as unknown as GtkSourceViewSurfaceLike)).toStrictEqual(
                    vector.shows,
                );
            });
        }

        const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
        for (const vector of GUTTER_PAINT_VECTORS) {
            await it(`gutter paint: ${vector.rule}`, async () => {
                const views: HTMLElement[] = [];
                const harness = {
                    async present(view: ViewLike) {
                        document.body.append(view as unknown as HTMLElement);
                        views.push(view as unknown as HTMLElement);
                        await task();
                    },
                    settle: task,
                };
                try {
                    expect(
                        await vector.observe({ Gtk, GtkSource, GObject } as unknown as GutterPaintSurface, harness),
                    ).toStrictEqual(vector.shows);
                } finally {
                    for (const view of views) view.remove();
                }
            });
        }

        await it("paints a renderer's text, in a column left of the line numbers when its position is negative", async () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            view.showLineNumbers = true;
            document.body.append(view);
            view.buffer.text = 'a\nb';
            const renderer = new GtkSource.GutterRendererText({ width_request: 24, margin_start: 2, margin_end: 3 });
            (renderer as unknown as { vfunc_query_data(lines: unknown, line: number): void }).vfunc_query_data =
                function (this: { text: string }, _lines, line) {
                    this.text = `r${line}`;
                };
            view.get_gutter(Gtk.TextWindowType.LEFT)!.insert(renderer, -1);
            await task();
            const columns = view.querySelectorAll<HTMLElement>('.gsv-columns > *');
            expect([...columns].map((column) => column.className)).toStrictEqual(['gsv-column', 'gsv-numbers']);
            const first = columns[0];
            expect([...first.querySelectorAll('.gsv-cell')].map((cell) => cell.textContent)).toStrictEqual([
                'r0',
                'r1',
            ]);
            expect([first.style.minWidth, first.style.paddingLeft, first.style.paddingRight]).toStrictEqual([
                '24px',
                '2px',
                '3px',
            ]);
            expect(view.classList.contains('has-columns')).toBe(true);
            view.remove();
        });

        await it('paints markup as styled spans and drops the column with its renderer', async () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            document.body.append(view);
            view.buffer.text = 'a';
            const renderer = new GtkSource.GutterRendererText({ width_request: 10 });
            (renderer as unknown as { vfunc_query_data(lines: unknown, line: number): void }).vfunc_query_data =
                function (this: { markup: string }) {
                    this.markup = '<b>x</b> &amp; y';
                };
            const gutter = view.get_gutter(Gtk.TextWindowType.LEFT)!;
            gutter.insert(renderer, 0);
            await task();
            const cell = view.querySelector<HTMLElement>('.gsv-cell')!;
            expect(cell.textContent).toBe('x & y');
            expect(cell.querySelector<HTMLElement>('span')!.style.fontWeight).toBe('bold');
            gutter.remove(renderer);
            await task();
            expect(view.querySelector('.gsv-column')).toBe(null);
            expect(view.classList.contains('has-columns')).toBe(false);
            view.remove();
        });

        await it('writes through attributes with GTK semantics', () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            view.setAttribute('show-line-numbers', 'true');
            view.setAttribute('indent-width', '4');
            view.setAttribute('left-margin', '12');
            expect(view.showLineNumbers).toBe(true);
            expect(view.indentWidth).toBe(4);
            expect(view.leftMargin).toBe(12);
        });

        await it('refuses a value that is not a boolean, by name', () => {
            const view = new GtkSourceView();
            expect(() => (view.editable = 'maybe')).toThrow(/GtkSource.View.editable/);
        });

        await it('shows the buffer text in the textarea and takes a user edit back into the buffer', () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            document.body.append(view);
            view.buffer.text = 'LDA #$01';
            expect(view.textarea.value).toBe('LDA #$01');
            view.textarea.value = 'LDA #$02';
            view.textarea.dispatchEvent(new Event('input'));
            expect(view.buffer.text).toBe('LDA #$02');
            view.remove();
        });
    });
};
