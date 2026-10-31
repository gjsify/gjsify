// The iOS half of `GtkSource.View`: a `UITextView` whose `NSTextStorage` carries the syntax
// highlight as attributes on ranges, and whose `drawRect:` paints the line-number gutter and the
// current-line band from the `NSLayoutManager`'s line fragments.
//
// NO WORD WRAP, as on Android: the text container is unbounded and does not track the view, so
// every logical line is ONE line fragment. That is what makes the gutter exact — a fragment is
// addressed by the character offset its line starts at, and `lineStartOffsets` is the whole index.
//
// ATTRIBUTES ARE NOT SPANS. Android's `Editable` holds span OBJECTS that the platform moves
// through edits and a repaint removes by identity. `NSTextStorage` holds only attributes on
// ranges, so a repaint has to NAME the range it overwrites: it resets the line's extent to the
// base attributes and adds the new runs over it. The extent is read off the LIVE text every time
// (`lineExtent`), never remembered — a remembered offset points elsewhere after the next
// insertion, while the line a highlighter repaints is always the line the text has now.
//
// NOT VERIFIED ON A DEVICE OR A SIMULATOR. The arithmetic half is covered by `text-ranges.spec.ts`
// on Node and GJS; this half is the UIKit call sequence, written from the documented API and run
// by nothing (#1051). It exists rather than letting iOS fall back to `native-editor.ts`, because
// that base module's refusal is indistinguishable from a silently missing variant — which is how
// `icons.android.ts` once shipped without an iOS twin and every icon vanished on iOS.
//
// Two GTK behaviours have NO iOS surface here and are named in the package README rather than
// approximated: `extend-selection` (UIKit's double/triple-tap selection comes from the text view's
// internal gesture recognisers, which offer no documented veto before they select) and
// `copy-clipboard` (UIKit's copy arrives as the `-copy:` editing action, whose NativeScript
// override name collides with `NSObject`'s own `-copy`). Both keep the platform's own behaviour.

import type {
    CGRect,
    NSRangeValue,
    NSStringInstance,
    ObjCClass,
    TextAttributes,
    UIColorInstance,
    UIFontDescriptorInstance,
    UIFontInstance,
    UITextViewNative,
} from './ios-types.js';
import type { EditorHost, EditorLayout } from '@gjsify/gtksource-core';
import type { EditorPalette, GutterMetrics, RunStyle, StyledRun } from '@gjsify/gtksource-core';
import { emphasisedLine, gutterWidth, visibleLines } from '@gjsify/gtksource-core';
import { LineStore } from '@gjsify/gtksource-core';
import type { NativeEditorDriver } from './native-editor.js';
import { EditQueue, argbComponents, clampRange, lineAtOffset, lineExtent, lineStartOffsets } from './text-ranges.js';

declare const UITextView: ObjCClass<UITextViewNative>;
declare const NSObject: ObjCClass<object>;
declare const UITextViewDelegate: unknown;
declare const UIColor: {
    colorWithRedGreenBlueAlpha(red: number, green: number, blue: number, alpha: number): UIColorInstance;
    readonly clearColor: UIColorInstance;
};
declare const UIFont: {
    systemFontOfSize(size: number): UIFontInstance;
    monospacedSystemFontOfSizeWeight(size: number, weight: number): UIFontInstance;
    /** A size of 0 keeps the descriptor's own, which is where the traits came from. */
    fontWithDescriptorSize(descriptor: UIFontDescriptorInstance, size: number): UIFontInstance;
};
declare const UIRectFill: (rect: CGRect) => void;
declare const NSFontAttributeName: string;
declare const NSForegroundColorAttributeName: string;
declare const NSBackgroundColorAttributeName: string;
declare const NSUnderlineStyleAttributeName: string;
declare const NSStrikethroughStyleAttributeName: string;

/** Points, not pixels: a UIKit coordinate is already device-independent, so nothing converts here. */
const GUTTER_PADDING = 8;
// `UIFontDescriptorSymbolicTraits`: the NativeScript runtime exposes no enum object for it.
const TRAIT_ITALIC = 1 << 0;
const TRAIT_BOLD = 1 << 1;
/** `NSUnderlineStyle.single`, which is also the single stroke of a strikethrough. */
const STROKE_SINGLE = 1;
/** `UIFontWeightRegular`. */
const FONT_WEIGHT_REGULAR = 0;
const DEFAULT_FONT_SIZE = 14;
/** The container width that refuses to wrap; `CGFLOAT_MAX` makes TextKit's own arithmetic overflow. */
const UNBOUNDED = 1e7;

