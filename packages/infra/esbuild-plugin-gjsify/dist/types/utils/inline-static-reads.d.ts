/**
 * Run the inliner on a source string. Returns the rewritten source (or the
 * original string when no inlining applied) and the count of edits applied.
 *
 * Safe to call on any JS source. Files that don't reference `readFileSync` /
 * `readdirSync` / `existsSync` skip the AST parse entirely (cheap fast path).
 */
export declare function inlineStaticReads(src: string, sourceFilePath: string): {
    contents: string;
    inlined: number;
};
