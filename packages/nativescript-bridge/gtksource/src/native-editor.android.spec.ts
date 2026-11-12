// The text size of the Android driver, against a recording `EditText`. The driver reads `android.*`
// as a global and imports nothing from `@nativescript/core`, so it builds and runs on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import type { EditorHost, EditorLayout, EditorPalette } from '@gjsify/gtksource-core';

import type { AndroidCanvas } from './android-types.js';
import { DEFAULT_FONT_SIZE } from './font-size.js';
import { createEditorDriver } from './native-editor.android.js';

const COMPLEX_UNIT_SP = 2;
/** Pixels per sp, so a size in sp and the size `getTextSize()` answers can never be equal by accident. */
const SCALE = 3.5;

class FakePaint {
    static all: FakePaint[] = [];
    sizes: number[] = [];
    constructor() {
        FakePaint.all.push(this);
    }
    setColor(): void {}
    setTextSize(size: number): void {
        this.sizes.push(size);
    }
    setTypeface(): void {}
    setTextAlign(): void {}
    measureText(text: string): number {
        return text.length * 8;
    }
}

class FakeEditText {
    driver: unknown;
    textSizes: Array<{ unit: number; size: number }> = [];
    private pixels = 0;
    getText() {
        return { length: () => 0, toString: () => '' };
    }
    setText(): void {}
    getSelectionStart(): number {
        return 0;
    }
    getSelectionEnd(): number {
        return 0;
    }
    getResources() {
        return { getDisplayMetrics: () => ({ density: SCALE }) };
    }
    setTextSize(unit: number, size: number): void {
        this.textSizes.push({ unit, size });
        this.pixels = unit === COMPLEX_UNIT_SP ? size * SCALE : size;
    }
    getTextSize(): number {
        return this.pixels;
    }
    getKeyListener(): unknown {
        return null;
    }
    getLayout() {
        return {
            getLineCount: () => 1,
            getLineTop: () => 0,
            getLineBottom: () => 20,
            getLineBaseline: () => 15,
            getLineForOffset: () => 0,
        };
    }
    getTypeface(): unknown {
        return null;
    }
    getExtendedPaddingTop = () => 0;
    getScrollX = () => 0;
    getScrollY = () => 0;
    getWidth = () => 300;
    getHeight = () => 200;
    post = () => true;
    setInputType = () => {};
    setHorizontallyScrolling = () => {};
    setGravity = () => {};
    addTextChangedListener = () => {};
    setTypeface = () => {};
    setPadding = () => {};
    setKeyListener = () => {};
    setCursorVisible = () => {};
    setBackgroundColor = () => {};
    setTextColor = () => {};
    setHighlightColor = () => {};
    invalidate = () => {};
}

const installAndroid = (): void => {
    Object.assign(globalThis, {
        android: {
            widget: { EditText: { extend: () => FakeEditText } },
            graphics: {
                Paint: Object.assign(FakePaint, { Align: { RIGHT: 'right', LEFT: 'left' } }),
                Typeface: { MONOSPACE: 'monospace', DEFAULT: 'default' },
            },
            util: { TypedValue: { COMPLEX_UNIT_SP } },
            view: { Gravity: { TOP: 48, START: 8388611 } },
            text: {
                InputType: { TYPE_CLASS_TEXT: 1, TYPE_TEXT_FLAG_MULTI_LINE: 2, TYPE_TEXT_FLAG_NO_SUGGESTIONS: 4 },
                TextWatcher: class {},
            },
        },
        java: { lang: { Runnable: class {} } },
    });
};

const LAYOUT: EditorLayout = {
    showLineNumbers: true,
    monospace: true,
    editable: true,
    highlightCurrentLine: false,
    cursorVisible: true,
    leftMargin: 12,
    rightMargin: 12,
    topMargin: 12,
    bottomMargin: 12,
};

const PALETTE = {
    dark: false,
    foreground: 1,
    background: 2,
    selectionBackground: 3,
    currentLineBackground: 0,
    lineNumberForeground: 4,
    lineNumberBackground: 5,
    currentLineNumberForeground: 6,
    currentLineNumberBackground: 0,
} satisfies EditorPalette;

const HOST = {
    gutterColumns: () => [],
    queryGutter: () => [],
} as unknown as EditorHost;

const attached = () => {
    installAndroid();
    const driver = createEditorDriver();
    driver.bind(HOST);
    driver.setLayout(LAYOUT);
    driver.setPalette(PALETTE);
    const view = driver.createNativeView({}) as unknown as FakeEditText;
    return { driver, view };
};

export const NativeEditorAndroidTest = async () => {
    await describe('the Android editor text size', async () => {
        await it('applies the 14.67 default in sp when nothing sets a size', () => {
            const { driver, view } = attached();
            driver.attach(view);
            expect(view.textSizes.at(-1)).toStrictEqual({ unit: COMPLEX_UNIT_SP, size: DEFAULT_FONT_SIZE });
            expect(DEFAULT_FONT_SIZE).toBe(14.67);
        });

        await it('lets an explicit font-size override the default', () => {
            const { driver, view } = attached();
            driver.setFontSize(20);
            driver.attach(view);
            expect(view.textSizes.at(-1)).toStrictEqual({ unit: COMPLEX_UNIT_SP, size: 20 });
        });

        await it('resizes a live view when the font-size changes, and back on clearing it', () => {
            const { driver, view } = attached();
            driver.attach(view);
            driver.setFontSize(18);
            expect(view.textSizes.at(-1)?.size).toBe(18);
            driver.setFontSize(undefined);
            expect(view.textSizes.at(-1)?.size).toBe(DEFAULT_FONT_SIZE);
        });

        await it('paints the line numbers at the size the view has', () => {
            const { driver, view } = attached();
            driver.setFontSize(20);
            driver.attach(view);
            const drawn: string[] = [];
            const canvas = { drawRect: () => {}, drawText: (text: string) => drawn.push(text) } as AndroidCanvas;
            (driver as unknown as { drawGutter(v: FakeEditText, c: AndroidCanvas): void }).drawGutter(view, canvas);
            expect(drawn).toStrictEqual(['1']);
            const text = FakePaint.all.findLast((paint) => paint.sizes.length > 0);
            expect(text?.sizes.at(-1)).toBe(20 * SCALE);
        });
    });
};
