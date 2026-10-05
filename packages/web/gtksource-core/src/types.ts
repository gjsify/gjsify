/** Something in a data file this package does not model; reported with where it sits, never dropped silently. */
export interface Unsupported {
    readonly construct: string;
    /** A readable path, e.g. `definitions/context[id=string]/include/context[id=escape]`. */
    readonly where: string;
}

/** A `<match>`, `<start>` or `<end>` pattern, still in GRegex dialect; see {@link translateRegex}. */
export interface PatternSource {
    readonly source: string;
    readonly extended: boolean;
}

/**
 * One `<context>`. Exactly one of these shapes, as in GtkSourceView:
 * a simple match (`match`), a start/end span (`start` + `end`, children in `include`),
 * a keyword list (`keywords`, with `prefix`/`suffix`), a container (only `include`),
 * or a reference to another context (`ref`).
 */
export interface ContextNode {
    readonly id?: string;
    readonly styleRef?: string;
    readonly endAtLineEnd: boolean;
    /** Capture group a sub-pattern context colours instead of the whole parent match. */
    readonly subPattern?: number;
    readonly ref?: string;
    readonly match?: PatternSource;
    readonly start?: PatternSource;
    readonly end?: PatternSource;
    readonly keywords: readonly string[];
    readonly prefix?: string;
    readonly suffix?: string;
    readonly include: readonly ContextNode[];
}

export interface LanguageStyle {
    readonly id: string;
    readonly name?: string;
    /** `def:keyword` and the like: the scheme style this language style falls back to. */
    readonly mapTo?: string;
}

export interface LanguageDefinition {
    readonly id: string;
    readonly name?: string;
    readonly version?: string;
    readonly section?: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly styles: readonly LanguageStyle[];
    /** The top-level `<definitions>` contexts; the one whose id equals the language id is the entry point. */
    readonly definitions: readonly ContextNode[];
    readonly unsupported: readonly Unsupported[];
}

export interface SchemeColor {
    readonly name: string;
    readonly value: string;
}

export interface SchemeStyle {
    readonly name: string;
    readonly foreground?: string;
    readonly background?: string;
    readonly lineBackground?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly strikethrough?: boolean;
    readonly underline?: string;
    /** Attributes this package does not interpret (`scale`, `underline-color`, `use-style`, …), kept verbatim. */
    readonly extra: Readonly<Record<string, string>>;
}

export interface StyleSchemeDefinition {
    readonly id: string;
    readonly name?: string;
    readonly parentScheme?: string;
    readonly version?: string;
    readonly authors: readonly string[];
    readonly colors: readonly SchemeColor[];
    readonly styles: readonly SchemeStyle[];
    readonly unsupported: readonly Unsupported[];
}

/** A scheme style with its colour names replaced by the colour values. */
export interface ResolvedStyle {
    readonly name: string;
    /** The id of the scheme the style was found in (the requested one or an ancestor). */
    readonly foundIn: string;
    readonly foreground?: string;
    readonly background?: string;
    readonly lineBackground?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly strikethrough?: boolean;
    readonly underline?: string;
}