interface DrawingDriver {
    drawBehind(view: UITextViewNative): void;
    drawGutter(view: UITextViewNative): void;
}

/** What the delegate reports: the platform's own text and selection changes. */
interface EditReporter {
    queueEdit(range: NSRangeValue, text: string): void;
    flushEdits(): void;
    selectionChanged(range: NSRangeValue): void;
}

/** `this` inside an `.extend()` implementation: the ObjC instance plus the runtime's `super` proxy. */
type ExtendedTextView = UITextViewNative & { super: { drawRect(rect: CGRect): void } };

/** The delegate object, which carries the driver the way the view does. */
type EditDelegate = { driver?: object };

let textViewClass: ObjCClass<UITextViewNative> | undefined;

/** Built on first use: `.extend()` needs the ObjC runtime, which merely importing this module has not. */
function gutterTextView(): ObjCClass<UITextViewNative> {
    if (textViewClass) return textViewClass;
    textViewClass = UITextView.extend(
        {
            drawRect(this: ExtendedTextView, rect: CGRect) {
                const driver = this.driver as DrawingDriver | undefined;
                driver?.drawBehind(this);
                this.super.drawRect(rect);
                driver?.drawGutter(this);
            },
        },
        { name: 'GjsifyGtkSourceTextView' },
    );
    return textViewClass;
}

let delegateClass: ObjCClass<EditDelegate> | undefined;

function editDelegate(): ObjCClass<EditDelegate> {
    if (delegateClass) return delegateClass;
    delegateClass = (NSObject as unknown as ObjCClass<EditDelegate>).extend(
        {
            // The queue-then-flush pair of the Android `TextWatcher`: iOS asks before the change and
            // reports after it, so the host is only ever handed offsets that are already valid.
            textViewShouldChangeTextInRangeReplacementText(
                this: EditDelegate,
                _view: UITextViewNative,
                range: NSRangeValue,
                text: string,
            ): boolean {
                (this.driver as EditReporter | undefined)?.queueEdit(range, text);
                return true;
            },
            textViewDidChange(this: EditDelegate, _view: UITextViewNative): void {
                (this.driver as EditReporter | undefined)?.flushEdits();
            },
            textViewDidChangeSelection(this: EditDelegate, view: UITextViewNative): void {
                (this.driver as EditReporter | undefined)?.selectionChanged(view.selectedRange);
            },
        },
        { name: 'GjsifyGtkSourceTextViewDelegate', protocols: [UITextViewDelegate] },
    );
    return delegateClass;
}

/** A `UIColor` for the `0xAARRGGBB` integer a palette and a run style carry. */
function uiColor(argb: number): UIColorInstance {
    const { red, green, blue, alpha } = argbComponents(argb);
    return UIColor.colorWithRedGreenBlueAlpha(red, green, blue, alpha);
}

/** A JS string IS an `NSString` across the ObjC bridge, so measuring and drawing need no wrapper. */
function asNSString(text: string): NSStringInstance {
    return text as unknown as NSStringInstance;
}

class IosEditorDriver implements NativeEditorDriver, DrawingDriver, EditReporter {
    private host: EditorHost | null = null;
    private view: UITextViewNative | null = null;
    /** `UITextView.delegate` is WEAK: without this field the delegate is collected and edits stop arriving. */
    private delegate: EditDelegate | null = null;
    private applying = false;
    private readonly queue = new EditQueue();

    /** Held while no native view exists, applied by `attach()`. */
    private pendingText: string | null = '';
    private selection = { start: 0, end: 0 };
    private lineCount = 1;
    private layout: EditorLayout | null = null;
    private palette: EditorPalette | null = null;

    private readonly runs = new LineStore<readonly StyledRun[]>();
    /** Where every logical line starts in the live text; the only index the fragment geometry needs. */
    private starts: readonly number[] = [0];
    private baseFont: UIFontInstance | null = null;
    /** One font per trait combination: a descriptor round-trip per run costs a repaint per keystroke. */
    private readonly traitFonts = new Map<number, UIFontInstance | null>();
    /** The widest text each left-gutter column drew, by column; a column is as wide as it needs. */
    private measured: number[] = [];
    private appliedGutter = -1;

