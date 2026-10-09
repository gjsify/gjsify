// The browser half of `GtkSource.View`: a `<textarea>` that owns the caret, selection, input,
// IME and undo, with the highlight painted on a backdrop behind its transparent text and the
// line numbers in a gutter beside it. The structure mirrors the Android driver
// (`packages/nativescript-bridge/gtksource/src/native-editor.android.ts`): the platform edits
// text natively, and this class reports what the user did to an `EditorHost`.
//
// NO WORD WRAP, as on Android: `wrap="off"` and `white-space: pre` keep every logical line on
// one layout line, so the backdrop and the gutter stay aligned by a fixed line height.

import type {
    EditorDriver,
    EditorHost,
    EditorLayout,
    EditorPalette,
    GutterCell,
    GutterColumn,
    StyledRun,
} from '@gjsify/gtksource-core';
import { digitCount, LineStore } from '@gjsify/gtksource-core';

const GUTTER_PADDING_PX = 8;

/** A signed ARGB int (the core's colour unit) as a CSS colour. */
function cssColor(argb: number): string {
    const alpha = ((argb >>> 24) & 0xff) / 255;
    return `rgba(${(argb >>> 16) & 0xff}, ${(argb >>> 8) & 0xff}, ${argb & 0xff}, ${alpha})`;
}

export interface EditorParts {
    readonly root: HTMLElement;
    readonly area: HTMLTextAreaElement;
    readonly backdrop: HTMLElement;
    readonly gutter: HTMLElement;
}

export class WebEditorDriver implements EditorDriver {
    private host: EditorHost | null = null;
    private text = '';
    private caret = 0;
    private reported = { start: 0, end: 0 };
    private layout: EditorLayout | null = null;
    private readonly runs = new LineStore<readonly StyledRun[]>();
    private scheduled: 'none' | 'gutter' | 'all' = 'none';
    private numbers: HTMLElement | null = null;
    private listening: Array<() => void> = [];
    private palette: EditorPalette | null = null;
    private attached = false;

    constructor(private readonly parts: EditorParts) {}

    bind(host: EditorHost): void {
        this.host = host;
    }

    /** Starts listening to the textarea; the counterpart of the Android `attach()`. */
    attach(): void {
        if (this.listening.length > 0) return;
        this.attached = true;
        const { area, backdrop, gutter } = this.parts;
        const on = <T extends EventTarget>(target: T, type: string, listener: EventListener) => {
            target.addEventListener(type, listener);
            this.listening.push(() => target.removeEventListener(type, listener));
        };
        on(area, 'input', () => this.onInput());
        on(area, 'scroll', () => {
            backdrop.scrollTop = area.scrollTop;
            backdrop.scrollLeft = area.scrollLeft;
            (gutter.firstElementChild as HTMLElement | null)?.style.setProperty(
                'transform',
                `translateY(${-area.scrollTop}px)`,
            );
            // Only the lines in view are asked; a scroll brings new ones.
            if (this.hasColumns) this.scheduleRender('gutter');
        });
        on(area, 'select', () => this.onSelection());
        on(area, 'keyup', () => this.onSelection());
        on(area, 'mouseup', () => this.onSelection());
        on(area, 'keydown', (event) => this.onKey(event as KeyboardEvent));
        // Firefox and Chromium fire `selectionchange` on different targets for a textarea.
        on(area.ownerDocument, 'selectionchange', () => {
            if (area.ownerDocument.activeElement === area) this.onSelection();
        });
        if (this.layout) this.applyLayout(this.layout);
        if (this.palette) this.applyPalette(this.palette);
        this.scheduleRender();
    }

    detach(): void {
        this.attached = false;
        for (const stop of this.listening.splice(0)) stop();
    }

    // --- what the user did -------------------------------------------------------------------

