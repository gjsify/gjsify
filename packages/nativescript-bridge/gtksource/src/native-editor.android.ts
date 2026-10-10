// The Android half of `GtkSource.View`: an `EditText` whose Editable carries the highlight as
// spans, set in place — never `setText` per edit — and whose `onDraw` paints the line-number
// gutter and the current-line band from the text `Layout`.
//
// NO WORD WRAP. `setHorizontallyScrolling(true)` keeps every logical line on one layout line, so
// the gutter is one label per layout line and `Layout.getLineForOffset` IS the buffer line.
//
// SPANS ARE EXCLUSIVE_EXCLUSIVE so typing at a token's edge does not stretch it; the platform
// moves them through edits, which is why a repaint only touches the lines the highlighter
// reports. The Editable is never edited from inside `onTextChanged`: edits are queued there and
// handed to the host from `afterTextChanged`, where the host may edit again (auto-indent).
//
// `extend-selection` and `copy-clipboard` are device-verified (API 24, 36), the rest is not — see the package README.

import type {
    AndroidCanvas,
    AndroidEditable,
    AndroidEditText,
    AndroidMotionEvent,
    AndroidNamespace,
    AndroidPaint,
} from './android-types.js';
import type { EditorHost, EditorLayout } from '@gjsify/gtksource-core';
import { emphasisedLine, gutterWidth, visibleLines } from '@gjsify/gtksource-core';
import { LineStore } from '@gjsify/gtksource-core';
import { MultiTap } from './multi-tap.js';

// `android.R.id.copy`: the NativeScript runtime exposes no `android.R`, reading it throws.
const ID_COPY = 0x01020021;
import type { NativeEditorDriver } from './native-editor.js';
import type { EditorPalette, GutterMetrics } from '@gjsify/gtksource-core';
import type { StyledRun } from '@gjsify/gtksource-core';

declare const android: AndroidNamespace;
declare const java: {
    lang: { Runnable: new (implementation: { run(): void }) => unknown };
};

const GUTTER_PADDING_DP = 8;
const ANTI_ALIAS_FLAG = 1;
// `Gtk.TextExtendSelection`
const WORD = 0;
const LINE = 1;

interface QueuedEdit {
    readonly start: number;
    readonly removed: number;
    readonly inserted: string;
}

interface DrawingDriver {
    drawBehind(view: AndroidEditText, canvas: AndroidCanvas): void;
    drawGutter(view: AndroidEditText, canvas: AndroidCanvas): void;
    selectionChanged(start: number, end: number): void;
    /** The Copy action ran with `defaultCopy` as the platform's own: false when it must not (a handler stopped it). */
    copyRequested(defaultCopy: () => boolean): boolean;
    /** A touch is about to reach the view: true when `extend-selection` answered it, so the platform must not see it. */
    touching(view: AndroidEditText, event: AndroidMotionEvent): boolean;
    /** The platform is about to select the word under a long press: true when `extend-selection` answered it instead. */
    longPressing(view: AndroidEditText): boolean;
}

/** `this` inside an `.extend()` implementation: the Java instance plus the runtime's `super` proxy. */
type ExtendedEditText = AndroidEditText & {
    super: {
        onDraw(canvas: AndroidCanvas): void;
        onSelectionChanged(start: number, end: number): void;
        onTextContextMenuItem(id: number): boolean;
        onTouchEvent(event: AndroidMotionEvent): boolean;
        performLongClick(): boolean;
    };
};

let editTextClass: (new (context: unknown) => AndroidEditText) | undefined;

/** Built on first use: `.extend()` needs the runtime, which does not exist when this module is merely imported. */
function gutterEditText(): new (context: unknown) => AndroidEditText {
    if (editTextClass) return editTextClass;
    const base = android.widget.EditText as unknown as {
        extend(implementation: object): typeof editTextClass;
    };
    editTextClass = base.extend({
        onDraw(this: ExtendedEditText, canvas: AndroidCanvas) {
            const driver = this.driver as DrawingDriver | undefined;
            driver?.drawBehind(this, canvas);
            this.super.onDraw(canvas);
            driver?.drawGutter(this, canvas);
        },
        onSelectionChanged(this: ExtendedEditText, start: number, end: number) {
            this.super.onSelectionChanged(start, end);
            (this.driver as DrawingDriver | undefined)?.selectionChanged(start, end);
        },
        onTouchEvent(this: ExtendedEditText, event: AndroidMotionEvent): boolean {
            const driver = this.driver as DrawingDriver | undefined;
            return driver?.touching(this, event) ? true : this.super.onTouchEvent(event);
        },
        performLongClick(this: ExtendedEditText): boolean {
            const driver = this.driver as DrawingDriver | undefined;
            return driver?.longPressing(this) ? true : this.super.performLongClick();
        },
        // The toolbar's and the keyboard's Copy both arrive here. Device-verified on API 24 and 36 (ADR 0094).
        onTextContextMenuItem(this: ExtendedEditText, id: number): boolean {
            const driver = this.driver as DrawingDriver | undefined;
            if (id !== ID_COPY || !driver) return this.super.onTextContextMenuItem(id);
            return driver.copyRequested(() => this.super.onTextContextMenuItem(id));
        },
    })!;
    return editTextClass;
}