    bind(host: EditorHost): void {
        this.host = host;
    }

    createNativeView(_context: unknown): object {
        const view = gutterTextView().new();
        view.driver = this;
        return view;
    }

    attach(nativeView: unknown): void {
        const view = nativeView as UITextViewNative;
        this.view = view;
        const container = view.textContainer;
        container.widthTracksTextView = false;
        container.lineFragmentPadding = 0;
        container.size = { width: UNBOUNDED, height: UNBOUNDED };
        // Touching `layoutManager` is what pins the view to TextKit 1, where a line fragment is
        // addressable by character offset. TextKit 2 answers geometry only through viewport layout,
        // which a gutter drawn in `drawRect:` cannot ask.
        view.layoutManager.ensureLayoutForTextContainer(container);
        view.alwaysBounceHorizontal = true;
        view.showsHorizontalScrollIndicator = true;
        view.clipsToBounds = true;
        this.delegate = editDelegate().new();
        this.delegate.driver = this;
        view.delegate = this.delegate;
        this.applyLayout();
        this.applyPalette();
        this.applying = true;
        try {
            // The `text` setter rebuilds the attributed string from the view's own font and colour,
            // so the palette and the layout go on FIRST and the highlight is repainted after.
            view.text = this.pendingText ?? '';
        } finally {
            this.applying = false;
        }
        this.pendingText = null;
        this.refreshStarts();
        this.repaintAll();
        this.applySelection();
    }

    detach(): void {
        const view = this.view;
        if (view) {
            // The text outlives the native view: a re-attach (list recycling, rotation) starts from it.
            this.pendingText = view.text;
            view.delegate = null;
        }
        this.view = null;
        this.delegate = null;
        this.queue.clear();
    }

    setText(text: string): void {
        this.runs.clear();
        if (!this.view) {
            this.pendingText = text;
            this.refreshStarts();
            return;
        }
        this.applying = true;
        try {
            this.view.text = text;
        } finally {
            this.applying = false;
        }
        this.refreshStarts();
    }