    private onInput(): void {
        const next = this.parts.area.value;
        const prev = this.text;
        let prefix = 0;
        const shortest = Math.min(prev.length, next.length);
        while (prefix < shortest && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
        let suffix = 0;
        while (
            suffix < shortest - prefix &&
            prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
        ) {
            suffix++;
        }
        this.text = next;
        this.host?.onNativeEdit(prefix, prev.length - prefix - suffix, next.slice(prefix, next.length - suffix));
        this.onSelection();
        this.scheduleRender();
    }

    private onSelection(): void {
        const { area } = this.parts;
        const start = area.selectionStart ?? 0;
        const end = area.selectionEnd ?? start;
        if (start === this.reported.start && end === this.reported.end) return;
        this.reported = { start, end };
        this.caret = end;
        this.host?.onNativeSelection(start, end);
        this.scheduleRender();
    }

    /** `accepts-tab` is GTK's default; a textarea would move focus, so Tab inserts a tab. */
    private onKey(event: KeyboardEvent): void {
        if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
        if (this.parts.area.readOnly) return;
        event.preventDefault();
        // `insertText` keeps the edit on the browser's own undo stack and fires `input`.
        if (!this.parts.area.ownerDocument.execCommand('insertText', false, '\t')) {
            const { area } = this.parts;
            area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end');
            this.onInput();
        }
    }

    // --- what to show ------------------------------------------------------------------------

    setText(text: string): void {
        this.text = text;
        this.parts.area.value = text;
        this.runs.clear();
        this.scheduleRender();
    }

    replaceRange(start: number, end: number, text: string): void {
        const { area } = this.parts;
        this.text = this.text.slice(0, start) + text + this.text.slice(end);
        // 'preserve' leaves the selection to the session, which sets it explicitly afterwards.
        area.setRangeText(text, start, end, 'preserve');
        this.scheduleRender();
    }

    setSelection(start: number, end: number): void {
        this.reported = { start, end };
        this.caret = end;
        this.parts.area.setSelectionRange(start, end);
        this.scheduleRender();
    }

    setLineCount(): void {
        this.scheduleRender();
    }

    setLayout(layout: EditorLayout): void {
        this.layout = layout;
        if (this.attached) this.applyLayout(layout);
    }

    /** Attributes and styles on the host wait for `attach()`: a custom element's constructor may not write them. */
    private applyLayout(layout: EditorLayout): void {
        const { root, area } = this.parts;
        area.readOnly = !layout.editable;
        root.classList.toggle('monospace', layout.monospace);
        root.classList.toggle('show-line-numbers', layout.showLineNumbers);
        root.classList.toggle('cursor-hidden', !layout.cursorVisible);
        root.style.setProperty('--gsv-margin-left', `${layout.leftMargin}px`);
        root.style.setProperty('--gsv-margin-right', `${layout.rightMargin}px`);
        root.style.setProperty('--gsv-margin-top', `${layout.topMargin}px`);
        root.style.setProperty('--gsv-margin-bottom', `${layout.bottomMargin}px`);
        this.scheduleRender();
    }

    setPalette(palette: EditorPalette): void {
        this.palette = palette;
        if (this.attached) this.applyPalette(palette);
    }

    private applyPalette(palette: EditorPalette): void {
        const { style } = this.parts.root;
        style.setProperty('--gsv-fg', cssColor(palette.foreground));
        style.setProperty('--gsv-bg', cssColor(palette.background));
        style.setProperty('--gsv-selection', cssColor(palette.selectionBackground));
        style.setProperty('--gsv-current-line', cssColor(palette.currentLineBackground));
        style.setProperty('--gsv-number-fg', cssColor(palette.lineNumberForeground));
        style.setProperty('--gsv-number-bg', cssColor(palette.lineNumberBackground));
        style.setProperty('--gsv-current-number-fg', cssColor(palette.currentLineNumberForeground));
        style.setProperty('--gsv-current-number-bg', cssColor(palette.currentLineNumberBackground));
    }

    invalidateGutter(): void {
        this.scheduleRender('gutter');
    }

    spliceLines(first: number, removed: number, inserted: number): void {
        this.runs.splice(first, removed, inserted);
    }

    paintLine(line: number, _lineStart: number, runs: readonly StyledRun[]): void {
        this.runs.set(line, runs);
        this.scheduleRender();
    }

    clearAll(): void {
        this.runs.clear();
        this.scheduleRender();
    }

    // --- painting ----------------------------------------------------------------------------

    /** One repaint per task: a burst of `paintLine` calls from one edit costs one DOM rebuild. */
    private scheduleRender(only: 'gutter' | 'all' = 'all'): void {
        if (!this.attached) return;
        const pending = this.scheduled;
        this.scheduled = only === 'all' || pending === 'all' ? 'all' : 'gutter';
        if (pending !== 'none') return;
        queueMicrotask(() => {
            const level = this.scheduled;
            this.scheduled = 'none';
            if (level === 'all') this.render();
            else if (level === 'gutter') this.renderGutter();
        });
    }

    private hasColumns = false;

    private render(): void {
        const { backdrop } = this.parts;
        const lines = this.text.split('\n');
        const highlight = this.layout?.highlightCurrentLine === true;
        const caretLine = this.text.slice(0, this.caret).split('\n').length - 1;

        const rows: HTMLElement[] = [];
        const numbers: HTMLElement[] = [];
        lines.forEach((line, index) => {
            const row = document.createElement('div');
            row.className = highlight && index === caretLine ? 'gsv-line current' : 'gsv-line';
            let at = 0;
            for (const run of this.runs.get(index) ?? []) {
                if (run.start > at) row.append(line.slice(at, run.start));
                const span = document.createElement('span');
                span.textContent = line.slice(run.start, run.end);
                const { style } = run;
                if (style.foreground !== undefined) span.style.color = cssColor(style.foreground);
                if (style.background !== undefined) span.style.backgroundColor = cssColor(style.background);
                if (style.bold) span.style.fontWeight = 'bold';
                if (style.italic) span.style.fontStyle = 'italic';
                const decorations = [style.underline ? 'underline' : '', style.strikethrough ? 'line-through' : ''];
                span.style.textDecoration = decorations.filter(Boolean).join(' ');
                row.append(span);
                at = run.end;
            }
            if (at < line.length) row.append(line.slice(at));
            rows.push(row);

            const number = document.createElement('div');
            number.className = highlight && index === caretLine ? 'gsv-number current' : 'gsv-number';
            number.textContent = String(index + 1);
            numbers.push(number);
        });
        backdrop.replaceChildren(...rows);
        const column = document.createElement('div');
        column.className = 'gsv-numbers';
        column.append(...numbers);
        this.numbers = column;
        const { root } = this.parts;
        root.style.setProperty('--gsv-gutter-width', `${digitCount(lines.length) + 0}ch`);
        root.style.setProperty('--gsv-gutter-padding', `${GUTTER_PADDING_PX}px`);
        this.renderGutter();
    }

    /** The lines in view, or all of them where nothing is laid out (a detached element, a test DOM). */
    private visibleLines(count: number): [number, number] {
        const { area, backdrop } = this.parts;
        const row = backdrop.firstElementChild;
        const height = row === null ? 0 : row.getBoundingClientRect().height;
        if (height <= 0 || area.clientHeight <= 0) return [0, count - 1];
        const top = Math.max(0, area.scrollTop - (this.layout?.topMargin ?? 0));
        const first = Math.min(count - 1, Math.floor(top / height));
        const last = Math.min(count - 1, Math.max(first, Math.ceil((top + area.clientHeight) / height) - 1));
        return [first, last];
    }

    private cellElement(cell: GutterCell): HTMLElement {
        const element = document.createElement('div');
        element.className = 'gsv-cell';
        if (cell.runs === null) {
            element.textContent = cell.text;
            return element;
        }
        for (const run of cell.runs) {
            const span = document.createElement('span');
            span.textContent = run.text;
            if (run.bold) span.style.fontWeight = 'bold';
            if (run.italic) span.style.fontStyle = 'italic';
            const decorations = [run.underline ? 'underline' : '', run.strikethrough ? 'line-through' : ''];
            span.style.textDecoration = decorations.filter(Boolean).join(' ');
            element.append(span);
        }
        return element;
    }

    private columnElement(column: GutterColumn, first: number): HTMLElement {
        const element = document.createElement('div');
        element.className = 'gsv-column';
        element.style.minWidth = `${column.widthRequest}px`;
        element.style.paddingLeft = `${column.marginStart}px`;
        element.style.paddingRight = `${column.marginEnd}px`;
        const spacer = document.createElement('div');
        spacer.style.height = `calc(${first} * 1em * var(--gsv-line-height))`;
        element.append(spacer, ...column.cells.map((cell) => this.cellElement(cell)));
        return element;
    }

    /** The gutter: the renderers left of the line numbers, the numbers, the renderers right of them. */
    private renderGutter(): void {
        const { gutter, root, area } = this.parts;
        const host = this.host;
        const count = this.text.split('\n').length;
        const [first, last] = this.visibleLines(count);
        const columns = host?.queryGutter(first, last) ?? [];
        this.hasColumns = columns.length > 0;
        const showNumbers = this.layout?.showLineNumbers === true;
        root.classList.toggle('has-columns', this.hasColumns);
        const elements: HTMLElement[] = [];
        for (const column of columns.filter((c) => c.position < 0)) elements.push(this.columnElement(column, first));
        if (showNumbers && this.numbers !== null) elements.push(this.numbers);
        for (const column of columns.filter((c) => c.position >= 0)) elements.push(this.columnElement(column, first));
        const wrapper = document.createElement('div');
        wrapper.className = 'gsv-columns';
        wrapper.append(...elements);
        wrapper.style.transform = `translateY(${-area.scrollTop}px)`;
        gutter.replaceChildren(wrapper);
    }
}
