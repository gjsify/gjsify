// The types for `corpus/manifest.mjs`, hand-written for the same reason `src/index.d.mts` is:
// there is no build step in this package, so a `.d.mts` is the declaration and not an output.
//
// WHY THIS FILE EXISTS AT ALL, since the manifest already carries JSDoc typedefs. Those serve a
// `.mjs` reader — `scripts/check-blueprint-corpus.mjs` — and reach no TypeScript consumer,
// because `exports["./corpus"]` named a `.mjs` and nothing else: a `.ts` importing it got TS7016
// and every row typed `any`. The consumer that wanted it is
// `@gjsify/vite-plugin-blueprint`'s spec, which used to hand-copy a refusal's LINE NUMBER and
// was silently wrong the day `refused/namespace-without-vocabulary.blp` moved its construct four
// lines up. A second copy of a number the manifest already states is the thing to delete; this
// is what lets a typed consumer read the first one.

/** The reference implementation whose answers the `.ui` files hold. */
export declare const ORACLE: {
    readonly tool: string;
    readonly version: string;
    readonly recordedOn: string;
};

export interface CorpusRule {
    /** File name under `rules/`. */
    readonly file: string;
    /** The ONE language rule this file exists to pin down. */
    readonly isolates: string;
    /** What the golden shows that reading the `.blp` does not. */
    readonly surprise?: string;
}

export interface CorpusRefusal {
    /** File name under `refused/`. */
    readonly file: string;
    /** The ONE construct outside the subset this file reaches. */
    readonly construct: string;
    /** What `blueprint-compiler` does with the same file. */
    readonly oracle: 'compiles' | 'refuses';
    /** What the second exit, `src/project.mjs`, does with the same file. */
    readonly projection: 'refuses' | 'projects';
    /** The line the in-repo error must name. */
    readonly line: number;
    /** Text the in-repo error must contain, so the refusal is by NAME. */
    readonly names: string;
}

export interface CorpusRealFile {
    /** The golden's base name under `real/`. */
    readonly slug: string;
    /** Repo-relative path of the `.blp` this repo already builds. */
    readonly source: string;
}

export declare const CORPUS_RULES: readonly CorpusRule[];
export declare const CORPUS_REFUSALS: readonly CorpusRefusal[];
export declare const CORPUS_REAL_FILES: readonly CorpusRealFile[];