    replaceRange(start: number, end: number, text: string): void {
        const view = this.view;
        if (!view) {
            const before = this.pendingText ?? '';
            this.pendingText = before.slice(0, start) + text + before.slice(end);
            this.refreshStarts();
            return;
        }
        const storage = view.textStorage;
        this.applying = true;
        try {
            storage.beginEditing();
            storage.replaceCharactersInRangeWithString(this.edited(start, end, storage.length), text);
            storage.endEditing();
        } finally {
            this.applying = false;
        }
        this.refreshStarts();
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

    // --- ranges ------------------------------------------------------------------------------------

    /** An `NSRange` for `[start, end)`, clamped; `clampRange` answers null for an insertion, which has none. */
    private edited(start: number, end: number, length: number): NSRangeValue {
        const from = Math.min(Math.max(0, Math.min(start, end)), length);
        return clampRange(from, Math.max(start, end), length) ?? { location: from, length: 0 };
    }

    private refreshStarts(): void {
        this.starts = lineStartOffsets(this.view ? this.view.text : (this.pendingText ?? ''));
    }

    // --- attributes --------------------------------------------------------------------------------

    spliceLines(first: number, removed: number, inserted: number): void {
        // Nothing to release: an attribute is not an object, so a dropped line's highlight went with
        // the characters it sat on.
        this.runs.splice(first, removed, inserted);
    }

    paintLine(line: number, lineStart: number, runs: readonly StyledRun[]): void {
        this.runs.set(line, runs);
        if (this.view) this.applyRuns(this.view, lineStart, runs);
    }

    clearAll(): void {
        this.runs.clear();
        const view = this.view;
        if (!view) return;
        const whole = clampRange(0, view.textStorage.length, view.textStorage.length);
        if (whole) view.textStorage.setAttributesRange(this.baseAttributes(), whole);
    }

    /** What a line looks like with nothing painted on it. `setAttributesRange` REPLACES, so this IS the reset. */
    private baseAttributes(): TextAttributes {
        const attributes: TextAttributes = {};
        if (this.baseFont) attributes[NSFontAttributeName] = this.baseFont;
        if (this.palette) attributes[NSForegroundColorAttributeName] = uiColor(this.palette.foreground);
        return attributes;
    }

    /** `null` when the scheme asked for nothing this platform draws, so the line keeps its base attributes. */
    private runAttributes(style: RunStyle): TextAttributes | null {
        const attributes: TextAttributes = {};
        if (style.foreground !== undefined) attributes[NSForegroundColorAttributeName] = uiColor(style.foreground);
        if (style.background !== undefined) attributes[NSBackgroundColorAttributeName] = uiColor(style.background);
        if (style.bold || style.italic) {
            const font = this.traitFont((style.bold ? TRAIT_BOLD : 0) | (style.italic ? TRAIT_ITALIC : 0));
            if (font) attributes[NSFontAttributeName] = font;
        }
        if (style.underline) attributes[NSUnderlineStyleAttributeName] = STROKE_SINGLE;
        if (style.strikethrough) attributes[NSStrikethroughStyleAttributeName] = STROKE_SINGLE;
        return Object.keys(attributes).length > 0 ? attributes : null;
    }

    /** Null when the family has no such face — a monospace family with no italic; the run keeps the base font. */
    private traitFont(traits: number): UIFontInstance | null {
        const cached = this.traitFonts.get(traits);
        if (cached !== undefined) return cached;
        const base = this.baseFont;
        const descriptor = base ? base.fontDescriptor.fontDescriptorWithSymbolicTraits(traits) : null;
        const font = descriptor ? UIFont.fontWithDescriptorSize(descriptor, 0) : null;
        this.traitFonts.set(traits, font);
        return font;
    }

    private applyRuns(view: UITextViewNative, lineStart: number, runs: readonly StyledRun[]): void {
        const storage = view.textStorage;
        const extent = lineExtent(storage.string, lineStart);
        if (!extent) return;
        const lineEnd = extent.location + extent.length;
        storage.beginEditing();
        try {
            storage.setAttributesRange(this.baseAttributes(), extent);
            for (const run of runs) {
                const range = clampRange(lineStart + run.start, lineStart + run.end, lineEnd);
                const attributes = range && this.runAttributes(run.style);
                if (range && attributes) storage.addAttributesRange(attributes, range);
            }
        } finally {
            storage.endEditing();
        }
    }

    /**
     * Repaints every line that carries runs.
     *
     * Needed where Android needs nothing: setting `font` or `textColor` on a `UITextView` rewrites
     * the attributes of the WHOLE storage, so a palette or layout change erases the highlight. A
     * span survives the same call.
     */
    private repaintAll(): void {
        const view = this.view;
        if (!view) return;
        lineStartOffsets(view.textStorage.string).forEach((lineStart, line) => {
            const runs = this.runs.get(line);
            if (runs) this.applyRuns(view, lineStart, runs);
        });
    }

    // --- widget state ------------------------------------------------------------------------------

    private applyLayout(): void {
        const view = this.view;
        const layout = this.layout;
        if (!view || !layout) return;
        const size = view.font?.pointSize ?? DEFAULT_FONT_SIZE;
        this.baseFont = layout.monospace
            ? UIFont.monospacedSystemFontOfSizeWeight(size, FONT_WEIGHT_REGULAR)
            : UIFont.systemFontOfSize(size);
        this.traitFonts.clear();
        view.font = this.baseFont;
        view.editable = layout.editable;
        // `UITextView` has no cursor-visible property; the caret is drawn in `tintColor`, so a clear
        // tint is what hides it.
        view.tintColor = layout.cursorVisible ? this.caretColor(view) : UIColor.clearColor;
        this.appliedGutter = this.gutterPoints();
        view.textContainerInset = {
            top: layout.topMargin,
            left: layout.leftMargin + this.appliedGutter,
            bottom: layout.bottomMargin,
            right: layout.rightMargin,
        };
        view.setNeedsDisplay();
        this.repaintAll();
    }

    private caretColor(view: UITextViewNative): UIColorInstance | null {
        return this.palette ? uiColor(this.palette.foreground) : view.tintColor;
    }

    private applyPalette(): void {
        const view = this.view;
        const palette = this.palette;
        if (!view || !palette) return;
        view.backgroundColor = uiColor(palette.background);
        view.textColor = uiColor(palette.foreground);
        // `selectionBackground` has no counterpart: UIKit derives the selection fill from the tint
        // that also paints the caret, and GTK gives the two separate colours.
        if (this.layout?.cursorVisible !== false) view.tintColor = uiColor(palette.foreground);
        view.setNeedsDisplay();
        this.repaintAll();
    }

    private applySelection(): void {
        const view = this.view;
        if (!view) return;
        // An `NSRange` has no direction: a selection whose bound sits after the cursor arrives as
        // its normalised extent, and the buffer keeps the direction.
        const range = this.edited(this.selection.start, this.selection.end, view.textStorage.length);
        const current = view.selectedRange;
        if (current.location === range.location && current.length === range.length) return;
        this.applying = true;
        try {
            view.selectedRange = range;
        } finally {
            this.applying = false;
        }
    }

    // --- platform → host ---------------------------------------------------------------------------

    queueEdit(range: NSRangeValue, text: string): void {
        if (this.applying) return;
        this.queue.push({ start: range.location, removed: range.length, inserted: text });
    }

    flushEdits(): void {
        const view = this.view;
        const host = this.host;
        if (this.applying || !view || !host || !this.queue.pending) return;
        this.refreshStarts();
        for (const edit of this.queue.take()) host.onNativeEdit(edit.start, edit.removed, edit.inserted);
        const range = view.selectedRange;
        host.onNativeSelection(range.location, range.location + range.length);
    }

    selectionChanged(range: NSRangeValue): void {
        // Mid-edit the selection moves before the text edit reaches the buffer; `flushEdits` reports it then.
        if (this.applying || this.queue.pending) return;
        this.selection = { start: range.location, end: range.location + range.length };
        this.host?.onNativeSelection(this.selection.start, this.selection.end);
        this.view?.setNeedsDisplay();
    }

    invalidateGutter(): void {
        const view = this.view;
        if (!view) return;
        // A column's width follows its widget properties; its text is measured when it is drawn.
        if (this.gutterPoints() !== this.appliedGutter) this.applyLayout();
        else view.setNeedsDisplay();
    }

    // --- geometry ----------------------------------------------------------------------------------

    private measureText(text: string): number {
        return asNSString(text).sizeWithAttributes(this.baseAttributes()).width;
    }

    private numbersPoints(lineCount: number): number {
        if (!this.layout?.showLineNumbers) return 0;
        return gutterWidth(lineCount, this.measureText('0'), GUTTER_PADDING);
    }

    private columnPoints(column: GutterMetrics, measured: number): number {
        return Math.ceil(Math.max(column.widthRequest, measured) + column.marginStart + column.marginEnd);
    }

    /** The whole left gutter: the line numbers and every renderer's column, as last measured. */
    private gutterPoints(lineCount = this.lineCount): number {
        let total = this.numbersPoints(lineCount);
        (this.host?.gutterColumns() ?? []).forEach((column, at) => {
            total += this.columnPoints(column, this.measured[at] ?? 0);
        });
        return total;
    }

    /** The line fragment of logical line `line`, in text-container coordinates; null past the last line. */
    private fragmentRect(view: UITextViewNative, line: number): CGRect | null {
        const starts = this.starts;
        if (line < 0 || line >= starts.length) return null;
        const manager = view.layoutManager;
        const offset = starts[line];
        // A text ending in a newline has a trailing empty line with no glyph at all: UIKit keeps its
        // geometry in `extraLineFragmentRect` instead of in a fragment.
        if (offset >= view.textStorage.length) return manager.extraLineFragmentRect;
        return manager.lineFragmentRectForGlyphAtIndexEffectiveRange(
            manager.glyphIndexForCharacterAtIndex(offset),
            null,
        );
    }

    private lineTop(view: UITextViewNative, line: number): number {
        const rect = this.fragmentRect(view, line);
        return rect ? rect.origin.y + view.textContainerInset.top : 0;
    }

    private lineBottom(view: UITextViewNative, line: number): number {
        const rect = this.fragmentRect(view, line);
        return rect ? rect.origin.y + rect.size.height + view.textContainerInset.top : 0;
    }

    private caretLine(view: UITextViewNative): number {
        const range = view.selectedRange;
        return lineAtOffset(this.starts, range.location + range.length);
    }

    // --- drawing -----------------------------------------------------------------------------------

    // `UIRectFill` copies rather than blends, which is why the band is drawn BEFORE the text and the
    // gutter band after it: each one owns its pixels outright, as the Android paints do.
    private fill(color: number, x: number, y: number, width: number, height: number): void {
        uiColor(color).setFill();
        UIRectFill({ origin: { x, y }, size: { width, height } });
    }

    private draw(text: string, x: number, y: number, color: number): void {
        asNSString(text).drawAtPointWithAttributes(
            { x, y },
            { ...this.baseAttributes(), [NSForegroundColorAttributeName]: uiColor(color) },
        );
    }

    drawBehind(view: UITextViewNative): void {
        const palette = this.palette;
        if (!palette || !this.layout?.highlightCurrentLine || palette.currentLineBackground === 0) return;
        const line = this.caretLine(view);
        const top = this.lineTop(view, line);
        const height = this.lineBottom(view, line) - top;
        if (height <= 0) return;
        this.fill(palette.currentLineBackground, view.contentOffset.x, top, view.bounds.size.width, height);
    }

    drawGutter(view: UITextViewNative): void {
        const palette = this.palette;
        const host = this.host;
        if (!palette || !host) return;
        const showNumbers = this.layout?.showLineNumbers === true;
        const lineCount = this.starts.length;
        const viewTop = view.contentOffset.y;
        const visible = visibleLines(
            lineCount,
            (line) => this.lineTop(view, line),
            (line) => this.lineBottom(view, line),
            viewTop,
            viewTop + view.bounds.size.height,
        );
        const columns = visible
            ? host.queryGutter(visible.first, visible.last)
            : host.gutterColumns().map((column) => ({ ...column, cells: [] }));
        if (!showNumbers && columns.length === 0) return;
        columns.forEach((column, at) => {
            // Plain text only: Pango markup is read for its text, not painted with its styles.
            const widest = column.cells.reduce((width, cell) => Math.max(width, this.measureText(cell.text)), 0);
            this.measured[at] = Math.max(widest, this.measured[at] ?? 0);
        });
        this.measured.length = columns.length;
        const total = this.gutterPoints(lineCount);
        if (total !== this.appliedGutter) {
            this.appliedGutter = total;
            // UIKit forbids changing the container inset from inside `drawRect:` — it re-enters
            // layout mid-draw. A task is the main-thread deferral `View.post` gives the Android side.
            setTimeout(() => this.applyLayout(), 0);
        }
        const left = view.contentOffset.x;
        this.fill(palette.lineNumberBackground, left, viewTop, total, view.bounds.size.height);
        if (!visible) return;

        const current = emphasisedLine(this.layout?.highlightCurrentLine === true, this.caretLine(view));
        let x = left;
        const drawNumbers = (): void => {
            const width = this.numbersPoints(lineCount);
            for (let line = visible.first; line <= visible.last; line++) {
                const isCurrent = line === current;
                const top = this.lineTop(view, line);
                if (isCurrent && palette.currentLineNumberBackground !== 0) {
                    this.fill(palette.currentLineNumberBackground, x, top, width, this.lineBottom(view, line) - top);
                }
                const label = String(line + 1);
                // `drawAtPoint` takes the TOP-LEFT corner where Android's `drawText` takes the
                // baseline, so the fragment's own top is the point and no baseline is read; and it
                // has no alignment, so a right-aligned number is placed by its measured width.
                this.draw(
                    label,
                    x + width - GUTTER_PADDING - this.measureText(label),
                    top,
                    isCurrent ? palette.currentLineNumberForeground : palette.lineNumberForeground,
                );
            }
            x += width;
        };
        let numbersDrawn = !showNumbers;
        columns.forEach((column, at) => {
            if (!numbersDrawn && column.position >= 0) {
                drawNumbers();
                numbersDrawn = true;
            }
            column.cells.forEach((cell, index) => {
                if (cell.text === '') return;
                this.draw(
                    cell.text,
                    x + column.marginStart,
                    this.lineTop(view, visible.first + index),
                    palette.lineNumberForeground,
                );
            });
            x += this.columnPoints(column, this.measured[at]);
        });
        if (!numbersDrawn) drawNumbers();
    }
}

export function createEditorDriver(): NativeEditorDriver {
    return new IosEditorDriver();
}
