// GtkSource.StyleScheme and GtkSource.StyleSchemeManager over `@gjsify/gtksource-core`'s parsed
// schemes. No file system: schemes come in as XML strings or parsed definitions, because the
// consumer owns where its data files live (Android assets are not a directory GJS-style
// `append_search_path()` could walk).

import { parseStyleScheme, resolveStyle } from './style.js';
import type { ResolvedStyle, StyleSchemeDefinition } from './types.js';

import { parseColor } from './color.js';
import { FALLBACK_DARK_ID, FALLBACK_LIGHT_ID, fallbackDarkScheme, fallbackLightScheme } from './fallback-schemes.js';

export type ColorSchemeVariant = 'light' | 'dark';

export class StyleScheme {
    constructor(
        readonly definition: StyleSchemeDefinition,
        private readonly lookup: (id: string) => StyleSchemeDefinition | undefined,
    ) {}

    get id(): string {
        return this.definition.id;
    }

    get name(): string {
        return this.definition.name ?? this.definition.id;
    }

    get parentId(): string | undefined {
        return this.definition.parentScheme;
    }

    /** `text`, `line-numbers`, `def:keyword`, …; throws on a parent-scheme loop or a missing parent. */
    getStyle(name: string): ResolvedStyle | undefined {
        return resolveStyle(this.definition, name, this.lookup);
    }
}

/** The colours the view itself paints — everything that is not a syntax token. ARGB ints. */
export interface EditorPalette {
    readonly dark: boolean;
    readonly foreground: number;
    readonly background: number;
    readonly selectionBackground: number;
    readonly currentLineBackground: number;
    readonly lineNumberForeground: number;
    readonly lineNumberBackground: number;
    readonly currentLineNumberForeground: number;
    readonly currentLineNumberBackground: number;
}

const LIGHT_DEFAULTS = {
    foreground: 0xff2e3436 | 0,
    background: 0xffffffff | 0,
    selection: 0xffa8c8f0 | 0,
    lineNumber: 0xff8a8f92 | 0,
};
const DARK_DEFAULTS = {
    foreground: 0xffebebeb | 0,
    background: 0xff1e1e1e | 0,
    selection: 0xff35516e | 0,
    lineNumber: 0xff8a8a8a | 0,
};

/** Reads the palette off a scheme; a style the scheme (and its parents) lack takes a neutral default. */
export function paletteOf(scheme: StyleScheme, variant: ColorSchemeVariant): EditorPalette {
    const defaults = variant === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
    const color = (value: string | undefined): number | undefined =>
        value === undefined ? undefined : parseColor(value);
    const text = scheme.getStyle('text');
    const selection = scheme.getStyle('selection');
    const currentLine = scheme.getStyle('current-line');
    const numbers = scheme.getStyle('line-numbers');
    const currentNumber = scheme.getStyle('current-line-number');

    const foreground = color(text?.foreground) ?? defaults.foreground;
    const background = color(text?.background) ?? defaults.background;
    const lineNumberForeground = color(numbers?.foreground) ?? defaults.lineNumber;
    const lineNumberBackground = color(numbers?.background) ?? background;
    const currentLineBackground = color(currentLine?.background) ?? 0;
    return {
        dark: variant === 'dark',
        foreground,
        background,
        selectionBackground: color(selection?.background) ?? defaults.selection,
        currentLineBackground,
        lineNumberForeground,
        lineNumberBackground,
        currentLineNumberForeground: color(currentNumber?.foreground) ?? foreground,
        currentLineNumberBackground: color(currentNumber?.background) ?? currentLineBackground,
    };
}

export class StyleSchemeManager {
    private static instance: StyleSchemeManager | undefined;

    /** `GtkSource.StyleSchemeManager.get_default()`. */
    static getDefault(): StyleSchemeManager {
        return (StyleSchemeManager.instance ??= new StyleSchemeManager());
    }

    /** GJS spelling of {@link getDefault}. */
    static get_default(): StyleSchemeManager {
        return StyleSchemeManager.getDefault();
    }

    private readonly definitions = new Map<string, StyleSchemeDefinition>();
    private readonly fallbacks = new Set<string>();

    /** @param withFallbacks register this package's own `Adwaita`/`Adwaita-dark` stand-ins. */
    constructor(withFallbacks = true) {
        if (!withFallbacks) return;
        for (const xml of [fallbackLightScheme, fallbackDarkScheme]) {
            const definition = parseStyleScheme(xml);
            this.definitions.set(definition.id, definition);
            this.fallbacks.add(definition.id);
        }
    }

    get schemeIds(): string[] {
        return [...this.definitions.keys()].sort();
    }

    /** Whether `id` is still this package's stand-in rather than a scheme the consumer supplied. */
    isFallback(id: string): boolean {
        return this.fallbacks.has(id);
    }

    /** Adds a scheme, replacing one with the same id (that is how the real Adwaita replaces the stand-in). */
    addScheme(definition: StyleSchemeDefinition): StyleScheme {
        this.definitions.set(definition.id, definition);
        this.fallbacks.delete(definition.id);
        return this.wrap(definition);
    }

    addSchemeFromXml(xml: string): StyleScheme {
        return this.addScheme(parseStyleScheme(xml));
    }

    getScheme(id: string): StyleScheme | null {
        const definition = this.definitions.get(id);
        return definition ? this.wrap(definition) : null;
    }

    /** GJS spelling of {@link getScheme}. */
    get_scheme(id: string): StyleScheme | null {
        return this.getScheme(id);
    }

    /** The scheme to use when nothing was chosen: the stand-in or real `Adwaita` / `Adwaita-dark`. */
    getDefaultFor(variant: ColorSchemeVariant): StyleScheme | null {
        return this.getScheme(variant === 'dark' ? FALLBACK_DARK_ID : FALLBACK_LIGHT_ID);
    }

    /**
     * The same scheme for the other mode, found by the `<id>-dark` naming convention
     * (`Learn6502` / `Learn6502-dark`). `scheme` itself when it already is the asked variant
     * or has no sibling — never a guess across unrelated schemes.
     */
    variantOf(scheme: StyleScheme, variant: ColorSchemeVariant): StyleScheme {
        const isDark = scheme.id.endsWith('-dark');
        if (isDark === (variant === 'dark')) return scheme;
        const siblingId = isDark ? scheme.id.slice(0, -'-dark'.length) : `${scheme.id}-dark`;
        return this.getScheme(siblingId) ?? scheme;
    }

    private wrap(definition: StyleSchemeDefinition): StyleScheme {
        return new StyleScheme(definition, (id) => this.definitions.get(id));
    }
}
