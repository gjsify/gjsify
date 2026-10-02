// What an `.oxfmtrc` says about the BYTES ADR 0088's `.d.blp.ts` sidecar is written in.
//
// THE INCIDENT
//
// The sidecar emitter read `printWidth` out of the repository's own `.oxfmtrc.json` — into a
// constant, with a comment saying it did — and hardcoded a FOUR-SPACE indent beside it, which
// is also what this repository's `.oxfmtrc.json` happens to say. So the emitter agreed with the
// formatter on the two `oxfmt --check` runs in CI and disagreed with every other project: a
// `tabWidth: 2` consumer (kurier, Learn6502) got a sidecar the formatter immediately reflowed,
// and `gjsify format --check` was red on a file nobody hand-wrote. The emitter could not notice,
// because the only formatter it had ever met was the one its constants were copied from.
//
// WHY THE OPTIONS ARE MODELLED RATHER THAN RUN THROUGH THE ENGINE
//
// `oxfmt` ships a JS `format()` that would answer every one of them exactly, and it is
// deliberately not called from here, for three reasons that all say the same thing:
//
//   1. This package HAS NO BUILD STEP, and `scripts/check-blueprint-sidecars.mjs` — the gate that
//      holds every committed sidecar — runs as plain `node` in `tree-checks`, a job that installs
//      the workspace and does NOT build it. A dependency on a native formatter binding is a
//      dependency that job cannot load.
//   2. `format()` is ASYNC and the whole emitter surface is synchronous: the drift gate and
//      `gjsify blueprint types` both compare bytes in a loop, and an async emitter makes the
//      comparison the second thing every call site has to remember.
//   3. The emitter writes SIX distinct line shapes. Modelling nine options for six lines is less
//      code than a native round-trip per sidecar, and it is auditable in one file — where a
//      formatter call is a black box whose layout rules drift with the formatter's version.
//
// What the model owes the formatter is therefore EVIDENCE, not trust: `check-blueprint-sidecar-
// format.mjs` runs the real engine over the emitter's output for every option below, under this
// repository's `.oxfmtrc.json` and under a `tabWidth: 2` / `useTabs` pair that is not this
// repository's, and holds the bytes equal. A modelled rule the formatter disagrees with is a red
// gate, not a silent drift.
//
// WHAT IS NOT MODELLED, AND WHY
//
//   - `arrowParens`, `bracketSameLine`, `jsxSingleQuote`: the emitter writes no arrow function,
//     no JSX and no markup, so no byte can depend on them.
//   - `bracketSpacing`: MEASURED to leave the emitted shapes untouched — it only decides the
//     padding inside a `{}` that fits on one line, and every object literal here is written
//     multi-line, where the brace is followed by a newline and there is nothing to pad.
//   - `.editorconfig`: oxfmt reads it for `tabWidth` / `useTabs` / `singleQuote` / `printWidth`
//     / `endOfLine` when the `.oxfmtrc` is SILENT about them, and this model answers from the
//     `.oxfmtrc` alone. An explicit option beats `.editorconfig` in oxfmt (its own option docs
//     say so), so every project that sets these in its formatter config — which is what
//     `gjsify format --init` writes — is answered correctly; a project that configures
//     indentation ONLY in `.editorconfig` gets oxfmt's documented defaults here. That is the
//     declared limit, and it is the narrow direction: the two measured consumers set
//     `tabWidth` in `.oxfmtrc.json`.
//
// ONE PARSER, AND WHY IT LIVES HERE
//
// An `.oxfmtrc.json` is JSONC: this repository's own carries `//` comments explaining why
// `**/lib` is deliberately absent from `ignorePatterns`, and oxfmt accepts a trailing comma.
// `JSON.parse` therefore refuses the one config file in the tree that matters most. The scanner
// is the same two-pass shape the CLI's `parseJsonc` used (a string-aware pass that drops
// comments, then one that drops trailing commas, with string contents never touched) and it
// lives here because this package is where "what does an `.oxfmtrc` say" is a question: the
// emitter is the thing those options are for. The CLI imports it from here rather than keeping
// the copy.
//
// ONE WALK, AND WHY IT IS HERE RATHER THAN IN EACH CALLER
//
// Three callers need the rc — the drift gate, `gjsify blueprint types`, and the bundler plugin —
// and each already had its own idea of where to look: the CLI a `findOxfmtConfig` helper, the
// gate a copy of it, the plugin nothing at all. Three walks means three answers to "which file
// does the formatter read", and the third one is the one that silently emits 4-space sidecars
// into a `tabWidth: 2` tree. `emitFormatForTree` is the ONE walk, beside the ONE mapping, so the
// pair cannot disagree; a caller that wants different discovery can pass a different start
// directory, which is a parameter rather than a fork.
//
// `node:fs` / `node:path` are here and nowhere else in this package, deliberately: `sidecarPathFor`
// takes a path from its caller because the HOST's separator is the answer (`@gjsify/node-path`
// picks win32 or posix per runtime), and this walk is not that question — it starts from a
// directory the caller already has and walks UP, where the separator is a POSIX join either way.