class AndroidEditorDriver implements NativeEditorDriver, DrawingDriver {
    private host: EditorHost | null = null;
    private view: AndroidEditText | null = null;
    private applying = false;
    private queue: QueuedEdit[] = [];
    private keyListener: unknown = null;

    /** Held while no native view exists, applied by `attach()`. */
    private pendingText: string | null = '';
    private selection = { start: 0, end: 0 };
    private lineCount = 1;
    private layout: EditorLayout | null = null;
    private palette: EditorPalette | null = null;

    private readonly runs = new LineStore<readonly StyledRun[]>();
    private readonly spans = new LineStore<unknown[]>();
    private fillPaint: AndroidPaint | null = null;
    private textPaint: AndroidPaint | null = null;
    /** The widest text each left-gutter column drew, by column; a column is as wide as it needs. */
    private measured: number[] = [];
    private appliedGutter = -1;

    bind(host: EditorHost): void {
        this.host = host;
    }

    private platformCopy: (() => boolean) | null = null;

    // `copy-clipboard` first, with the platform's copy as the emission's class handler (`copySelection`),
    // so a `connect_after` handler that writes its own text lands after it. The action is consumed either way.
    copyRequested(defaultCopy: () => boolean): boolean {
        this.platformCopy = defaultCopy;
        try {
            this.host?.onNativeCopy();
        } finally {
            this.platformCopy = null;
        }
        return true;
    }

    // Android collapses the selection on Copy, GTK keeps it: restore it, so a `connect_after` handler still reads it.
    copySelection(): void {
        const copy = this.platformCopy;
        this.platformCopy = null;
        const view = this.view;
        if (!copy || !view) return;
        const { start, end } = this.selection;
        copy();
        if (view.getSelectionStart() !== start || view.getSelectionEnd() !== end) view.setSelection(start, end);
    }

    private taps: MultiTap | null = null;
    /** Where the last press landed, for a long press that follows it. */
    private pressAt = { x: 0, y: 0 };
    /** A press whose gesture `extend-selection` answered: the rest of it never reaches the platform. */
    private swallowing = false;

    // GTK asks `extend-selection` on the second and third press, before it selects the word or line, so the
    // second and third press are asked here, before the platform selects: a range answered replaces the
    // platform's selection, and a null leaves the press to it. A triple has no platform selection below API 28.
    touching(view: AndroidEditText, event: AndroidMotionEvent): boolean {
        const { ACTION_DOWN, ACTION_UP, ACTION_CANCEL } = android.view.MotionEvent;
        const action = event.getActionMasked();
        if (action !== ACTION_DOWN) {
            const swallowed = this.swallowing;
            if (action === ACTION_UP || action === ACTION_CANCEL) this.swallowing = false;
            return swallowed;
        }
        this.swallowing = false;
        this.pressAt = { x: event.getX(), y: event.getY() };
        this.taps ??= new MultiTap(
            android.view.ViewConfiguration.getDoubleTapTimeout(),
            android.view.ViewConfiguration.get(view.getContext()).getScaledDoubleTapSlop(),
        );
        const count = this.taps.press(event.getEventTime(), event.getX(), event.getY());
        if (count < 2) return false;
        this.swallowing = this.extendSelection(view, count === 2 ? WORD : LINE);
        return this.swallowing;
    }

    longPressing(view: AndroidEditText): boolean {
        return this.extendSelection(view, WORD);
    }

    private extendSelection(view: AndroidEditText, granularity: number): boolean {
        const host = this.host;
        if (!host || this.applying) return false;
        const range = host.onNativeExtendSelection(
            granularity,
            view.getOffsetForPosition(this.pressAt.x, this.pressAt.y),
        );
        if (!range) return false;
        view.setSelection(range[0], range[1]);
        return true;
    }

