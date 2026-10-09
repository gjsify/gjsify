// The slice of the Android SDK `native-editor.android.ts` calls, typed structurally.
//
// `android.*` is a global the NativeScript V8 runtime injects; `@nativescript/types-android`
// would describe all of it but is not installed here. Naming the used members also gives one
// list to keep in step with `native-api-usage.json` (R8 strips what that file does not name —
// see the package README).

export interface AndroidCharSequence {
    toString(): string;
    subSequence(start: number, end: number): AndroidCharSequence;
}

export interface AndroidEditable extends AndroidCharSequence {
    length(): number;
    replace(start: number, end: number, text: string): AndroidEditable;
    setSpan(what: unknown, start: number, end: number, flags: number): void;
    removeSpan(what: unknown): void;
}

export interface AndroidCanvas {
    drawRect(left: number, top: number, right: number, bottom: number, paint: AndroidPaint): void;
    drawText(text: string, x: number, y: number, paint: AndroidPaint): void;
}

export interface AndroidPaint {
    setColor(color: number): void;
    setTextSize(size: number): void;
    setTypeface(typeface: unknown): unknown;
    setTextAlign(align: unknown): void;
    measureText(text: string): number;
}

export interface AndroidLayout {
    getLineCount(): number;
    getLineTop(line: number): number;
    getLineBottom(line: number): number;
    getLineBaseline(line: number): number;
    getLineForOffset(offset: number): number;
}

export interface AndroidEditText {
    driver?: object;
    getText(): AndroidEditable;
    setText(text: string): void;
    getLayout(): AndroidLayout | null;
    getScrollX(): number;
    getScrollY(): number;
    getWidth(): number;
    getHeight(): number;
    getSelectionStart(): number;
    getSelectionEnd(): number;
    getExtendedPaddingTop(): number;
    getTextSize(): number;
    getTypeface(): unknown;
    getResources(): { getDisplayMetrics(): { density: number } };
    getKeyListener(): unknown;
    setKeyListener(listener: unknown): void;
    setSelection(start: number, end: number): void;
    setHorizontallyScrolling(enabled: boolean): void;
    setGravity(gravity: number): void;
    setInputType(type: number): void;
    setBackgroundColor(color: number): void;
    setTextColor(color: number): void;
    setHighlightColor(color: number): void;
    setTypeface(typeface: unknown): void;
    setPadding(left: number, top: number, right: number, bottom: number): void;
    setCursorVisible(visible: boolean): void;
    addTextChangedListener(watcher: unknown): void;
    removeTextChangedListener(watcher: unknown): void;
    invalidate(): void;
    post(action: unknown): boolean;
}

export interface AndroidNamespace {
    widget: { EditText: new (context: unknown) => AndroidEditText & { onDraw(canvas: AndroidCanvas): void } };
    graphics: {
        Paint: (new (flags: number) => AndroidPaint) & { Align: { RIGHT: unknown; LEFT: unknown } };
        Typeface: { MONOSPACE: unknown; DEFAULT: unknown; BOLD: number; ITALIC: number; BOLD_ITALIC: number };
    };
    text: {
        InputType: {
            TYPE_CLASS_TEXT: number;
            TYPE_TEXT_FLAG_MULTI_LINE: number;
            TYPE_TEXT_FLAG_NO_SUGGESTIONS: number;
        };
        TextWatcher: new (implementation: object) => unknown;
        Spanned: { SPAN_EXCLUSIVE_EXCLUSIVE: number };
        style: {
            ForegroundColorSpan: new (color: number) => unknown;
            BackgroundColorSpan: new (color: number) => unknown;
            StyleSpan: new (style: number) => unknown;
            UnderlineSpan: new () => unknown;
            StrikethroughSpan: new () => unknown;
        };
    };
    view: { Gravity: { TOP: number; START: number } };
    R: { id: { copy: number } };
    // `onDraw`, `onSelectionChanged` and `onTextContextMenuItem` are overridden through `.extend()`, see native-editor.android.ts.
}