/**
 * oxfmt's own defaults for every option this model reads, as its bundled
 * `configuration_schema.json` and `index.d.ts` state them — the schema carries no `default`
 * key, so these are read off the option docs and are MEASURED by
 * `check-blueprint-sidecar-format.mjs`, which formats with `{}` and with each option in turn.
 *
 * NOT this repository's values. A caller that passes no config gets oxfmt's answer, which is the
 * answer a project with no `.oxfmtrc` gets; a caller that passes this repository's gets this
 * repository's. The constant that caused the incident is gone: there is no default here that
 * was copied from a particular rc file.
 */
const OXFMT_DEFAULTS = Object.freeze({
    printWidth: 100,
    quoteProps: 'as-needed',
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: 'all',
    useTabs: false,
});

/** oxfmt's `endOfLine`, as the bytes it writes. Its default is `lf`. */
const END_OF_LINE = Object.freeze({ lf: '\n', crlf: '\r\n', cr: '\r' });

/** `quoteProps` as oxfmt spells it. Anything else is the default, which is what oxfmt does. */
const QUOTE_PROPS = new Set(['as-needed', 'consistent', 'preserve']);

/** A positive integer, or the default. oxfmt would reject a nonsense width; this clamps. */
function positiveInteger(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The emitter's options for one project, derived from its `.oxfmtrc`.
 *
 * Every field is already the BYTE, not the option: the indent is a string of tabs or spaces,
 * the quote is the character, the semicolon is `''` or `';'`. That is what makes the emitters
 * below unable to disagree with this mapping — there is no second place where `singleQuote` is
 * turned into a quote character.
 *
 * @param {object} [config] the parsed `.oxfmtrc`, or nothing for oxfmt's own defaults
 * @returns {import('./oxfmt-config.d.mts').EmitFormat}
 */
export function emitFormatFor(config) {
    const rc = config ?? {};
    return {
        /** `useTabs`, else `tabWidth` spaces. */
        indent: rc.useTabs === true ? '\t' : ' '.repeat(positiveInteger(rc.tabWidth, OXFMT_DEFAULTS.tabWidth)),
        /** The width the id tuple is reflowed at — see `generate-widget-methods.mjs` § PRINT_WIDTH. */
        printWidth: positiveInteger(rc.printWidth, OXFMT_DEFAULTS.printWidth),
        /** `singleQuote`. */
        quote: rc.singleQuote === true ? "'" : '"',
        /** `semi`, as the statement terminator rather than the flag. */
        semi: rc.semi === false ? '' : ';',
        /** `quoteProps`, which decides whether a bare key beside a quoted one is quoted too. */
        quoteProps: QUOTE_PROPS.has(rc.quoteProps) ? rc.quoteProps : OXFMT_DEFAULTS.quoteProps,
        /**
         * `trailingComma`, as the comma a reflowed tuple's last id carries.
         *
         * `'es5'` and `'all'` agree here: the only comma-separated construct this emitter
         * reflows is an ARRAY, which `es5` already covers, so only `'none'` differs.
         */
        trailingComma: rc.trailingComma !== 'none',
        /** `endOfLine`, as the line terminator every emitted line joins with. */
        eol: END_OF_LINE[rc.endOfLine] ?? END_OF_LINE.lf,
    };
}

/**
 * One `.oxfmtrc`'s text as the object `emitFormatFor` reads.
 *
 * JSONC, because `.oxfmtrc.json` is JSON-with-comments as oxfmt defines it: this repository's
 * own carries `//` notes inside `ignorePatterns` that explain a decision rather than restate
 * one, and `JSON.parse` refuses the file. Trailing commas are dropped too, for the same reason.
 *
 * Two passes rather than one because a comment's text may contain a comma followed by a
 * `}` (`// drop the last,}` is not unusual in a config) and a string's contents are never
 * touched: `"https://example.test"` is a value, and the pass below skips from the opening quote
 * to its closing one with escapes honoured, so the `//` in it is not a comment.
 *
 * @param {string} text the file's bytes
 * @returns {Record<string, unknown>} the parsed config; an empty object for an empty file
 */
export function parseOxfmtrc(text) {
    const pass = (src, drop) => {
        let out = '';
        for (let i = 0; i < src.length;) {
            if (src[i] === '"') {
                let j = i + 1;
                while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
                out += src.slice(i, j + 1);
                i = j + 1;
                continue;
            }
            const skip = drop(src, i);
            if (skip > 0) i += skip;
            else out += src[i++];
        }
        return out;
    };
    const uncommented = pass(text, (src, i) => {
        if (src.startsWith('//', i)) {
            const nl = src.indexOf('\n', i);
            return (nl === -1 ? src.length : nl) - i;
        }
        if (src.startsWith('/*', i)) {
            const end = src.indexOf('*/', i + 2);
            return (end === -1 ? src.length : end + 2) - i;
        }
        return 0;
    });
    if (uncommented.trim() === '') return {};
    return JSON.parse(pass(uncommented, (src, i) => (src[i] === ',' && /^\s*[}\]]/.test(src.slice(i + 1)) ? 1 : 0)));
}