    createNativeView(context: unknown): object {
        const view = new (gutterEditText())(context);
        view.driver = this;
        return view;
    }

    attach(nativeView: unknown): void {
        const view = nativeView as AndroidEditText;
        this.view = view;
        view.setInputType(
            android.text.InputType.TYPE_CLASS_TEXT |
                android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE |
                android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS,
        );
        view.setHorizontallyScrolling(true);
        view.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        this.keyListener = view.getKeyListener();
        view.addTextChangedListener(
            new android.text.TextWatcher({
                beforeTextChanged: () => {},
                onTextChanged: (text: AndroidEditable, start: number, before: number, count: number) => {
                    if (this.applying) return;
                    this.queue.push({
                        start,
                        removed: before,
                        inserted: text.subSequence(start, start + count).toString(),
                    });
                },
                afterTextChanged: () => this.flushEdits(),
            }),
        );
        this.applyLayout();
        this.applyPalette();
        this.applying = true;
        try {
            view.setText(this.pendingText ?? '');
        } finally {
            this.applying = false;
        }
        this.pendingText = null;
        this.repaintAll();
        this.applySelection();
    }

    detach(): void {
        // The text outlives the native view: a re-attach (list recycling, rotation) starts from it.
        if (this.view) this.pendingText = this.view.getText().toString();
        this.view = null;
        this.spans.clear();
        this.queue = [];
    }

    setText(text: string): void {
        this.removeAllSpans();
        this.runs.clear();
        if (!this.view) {
            this.pendingText = text;
            return;
        }
        this.applying = true;
        try {
            this.view.setText(text);
        } finally {
            this.applying = false;
        }
    }

    replaceRange(start: number, end: number, text: string): void {
        const view = this.view;
        if (!view) {
            const before = this.pendingText ?? '';
            this.pendingText = before.slice(0, start) + text + before.slice(end);
            return;
        }
        const editable = view.getText();
        this.applying = true;
        try {
            editable.replace(start, Math.min(end, editable.length()), text);
        } finally {
            this.applying = false;
        }
    }

    setSelection(start: number, end: number): void {
        this.selection = { start, end };
        this.applySelection();
    }

    setLineCount(count: number): void {
        this.lineCount = count;
        if (this.view && this.layout?.showLineNumbers) this.applyLayout();
    }

    setLayout(layout: EditorLayout): void {
        this.layout = layout;
        this.applyLayout();
    }

    setPalette(palette: EditorPalette): void {
        this.palette = palette;
        this.applyPalette();
    }

    // --- spans -----------------------------------------------------------------------------------

    spliceLines(first: number, removed: number, inserted: number): void {
        const editable = this.view?.getText();
        for (const spans of this.spans.splice(first, removed, inserted)) {
            if (editable) for (const span of spans) editable.removeSpan(span);
        }
        this.runs.splice(first, removed, inserted);
    }

    paintLine(line: number, lineStart: number, runs: readonly StyledRun[]): void {
        this.runs.set(line, runs);
        const editable = this.view?.getText();
        if (editable) this.applyRuns(editable, line, lineStart, runs);
    }

    clearAll(): void {
        this.removeAllSpans();
        this.runs.clear();
    }

    private removeAllSpans(): void {
        const editable = this.view?.getText();
        const dropped = this.spans.clear();
        if (editable) for (const spans of dropped) for (const span of spans) editable.removeSpan(span);
    }

    private repaintAll(): void {
        const editable = this.view?.getText();
        if (!editable) return;
        const lines = editable.toString().split('\n');
        let lineStart = 0;
        lines.forEach((line, index) => {
            const runs = this.runs.get(index);
            if (runs) this.applyRuns(editable, index, lineStart, runs);
            lineStart += line.length + 1;
        });
    }

