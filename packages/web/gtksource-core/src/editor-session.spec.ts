import { unprovenVfuncs } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';
import { sixAssemblerLang } from './fixtures.js';
import { GUTTER_PAINT_VECTORS } from './gutter-paint-vectors.js';

import type { EditorDriver, EditorHost, EditorLayout } from './editor-driver.js';
import { EditorSession } from './editor-session.js';
import { GutterRendererText, GutterSet, WINDOW_LEFT } from './gutter-renderer.js';
import type { GutterLines } from './gutter-renderer.js';
import { LanguageManager } from './language-manager.js';
import { STOP_EMISSION } from '@gjsify/adwaita-core';
import { StyleSchemeManager } from './style-scheme.js';
import type { TextIter } from './text-iter.js';
import type { EditorPalette } from './style-scheme.js';
import type { StyledRun } from './token-styler.js';

/** A text widget in memory: what the Android driver mirrors, minus the pixels. */
class FakeDriver implements EditorDriver {
    host!: EditorHost;
    text = '';
    selection = [0, 0];
    lineCount = 0;
    layout: EditorLayout | null = null;
    palette: EditorPalette | null = null;
    painted = new Map<number, readonly StyledRun[]>();
    paintCalls: number[] = [];
    invalidations = 0;
    invalidateGutter(): void {
        this.invalidations++;
    }
    bind(host: EditorHost): void {
        this.host = host;
    }
    setText(text: string): void {
        this.text = text;
        this.painted.clear();
    }
    replaceRange(start: number, end: number, text: string): void {
        this.text = this.text.slice(0, start) + text + this.text.slice(end);
    }
    setSelection(start: number, end: number): void {
        this.selection = [start, end];
    }
    setLineCount(count: number): void {
        this.lineCount = count;
    }
    setLayout(layout: EditorLayout): void {
        this.layout = layout;
    }
    spliceLines(first: number, removed: number, inserted: number): void {
        const next = new Map<number, readonly StyledRun[]>();
        for (const [line, runs] of this.painted) {
            if (line < first) next.set(line, runs);
            else if (line >= first + removed) next.set(line - removed + inserted, runs);
        }
        this.painted = next;
    }
    paintLine(line: number, _start: number, runs: readonly StyledRun[]): void {
        this.painted.set(line, runs);
        this.paintCalls.push(line);
    }
    clearAll(): void {
        this.painted.clear();
    }
    setPalette(palette: EditorPalette): void {
        this.palette = palette;
    }
}

const make = () => {
    const driver = new FakeDriver();
    const session = new EditorSession(driver, new StyleSchemeManager());
    return { driver, session };
};

