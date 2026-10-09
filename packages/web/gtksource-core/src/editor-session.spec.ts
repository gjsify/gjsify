import { describe, expect, it } from '@gjsify/unit';
import { sixAssemblerLang } from './fixtures.js';

import type { EditorDriver, EditorHost, EditorLayout } from './editor-driver.js';
import { EditorSession } from './editor-session.js';
import { LanguageManager } from './language-manager.js';
import { StyleSchemeManager } from './style-scheme.js';
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
};