    private applyRuns(editable: AndroidEditable, line: number, lineStart: number, runs: readonly StyledRun[]): void {
        for (const old of this.spans.get(line) ?? []) editable.removeSpan(old);
        const length = editable.length();
        const flags = android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE;
        const { ForegroundColorSpan, BackgroundColorSpan, StyleSpan, UnderlineSpan, StrikethroughSpan } =
            android.text.style;
        const Typeface = android.graphics.Typeface;
        const created: unknown[] = [];
        const put = (span: unknown, start: number, end: number): void => {
            editable.setSpan(span, start, end, flags);
            created.push(span);
        };
        for (const run of runs) {
            const start = lineStart + run.start;
            const end = Math.min(lineStart + run.end, length);
            if (start >= end) continue;
            const { style } = run;
            if (style.foreground !== undefined) put(new ForegroundColorSpan(style.foreground), start, end);
            if (style.background !== undefined) put(new BackgroundColorSpan(style.background), start, end);
            if (style.bold || style.italic) {
                const code =
                    style.bold && style.italic ? Typeface.BOLD_ITALIC : style.bold ? Typeface.BOLD : Typeface.ITALIC;
                put(new StyleSpan(code), start, end);
            }
            if (style.underline) put(new UnderlineSpan(), start, end);
            if (style.strikethrough) put(new StrikethroughSpan(), start, end);
        }
        this.spans.set(line, created);
    }

    // --- widget state ----------------------------------------------------------------------------

    private density(view: AndroidEditText): number {
        return view.getResources().getDisplayMetrics().density;
    }

    private columnPixels(column: GutterMetrics, measured: number, density: number): number {
        return Math.ceil(
            Math.max(column.widthRequest * density, measured) + (column.marginStart + column.marginEnd) * density,
        );
    }

    private numbersPixels(view: AndroidEditText, lineCount: number): number {
        if (!this.layout?.showLineNumbers) return 0;
        const padding = GUTTER_PADDING_DP * this.density(view);
        return gutterWidth(lineCount, this.paintFor(view).measureText('0'), padding);
    }

    /** The whole left gutter: the line numbers and every renderer's column, as last measured. */
    private gutterPixels(view: AndroidEditText, lineCount = this.lineCount): number {
        const density = this.density(view);
        let total = this.numbersPixels(view, lineCount);
        (this.host?.gutterColumns() ?? []).forEach((column, at) => {
            total += this.columnPixels(column, this.measured[at] ?? 0, density);
        });
        return total;
    }

    private paintFor(view: AndroidEditText): AndroidPaint {
        this.textPaint ??= new android.graphics.Paint(ANTI_ALIAS_FLAG);
        this.textPaint.setTextSize(view.getTextSize());
        this.textPaint.setTypeface(view.getTypeface());
        this.textPaint.setTextAlign(android.graphics.Paint.Align.RIGHT);
        return this.textPaint;
    }

    private applyLayout(): void {
        const view = this.view;
        const layout = this.layout;
        if (!view || !layout) return;
        view.setTypeface(layout.monospace ? android.graphics.Typeface.MONOSPACE : android.graphics.Typeface.DEFAULT);
        const density = this.density(view);
        view.setPadding(
            Math.round(layout.leftMargin * density) + this.gutterPixels(view),
            Math.round(layout.topMargin * density),
            Math.round(layout.rightMargin * density),
            Math.round(layout.bottomMargin * density),
        );
        view.setKeyListener(layout.editable ? this.keyListener : null);
        view.setCursorVisible(layout.cursorVisible);
        this.appliedGutter = this.gutterPixels(view);
        view.invalidate();
    }

    private applyPalette(): void {
        const view = this.view;
        const palette = this.palette;
        if (!view || !palette) return;
        view.setBackgroundColor(palette.background);
        view.setTextColor(palette.foreground);
        view.setHighlightColor(palette.selectionBackground);
        view.invalidate();
    }

    private applySelection(): void {
        const view = this.view;
        if (!view) return;
        const length = view.getText().length();
        const start = Math.min(this.selection.start, length);
        if (view.getSelectionStart() === start && view.getSelectionEnd() === Math.min(this.selection.end, length))
            return;
        view.setSelection(start, Math.min(this.selection.end, length));
    }

    // --- platform → host -------------------------------------------------------------------------

    private flushEdits(): void {
        const view = this.view;
        const host = this.host;
        if (this.applying || !view || !host || this.queue.length === 0) return;
        const edits = this.queue;
        this.queue = [];
        for (const edit of edits) host.onNativeEdit(edit.start, edit.removed, edit.inserted);
        host.onNativeSelection(view.getSelectionStart(), view.getSelectionEnd());
    }

    selectionChanged(start: number, end: number): void {
        // Mid-edit the selection moves before the text edit reaches the buffer; `flushEdits` reports it then.
        if (this.applying || this.queue.length > 0) return;
        this.selection = { start, end };
        this.host?.onNativeSelection(start, end);
        this.view?.invalidate();
    }

    invalidateGutter(): void {
        const view = this.view;
        if (!view) return;
        // A column's width follows its widget properties; its text is measured when it is drawn.
        if (this.gutterPixels(view) !== this.appliedGutter) this.applyLayout();
        else view.invalidate();
    }

