// Everything a `GtkSource.View` is except the pixels: the buffer, the view's properties, the
// highlight controller and the two-way sync with a native text widget through an
// `EditorDriver`. The NativeScript class is a thin shell over this, because this half can run
// (and be tested) off-device.
//
// SYNC. The `Buffer` is the model; the native text mirrors it. A user edit arrives through
// `onNativeEdit` and is applied to the buffer WITHOUT being mirrored back; a programmatic
// buffer edit is mirrored into the widget. `mirroring` and `fromNative` are the two guards
// that stop either direction from echoing.

import { Buffer } from './buffer.js';
import type { TextEdit } from './buffer.js';
import type {
    EditorDriver,
    EditorHost,
    EditorLayout,
    GutterCell,
    GutterColumn,
    GutterMetrics,
} from './editor-driver.js';
import { GutterLines, GutterRendererText, WINDOW_LEFT, parseMarkup } from './gutter-renderer.js';
import type { GutterRenderer, GutterSet } from './gutter-renderer.js';
import { HighlightController } from './highlight-controller.js';
import { StyleSchemeManager } from './style-scheme.js';
import { TextIter } from './text-iter.js';
import type { ColorSchemeVariant } from './style-scheme.js';
import { SignalEmitter } from './signals.js';

/** The leading blanks of `line`: what `auto-indent` carries onto the next line. */
export function leadingWhitespace(line: string): string {
    return /^[ \t]*/.exec(line)![0];
}

/** What `renderer` shows now: `markup` wins over `text`, a renderer that shows no string shows nothing. */
function cellOf(renderer: GutterRenderer): GutterCell {
    if (!(renderer instanceof GutterRendererText)) return { text: '', runs: null };
    if (renderer.markup !== null) {
        const runs = parseMarkup(renderer.markup);
        return { text: runs.map((run) => run.text).join(''), runs };
    }
    return { text: renderer.text ?? '', runs: null };
}

export class EditorSession extends SignalEmitter implements EditorHost {
    private current!: Buffer;
    private controller!: HighlightController;
    private readonly bufferHandlers: number[] = [];
    private mirroring = false;
    private fromNative = false;
    private variant: ColorSchemeVariant;
    private gutters: GutterSet | null = null;
    private defaultRan = false;

    private props = {
        autoIndent: false,
        indentWidth: -1,
        showLineNumbers: false,
        monospace: false,
        editable: true,
        highlightCurrentLine: false,
        cursorVisible: true,
        leftMargin: 0,
        rightMargin: 0,
        topMargin: 0,
        bottomMargin: 0,
    };

    constructor(
        private readonly driver: EditorDriver,
        private readonly schemes: StyleSchemeManager = StyleSchemeManager.getDefault(),
        variant: ColorSchemeVariant = 'light',
    ) {
        super();
        this.variant = variant;
        driver.bind(this);
        this.attach(new Buffer());
    }

    get buffer(): Buffer {
        return this.current;
    }

    set buffer(value: Buffer) {
        if (value === this.current) return;
        this.attach(value);
        this.emit('notify::buffer');
    }

    private attach(buffer: Buffer): void {
        if (this.current) {
            for (const id of this.bufferHandlers.splice(0)) this.current.disconnect(id);
            this.controller.dispose();
        }
        this.current = buffer;
        // Connected BEFORE the controller, so the widget's text is up to date when spans are painted onto it.
        this.bufferHandlers.push(
            buffer.connect('changed', (_buffer, edit: TextEdit) => this.onBufferChanged(edit)),
            buffer.connect('mark-set', () => this.onBufferCursor()),
        );
        this.mirroring = true;
        try {
            this.driver.setText(buffer.text);
        } finally {
            this.mirroring = false;
        }
        this.controller = new HighlightController(buffer, this.driver, this.schemes, this.variant);
        this.driver.setLineCount(buffer.lineCount);
        this.driver.setSelection(buffer.cursorPosition, buffer.cursorPosition);
        this.pushLayout();
    }