export default async () => {
    await describe('gtksource-core: EditorSession', async () => {
        await it('mirrors programmatic buffer edits into the widget', () => {
            const { driver, session } = make();
            session.buffer.text = 'lda #$01\nsta $0200';
            expect(driver.text).toBe('lda #$01\nsta $0200');
            expect(driver.lineCount).toBe(2);
            session.buffer.insert(0, ';');
            expect(driver.text).toBe(';lda #$01\nsta $0200');
        });

        await it('applies a user edit to the buffer without echoing it back', () => {
            const { driver, session } = make();
            driver.text = 'ab';
            session.buffer.text = 'ab';
            driver.text = 'aXb';
            driver.host.onNativeEdit(1, 0, 'X');
            expect(session.buffer.text).toBe('aXb');
            expect(driver.text).toBe('aXb');
        });

        await it('carries the indentation onto the next line with auto-indent', () => {
            const { driver, session } = make();
            session.autoIndent = true;
            session.buffer.text = '    foo';
            driver.text = '    foo\n';
            driver.host.onNativeEdit(7, 0, '\n');
            expect(session.buffer.text).toBe('    foo\n    ');
            expect(driver.text).toBe('    foo\n    ');
        });

        await it('highlights incrementally and re-tints on a colour-scheme change', () => {
            const { driver, session } = make();
            session.buffer.language = new LanguageManager().addLanguageFromXml(sixAssemblerLang);
            session.buffer.text = 'lda #$01\nsta $0200';
            expect((driver.painted.get(0) ?? []).length > 0).toBe(true);
            driver.paintCalls = [];
            session.buffer.insert(0, ' ');
            expect(driver.paintCalls).toStrictEqual([0]);
            expect(driver.palette?.dark).toBe(false);
            session.setColorScheme('dark');
            expect(driver.palette?.dark).toBe(true);
        });

        await it('pushes view properties to the driver', () => {
            const { driver, session } = make();
            session.showLineNumbers = true;
            session.leftMargin = 12;
            session.monospace = true;
            expect(driver.layout?.showLineNumbers).toBe(true);
            expect(driver.layout?.leftMargin).toBe(12);
            expect(driver.layout?.monospace).toBe(true);
        });
    });

    await describe('gtksource-core: EditorSession gutter columns', async () => {
        const withGutter = () => {
            const { driver, session } = make();
            const owner = {};
            const gutters = new GutterSet(owner);
            session.bindGutters(gutters);
            session.buffer.text = 'a\nb\nc\nd';
            return { driver, session, left: gutters.get(WINDOW_LEFT)!, owner };
        };

        await it('asks vfunc_query_data once per line, in order, with the range and the cursor line', () => {
            const { session, left, owner } = withGutter();
            const seen: [number, number, number, boolean, unknown][] = [];
            class Numbers extends GutterRendererText {
                vfunc_query_data(lines: GutterLines, line: number): void {
                    seen.push([line, lines.get_first(), lines.get_last(), lines.is_cursor(line), lines.get_view()]);
                    this.text = `#${line}`;
                }
            }
            left.insert(new Numbers(), 0);
            session.buffer.placeCursor(session.buffer.getLine(0).length + 1);
            const columns = session.queryGutter(1, 3);
            expect(seen.map((entry) => entry[0])).toStrictEqual([1, 2, 3]);
            expect(seen.map((entry) => entry[2])).toStrictEqual([3, 3, 3]);
            expect(seen.map((entry) => entry[3])).toStrictEqual([true, false, false]);
            expect(seen[0][4]).toBe(owner);
            expect(columns[0].cells.map((cell) => cell.text)).toStrictEqual(['#1', '#2', '#3']);
        });

        await it('reads markup into styled runs and lets it replace text', () => {
            const { session, left } = withGutter();
            const renderer = new GutterRendererText({ text: 'plain' });
            left.insert(renderer, 0);
            renderer.markup = '<b>x</b> &amp; <i>y</i>';
            const [cell] = session.queryGutter(0, 0)[0].cells;
            expect(cell.text).toBe('x & y');
            expect(cell.runs?.map((run) => [run.text, run.bold, run.italic])).toStrictEqual([
                ['x', true, false],
                [' & ', false, false],
                ['y', false, true],
            ]);
        });

        await it('reports the metrics and the insert position, left to right', () => {
            const { session, left } = withGutter();
            left.insert(new GutterRendererText({ width_request: 30, margin_start: 2 }), 5);
            left.insert(new GutterRendererText({ margin_end: 4 }), -1);
            expect(
                session.gutterColumns().map((c) => [c.position, c.widthRequest, c.marginStart, c.marginEnd]),
            ).toStrictEqual([
                [-1, -1, 0, 4],
                [5, 30, 2, 0],
            ]);
        });

        await it('tells the driver when a column is added, resized, redrawn or removed', () => {
            const { driver, left } = withGutter();
            const renderer = new GutterRendererText();
            left.insert(renderer, 0);
            expect(driver.invalidations).toBe(1);
            renderer.width_request = 40;
            renderer.width_request = 40;
            renderer.queue_draw();
            left.queue_draw();
            expect(driver.invalidations).toBe(4);
            left.remove(renderer);
            expect(driver.invalidations).toBe(5);
        });

        await it('lets the platform select a word unless a handler stopped extend-selection', () => {
            const { session } = make();
            session.buffer.text = 'hello world';
            expect(session.onNativeExtendSelection(0, 2)).toBe(null);
            session.connect('extend-selection', ((self: unknown) =>
                (self as EditorSession)[STOP_EMISSION]('extend-selection')) as never);
            expect(session.onNativeExtendSelection(0, 2)).toStrictEqual([2, 2]);
        });

        await it('takes the range an extend-selection handler answers', () => {
            const { session } = make();
            session.buffer.text = 'hello world';
            session.connect('extend-selection', ((
                _self: unknown,
                _g: number,
                _at: unknown,
                start: TextIter,
                end: TextIter,
            ) => {
                start.set_offset(0);
                end.set_offset(5);
                return true;
            }) as never);
            expect(session.onNativeExtendSelection(0, 7)).toStrictEqual([0, 5]);
        });

        await it('lets the platform copy unless a handler stopped copy-clipboard', () => {
            const { session } = make();
            expect(session.onNativeCopy()).toBe(true);
            session.connect('copy-clipboard', ((self: unknown) =>
                (self as EditorSession)[STOP_EMISSION]('copy-clipboard')) as never);
            expect(session.onNativeCopy()).toBe(false);
        });

        await it('selects back what a mark-set handler moved away from the native selection', () => {
            const { driver, session } = make();
            session.buffer.text = 'hello world';
            session.buffer.connect('mark-set', ((
                _b: unknown,
                location: TextIter,
                mark: Parameters<typeof session.buffer.move_mark>[0],
            ) => {
                if (location.get_offset() === 5) {
                    location.set_offset(0);
                    session.buffer.move_mark(mark, location);
                }
            }) as never);
            session.onNativeSelection(5, 5);
            expect(driver.selection).toStrictEqual([0, 0]);
        });

        await it('has a paint vector for every GtkSource entry of UNLOCKED_VFUNCS', () => {
            expect(unprovenVfuncs(GUTTER_PAINT_VECTORS, 'GtkSource.').join()).toBe('');
            expect(unprovenVfuncs([], 'GtkSource.').length > 0).toBe(true);
        });

        await it('answers no columns when the gutter holds none', () => {
            const { session } = withGutter();
            expect(session.queryGutter(0, 3).length).toBe(0);
        });
    });
};