    // --- drawing ---------------------------------------------------------------------------------

    private fill(canvas: AndroidCanvas, color: number, left: number, top: number, right: number, bottom: number): void {
        this.fillPaint ??= new android.graphics.Paint(0);
        this.fillPaint.setColor(color);
        canvas.drawRect(left, top, right, bottom, this.fillPaint);
    }

    drawBehind(view: AndroidEditText, canvas: AndroidCanvas): void {
        const palette = this.palette;
        const layout = view.getLayout();
        if (!palette || !layout || !this.layout?.highlightCurrentLine || palette.currentLineBackground === 0) return;
        const line = layout.getLineForOffset(view.getSelectionEnd());
        const offset = view.getExtendedPaddingTop();
        this.fill(
            canvas,
            palette.currentLineBackground,
            view.getScrollX(),
            offset + layout.getLineTop(line),
            view.getScrollX() + view.getWidth(),
            offset + layout.getLineBottom(line),
        );
    }

    drawGutter(view: AndroidEditText, canvas: AndroidCanvas): void {
        const palette = this.palette;
        const layout = view.getLayout();
        const host = this.host;
        if (!palette || !layout || !host) return;
        const showNumbers = this.layout?.showLineNumbers === true;
        const density = this.density(view);
        const scrollY = view.getScrollY();
        const offset = view.getExtendedPaddingTop();
        const visible = visibleLines(
            layout.getLineCount(),
            (line) => offset + layout.getLineTop(line),
            (line) => offset + layout.getLineBottom(line),
            scrollY,
            scrollY + view.getHeight(),
        );
        const columns = visible
            ? host.queryGutter(visible.first, visible.last)
            : host.gutterColumns().map((column) => ({ ...column, cells: [] }));
        if (!showNumbers && columns.length === 0) return;
        const paint = this.paintFor(view);
        columns.forEach((column, at) => {
            // Plain text only: Pango markup is read for its text, not painted with its styles.
            const widest = column.cells.reduce((width, cell) => Math.max(width, paint.measureText(cell.text)), 0);
            this.measured[at] = Math.max(widest, this.measured[at] ?? 0);
        });
        this.measured.length = columns.length;
        const total = this.gutterPixels(view, layout.getLineCount());
        if (total !== this.appliedGutter) {
            this.appliedGutter = total;
            view.post(new java.lang.Runnable({ run: () => this.applyLayout() }));
        }
        const left = view.getScrollX();
        this.fill(canvas, palette.lineNumberBackground, left, scrollY, left + total, scrollY + view.getHeight());
        if (!visible) return;

        const padding = GUTTER_PADDING_DP * density;
        const current = emphasisedLine(
            this.layout?.highlightCurrentLine === true,
            layout.getLineForOffset(view.getSelectionEnd()),
        );
        let x = left;
        const drawNumbers = (): void => {
            const width = this.numbersPixels(view, layout.getLineCount());
            paint.setTextAlign(android.graphics.Paint.Align.RIGHT);
            for (let line = visible.first; line <= visible.last; line++) {
                const isCurrent = line === current;
                if (isCurrent && palette.currentLineNumberBackground !== 0) {
                    this.fill(
                        canvas,
                        palette.currentLineNumberBackground,
                        x,
                        offset + layout.getLineTop(line),
                        x + width,
                        offset + layout.getLineBottom(line),
                    );
                }
                paint.setColor(isCurrent ? palette.currentLineNumberForeground : palette.lineNumberForeground);
                canvas.drawText(String(line + 1), x + width - padding, offset + layout.getLineBaseline(line), paint);
            }
            x += width;
        };
        let numbersDrawn = !showNumbers;
        columns.forEach((column, at) => {
            if (!numbersDrawn && column.position >= 0) {
                drawNumbers();
                numbersDrawn = true;
            }
            paint.setTextAlign(android.graphics.Paint.Align.LEFT);
            paint.setColor(palette.lineNumberForeground);
            column.cells.forEach((cell, index) => {
                if (cell.text === '') return;
                const baseline = offset + layout.getLineBaseline(visible.first + index);
                canvas.drawText(cell.text, x + column.marginStart * density, baseline, paint);
            });
            x += this.columnPixels(column, this.measured[at], density);
        });
        if (!numbersDrawn) drawNumbers();
    }
}

export function createEditorDriver(): NativeEditorDriver {
    return new AndroidEditorDriver();
}