    private onBufferChanged(edit: TextEdit): void {
        if (!this.fromNative) {
            this.mirroring = true;
            try {
                this.driver.replaceRange(edit.start, edit.start + edit.removedText.length, edit.insertedText);
            } finally {
                this.mirroring = false;
            }
        }
        if (edit.insertedLines !== edit.removedLines) this.driver.setLineCount(this.current.lineCount);
    }

    private onBufferCursor(): void {
        if (this.fromNative || this.mirroring) return;
        this.driver.setSelection(this.current.selectionBoundPosition, this.current.cursorPosition);
    }

    // --- the gutter: renderers beside the text --------------------------------------------------

    /** Paints the left gutter of `gutters`: its changes reach the driver, and `queryGutter` answers from it. */
    bindGutters(gutters: GutterSet): void {
        this.gutters = gutters;
        gutters.watch((gutter) => {
            if (gutter.window_type === WINDOW_LEFT) this.driver.invalidateGutter();
        });
    }

    private leftRenderers(): {
        renderers: readonly GutterRenderer[];
        positions: readonly number[];
    } {
        const gutter = this.gutters?.get(WINDOW_LEFT);
        return {
            renderers: gutter?.renderers ?? [],
            positions: gutter?.positions ?? [],
        };
    }

    private metricsOf(renderer: GutterRenderer, position: number): GutterMetrics {
        return {
            position,
            widthRequest: renderer.width_request,
            marginStart: renderer.margin_start,
            marginEnd: renderer.margin_end,
        };
    }

    gutterColumns(): readonly GutterMetrics[] {
        const { renderers, positions } = this.leftRenderers();
        return renderers.map((renderer, at) => this.metricsOf(renderer, positions[at]));
    }

    queryGutter(first: number, last: number): readonly GutterColumn[] {
        const { renderers, positions } = this.leftRenderers();
        if (renderers.length === 0 || this.gutters === null) return [];
        const lines = new GutterLines(this.gutters.view, this.current, first, last);
        return renderers.map((renderer, at) => {
            const query = (
                renderer as unknown as {
                    vfunc_query_data?: (lines: GutterLines, line: number) => void;
                }
            ).vfunc_query_data;
            const cells: GutterCell[] = [];
            for (let line = first; line <= last; line++) {
                query?.call(renderer, lines, line);
                cells.push(cellOf(renderer));
            }
            return { ...this.metricsOf(renderer, positions[at]), cells };
        });
    }

    // --- EditorHost: what the user did ---------------------------------------------------------

    onNativeEdit(start: number, removedLength: number, inserted: string): void {
        if (this.mirroring) return;
        this.fromNative = true;
        // A native edit is what GTK calls a user action: `end-user-action` is how a consumer hears of it.
        this.current.begin_user_action();
        try {
            this.current.replace(start, start + removedLength, inserted);
        } finally {
            this.fromNative = false;
            this.current.end_user_action();
        }
        if (this.props.autoIndent && inserted === '\n') {
            // The line the newline ended is the one whose indentation carries over.
            const indent = leadingWhitespace(this.current.getLine(this.current.lineOfOffset(start)));
            if (indent !== '') {
                this.current.insert(start + 1, indent);
                this.driver.setSelection(this.current.cursorPosition, this.current.cursorPosition);
            }
        }
    }

    onNativeSelection(start: number, end: number): void {
        if (this.mirroring) return;
        // Android reports the selection while a text change is still settling; clamp rather than throw into the platform.
        const clamp = (n: number): number => Math.min(Math.max(0, n), this.current.length);
        this.fromNative = true;
        try {
            this.current.selectRange(clamp(end), clamp(start));
        } finally {
            this.fromNative = false;
        }
        // A `mark-set` handler may have moved the marks elsewhere: the buffer is the truth, the widget follows.
        if (this.current.cursorPosition !== clamp(end) || this.current.selectionBoundPosition !== clamp(start)) {
            this.onBufferCursor();
        }
    }

