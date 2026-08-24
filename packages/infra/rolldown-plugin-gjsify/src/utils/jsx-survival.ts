// Raw JSX surviving into an emitted bundle — the syntax-level oracle, and why it is a
// syntax check rather than a pattern match.
//
// `jsx: "preserve"` is the setting `babel-preset-solid` and the Vue SFC compiler need:
// it tells oxc to leave JSX alone so the framework's own compiler can handle it. When
// that compiler is absent, raw JSX travels all the way into the `.gjs.mjs` and NOTHING
// between `gjsify build` and the artifact notices — rolldown emits it, the build exits
// 0, and GJS refuses the file at LOAD, before one line runs. MEASURED on a two-line
// `.tsx` built `--app gjs --globals none`: exit 0, `r=<box title="hi"/>` in the bundle,
// and `SyntaxError: expected expression, got '<'` under `gjs -m`.
//
// A pattern match is the wrong oracle in both directions: `<div` hits a string inside a
// test name, and misses `<Foo.Bar>`, `<>` and every tag the pattern did not think of.
// The right question is the one GJS asks — "does this parse as an ES module?" — so this
// asks acorn, the same parser the `--globals auto` detector already runs over bundled
// output.
//
// A parse failure ALONE is not attributed to JSX: acorn trails SpiderMonkey on new
// syntax, and blaming JSX for something else would send the reader after a setting that
// is already right. The attribution is the FAILURE POSITION — a `<` followed by an
// identifier start, `>` (fragment) or `/` (closing tag). That is where acorn stops on
// every JSX shape measured: `<box …/>`, `<box>hi</box>`, `<>…</>`, `<Foo.Bar x={1}>`,
// JSX as a call argument, and JSX in a multi-declarator `const`.

import * as acorn from 'acorn';

/** Where the parser stopped, and on what. */
export interface SurvivingJsx {
    /** 1-based line, as acorn reports it. */
    line: number;
    /** 0-based column, as acorn reports it. */
    column: number;
    /** The text around the failure, trimmed so a minified bundle stays readable. */
    excerpt: string;
}

/**
 * What may follow the `<` for the failure to read as JSX rather than as a broken
 * comparison: a tag name, a fragment (`<>`) or a closing tag (`</`).
 */
const JSX_AFTER_ANGLE_RE = /^[A-Za-z_$>/]/;

/** Characters of context kept around the failure position. */
const EXCERPT_RADIUS = 60;

function excerptAt(code: string, pos: number): string {
    const from = Math.max(0, pos - EXCERPT_RADIUS);
    const to = Math.min(code.length, pos + EXCERPT_RADIUS);
    // Newlines and tabs would break the one-line-per-fact shape of the message.
    const text = code.slice(from, to).replace(/[\r\n\t]+/g, ' ');
    return `${from > 0 ? '…' : ''}${text}${to < code.length ? '…' : ''}`;
}

/**
 * Does `err` — a failure from parsing `code` — say that raw JSX survived? Returns the
 * location when the position attributes it to JSX, `null` when it does not.
 *
 * Split from {@link locateSurvivingJsx} so a caller that ALREADY parsed (and threw) can
 * attribute its own failure without parsing a second time.
 */
export function classifyJsxParseFailure(code: string, err: unknown): SurvivingJsx | null {
    const pos = (err as { pos?: unknown }).pos;
    const loc = (err as { loc?: { line?: unknown; column?: unknown } }).loc;
    if (typeof pos !== 'number') return null;
    if (typeof loc?.line !== 'number' || typeof loc.column !== 'number') return null;
    if (code[pos] !== '<') return null;
    if (!JSX_AFTER_ANGLE_RE.test(code.slice(pos + 1, pos + 2))) return null;
    return { line: loc.line, column: loc.column, excerpt: excerptAt(code, pos) };
}

/**
 * Parse `code` as an ES module and report surviving JSX. `null` means either "parses
 * fine" or "fails for a reason that is not JSX" — the two cases this must not conflate,
 * because only the first is a healthy bundle and only the second is acorn's problem
 * rather than the build's.
 */
export function locateSurvivingJsx(code: string): SurvivingJsx | null {
    try {
        acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            // Any project bundling its own CLI gets a shebang hoisted to byte 0.
            allowHashBang: true,
        });
        return null;
    } catch (err) {
        return classifyJsxParseFailure(code, err);
    }
}

/**
 * The actionable message: what the artifact does, what the runtime will do with it, and
 * the two settings that fix it. Shared by the post-bundle artifact gate and the
 * `--globals auto` analysis pass, which hits the same source with a bare
 * "Unexpected token (3:11)" naming neither JSX nor a setting.
 */
export function formatSurvivingJsx(found: SurvivingJsx, label: string): string {
    return [
        `gjsify build: ${label} still contains raw JSX at ${found.line}:${found.column} — it is not valid ` +
            'JavaScript, so GJS aborts at load with "SyntaxError: expected expression, got \'<\'" before one ' +
            'line runs.',
        `  ${found.excerpt}`,
        '',
        'JSX reaches an artifact only when the transform was told to PRESERVE it (`jsx: "preserve"` in ' +
            '`gjsify.bundler.transform.jsx` or in tsconfig `compilerOptions.jsx`) and nothing compiled it ' +
            'afterwards. Either:',
        '  - register the framework compiler that consumes preserved JSX (`babel-preset-solid` for Solid, the ' +
            'Vue SFC compiler) under `gjsify.bundler.plugins`, or',
        '  - drop `preserve` and give the automatic runtime an import source that resolves AND runs: ' +
            '`bundler.transform.jsx: { "importSource": "<pkg exporting ./jsx-runtime>" }`, or tsconfig ' +
            '`"jsx": "react-jsx"` + `"jsxImportSource"`. Not `@gjsify/gtk-host` — its `/jsx-runtime` is a ' +
            'TYPE surface and throws when called.',
    ].join('\n');
}
