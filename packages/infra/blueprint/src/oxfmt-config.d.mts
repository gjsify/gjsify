// Declarations for `oxfmt-config.mjs` — the bytes ADR 0088's sidecar must be written in.
//
// Hand-written beside the implementation, for the reason `ast.d.mts` § WHY A DECLARATION FILE AND
// NOT A `.ts` gives: this package has no build step, because the gate that runs it installs the
// workspace and does not build it.

/**
 * One project's formatting options, already resolved to BYTES.
 *
 * Every field is the character or the string the emitter writes rather than the `.oxfmtrc` flag
 * it came from, so `singleQuote` is answered in exactly one place — `emitFormatFor` — and an
 * emitter cannot spell a quote the project did not ask for.
 *
 * The fields are the oxfmt options that change a line this package emits, and only those: see
 * `oxfmt-config.mjs` § WHAT IS NOT MODELLED for the three that cannot and the `.editorconfig`
 * that is a declared limit.
 */
export interface EmitFormat {
    /** What one indentation level is: a tab, or `tabWidth` spaces. `useTabs`, else `tabWidth`. */
    readonly indent: string;
    /** The width a line is reflowed at. `printWidth`. */
    readonly printWidth: number;
    /** `'` or `"`, for every string literal the emitter writes. `singleQuote`. */
    readonly quote: "'" | '"';
    /** The statement terminator: `';'` or `''`. `semi`. */
    readonly semi: string;
    /** Whether a bare key beside a key that NEEDS quotes is quoted too. `quoteProps`. */
    readonly quoteProps: 'as-needed' | 'consistent' | 'preserve';
    /** The comma the last id of a REFLOWED tuple carries. `trailingComma`, `false` for `'none'`. */
    readonly trailingComma: boolean;
    /** The line terminator every emitted line joins with. `endOfLine`. */
    readonly eol: string;
}

/**
 * The emitter's options for one project, from that project's `.oxfmtrc`.
 *
 * Called with nothing it answers with oxfmt's OWN defaults (`tabWidth: 2`, `printWidth: 100`,
 * `singleQuote: false`, `semi: true`, `quoteProps: 'as-needed'`, `trailingComma: 'all'`,
 * `useTabs: false`, `endOfLine: 'lf'`) — never with one particular repository's values, which is
 * the shape that produced two tabWidth-2 consumers' red `oxfmt --check`.
 *
 * A field whose value oxfmt would reject — a non-integer `tabWidth`, an unknown `quoteProps` —
 * falls back to oxfmt's default, which is what oxfmt itself does with it.
 */
export declare function emitFormatFor(config?: Record<string, unknown>): EmitFormat;

/**
 * The emitter options for the tree `from` belongs to, from the nearest `.oxfmtrc` above it.
 *
 * This is the answer `gjsify format` itself reaches: the same two names (`.oxfmtrc`, then
 * `.oxfmtrc.json`), in the same order, walking up to the same 12 levels. A sidecar written
 * against any other file is one that formatter reflows, so the walk is not re-invented per
 * caller — three callers had three ideas of where to look, and the third was the one that
 * emitted 4-space sidecars into a `tabWidth: 2` tree.
 *
 * No `.oxfmtrc` anywhere above `from` gives oxfmt's own defaults, the same answer
 * {@link emitFormatFor} gives for no config.
 */
export declare function emitFormatForTree(from: string): EmitFormat;

/**
 * One `.oxfmtrc`'s text as the object {@link emitFormatFor} reads.
 *
 * JSONC: `.oxfmtrc.json` carries `//` comments and may carry a trailing comma, and this
 * repository's own config is commented. An empty or whitespace-only file is `{}` — a config that
 * says nothing is a config that means oxfmt's defaults. A malformed one throws `SyntaxError`
 * from `JSON.parse`, naming the position, which is what a formatter does with it too.
 */
export declare function parseOxfmtrc(text: string): Record<string, unknown>;