    onNativeExtendSelection(granularity: number, location: number): readonly [number, number] | null {
        const buffer = this.current;
        const at = Math.min(Math.max(0, location), buffer.length);
        const start = new TextIter(buffer, at);
        const end = new TextIter(buffer, at);
        this.defaultRan = false;
        const handled = this.emitHandled('extend-selection', granularity, new TextIter(buffer, at), start, end);
        if (this.defaultRan) return null;
        return handled ? [start.utf16Offset, end.utf16Offset] : [at, at];
    }

    onNativeCopy(): boolean {
        this.defaultRan = false;
        this.emit('copy-clipboard');
        return this.defaultRan;
    }

    // `extend-selection` and `copy-clipboard` are RUN_LAST: the class handler is the platform's own
    // behaviour, which `defaultRan` reports back, so a stopped emission leaves the platform alone.
    protected override classHandler(name: string): unknown {
        if (name !== 'extend-selection' && name !== 'copy-clipboard') return undefined;
        this.defaultRan = true;
        return true;
    }

    // --- properties -----------------------------------------------------------------------------

    private setProp<K extends keyof EditorSession['props']>(
        name: K,
        value: EditorSession['props'][K],
        signal: string,
    ): void {
        if (this.props[name] === value) return;
        this.props[name] = value;
        this.emit(`notify::${signal}`);
        this.pushLayout();
    }

    private pushLayout(): void {
        const { props } = this;
        this.driver.setLayout({
            showLineNumbers: props.showLineNumbers,
            monospace: props.monospace,
            editable: props.editable,
            highlightCurrentLine: props.highlightCurrentLine,
            cursorVisible: props.cursorVisible,
            leftMargin: props.leftMargin,
            rightMargin: props.rightMargin,
            topMargin: props.topMargin,
            bottomMargin: props.bottomMargin,
        } satisfies EditorLayout);
    }

    get autoIndent(): boolean {
        return this.props.autoIndent;
    }
    set autoIndent(value: boolean) {
        this.setProp('autoIndent', value, 'auto-indent');
    }

    /** Held and read back; Android has no Tab key to apply it to (see the package README). */
    get indentWidth(): number {
        return this.props.indentWidth;
    }
    set indentWidth(value: number) {
        this.setProp('indentWidth', value, 'indent-width');
    }

    get showLineNumbers(): boolean {
        return this.props.showLineNumbers;
    }
    set showLineNumbers(value: boolean) {
        this.setProp('showLineNumbers', value, 'show-line-numbers');
    }

    get monospace(): boolean {
        return this.props.monospace;
    }
    set monospace(value: boolean) {
        this.setProp('monospace', value, 'monospace');
    }

    get editable(): boolean {
        return this.props.editable;
    }
    set editable(value: boolean) {
        this.setProp('editable', value, 'editable');
    }

    get highlightCurrentLine(): boolean {
        return this.props.highlightCurrentLine;
    }
    set highlightCurrentLine(value: boolean) {
        this.setProp('highlightCurrentLine', value, 'highlight-current-line');
    }

    get cursorVisible(): boolean {
        return this.props.cursorVisible;
    }
    set cursorVisible(value: boolean) {
        this.setProp('cursorVisible', value, 'cursor-visible');
    }

    get leftMargin(): number {
        return this.props.leftMargin;
    }
    set leftMargin(value: number) {
        this.setProp('leftMargin', value, 'left-margin');
    }

    get rightMargin(): number {
        return this.props.rightMargin;
    }
    set rightMargin(value: number) {
        this.setProp('rightMargin', value, 'right-margin');
    }

    get topMargin(): number {
        return this.props.topMargin;
    }
    set topMargin(value: number) {
        this.setProp('topMargin', value, 'top-margin');
    }

    get bottomMargin(): number {
        return this.props.bottomMargin;
    }
    set bottomMargin(value: number) {
        this.setProp('bottomMargin', value, 'bottom-margin');
    }

    /** Re-tints for the light/dark change; the tokens are kept. */
    setColorScheme(variant: ColorSchemeVariant): void {
        this.variant = variant;
        this.controller.setColorScheme(variant);
    }

    dispose(): void {
        for (const id of this.bufferHandlers.splice(0)) this.current.disconnect(id);
        this.controller.dispose();
    }
}
