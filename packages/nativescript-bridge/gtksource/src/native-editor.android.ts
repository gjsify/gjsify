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
// The platform half is unverified on a device — see the package README.

import type {
    AndroidCanvas,
    AndroidEditable,
    AndroidEditText,
    AndroidNamespace,
    AndroidPaint,
} from './android-types.js';
import type { EditorHost, EditorLayout } from './editor-driver.js';
import { emphasisedLine, gutterWidth, visibleLines } from './gutter.js';
import { LineStore } from './line-store.js';
import type { NativeEditorDriver } from './native-editor.js';
import type { EditorPalette } from './style-scheme.js';
import type { StyledRun } from './token-styler.js';

declare const android: AndroidNamespace;

const GUTTER_PADDING_DP = 8;
const ANTI_ALIAS_FLAG = 1;

interface QueuedEdit {
    readonly start: number;
    readonly removed: number;
    readonly inserted: string;
}

interface DrawingDriver {
    drawBehind(view: AndroidEditText, canvas: AndroidCanvas): void;
    drawGutter(view: AndroidEditText, canvas: AndroidCanvas): void;
    selectionChanged(start: number, end: number): void;
}

/** `this` inside an `.extend()` implementation: the Java instance plus the runtime's `super` proxy. */
type ExtendedEditText = AndroidEditText & {
    super: { onDraw(canvas: AndroidCanvas): void; onSelectionChanged(start: number, end: number): void };
};

let editTextClass: (new (context: unknown) => AndroidEditText) | undefined;

/** Built on first use: `.extend()` needs the runtime, which does not exist when this module is merely imported. */
function gutterEditText(): new (context: unknown) => AndroidEditText {
    if (editTextClass) return editTextClass;
    const base = android.widget.EditText as unknown as { extend(implementation: object): typeof editTextClass };
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

    bind(host: EditorHost): void {
        this.host = host;
    }

    createNativeView(context: unknown): unknown {
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

    private gutterPixels(view: AndroidEditText): number {
        if (!this.layout?.showLineNumbers) return 0;
        const padding = GUTTER_PADDING_DP * this.density(view);
        return gutterWidth(this.lineCount, this.paintFor(view).measureText('0'), padding);
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
        view.setCursorVisible(layout.editable);
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
        if (!palette || !layout || !this.layout?.showLineNumbers) return;
        const paint = this.paintFor(view);
        const padding = GUTTER_PADDING_DP * this.density(view);
        const width = gutterWidth(layout.getLineCount(), paint.measureText('0'), padding);
        const left = view.getScrollX();
        const scrollY = view.getScrollY();
        const offset = view.getExtendedPaddingTop();
        this.fill(canvas, palette.lineNumberBackground, left, scrollY, left + width, scrollY + view.getHeight());

        const visible = visibleLines(
            layout.getLineCount(),
            (line) => offset + layout.getLineTop(line),
            (line) => offset + layout.getLineBottom(line),
            scrollY,
            scrollY + view.getHeight(),
        );
        if (!visible) return;
        const current = emphasisedLine(
            this.layout.highlightCurrentLine,
            layout.getLineForOffset(view.getSelectionEnd()),
        );
        for (let line = visible.first; line <= visible.last; line++) {
            const isCurrent = line === current;
            if (isCurrent && palette.currentLineNumberBackground !== 0) {
                this.fill(
                    canvas,
                    palette.currentLineNumberBackground,
                    left,
                    offset + layout.getLineTop(line),
                    left + width,
                    offset + layout.getLineBottom(line),
                );
            }
            paint.setColor(isCurrent ? palette.currentLineNumberForeground : palette.lineNumberForeground);
            canvas.drawText(String(line + 1), left + width - padding, offset + layout.getLineBaseline(line), paint);
        }
    }
}

export function createEditorDriver(): NativeEditorDriver {
    return new AndroidEditorDriver();
}
