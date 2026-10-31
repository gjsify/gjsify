/**
 * Build-time syntax highlighting for the code blocks a Markdown page renders — the `highlight` hook
 * `@gjsify/site`'s `renderMarkdown` accepts.
 *
 * Shiki, not a client-side highlighter: the pages of a `@gjsify/site` build work without
 * JavaScript, so the colours have to be in the HTML that leaves the build. Shiki's JavaScript
 * regex engine is what makes that possible on GJS — the WASM (Oniguruma) engine needs a WebAssembly
 * instantiation GJS has no business doing for a static page, and a JS `RegExp` is already there.
 *
 * Two themes and `defaultColor: false`: Shiki writes BOTH palettes into the `--shiki-light*` /
 * `--shiki-dark*` custom properties and sets no `color` of its own, so one rendered block follows
 * the reader's scheme through CSS alone (see {@link HIGHLIGHT_CSS}). Rendering twice, or shipping a
 * second HTML copy per scheme, is the alternative and is strictly more bytes.
 */

import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import languageCss from '@shikijs/langs/css';
import languageDiff from '@shikijs/langs/diff';
import languageJavascript from '@shikijs/langs/javascript';
import languageJson from '@shikijs/langs/json';
import languageMarkdown from '@shikijs/langs/markdown';
import languageScss from '@shikijs/langs/scss';
import languageShellscript from '@shikijs/langs/shellscript';
import languageTypescript from '@shikijs/langs/typescript';
import languageXml from '@shikijs/langs/xml';
import languageYaml from '@shikijs/langs/yaml';
import themeDark from '@shikijs/themes/github-dark';
import themeLight from '@shikijs/themes/github-light';

import blueprint from '../grammars/blueprint.tmLanguage.json' with { type: 'json' };

/** The two palettes, by the names Shiki writes into `--shiki-<scheme>`. */
const THEMES = { light: 'github-light', dark: 'github-dark' };

/** Everything this package highlights. An alias (`ts`, `js`, `sh`, `bash`, `yml`, `blp`, …) comes
 * with its grammar, so nothing has to be listed twice. */
const LANGUAGES = [
    ...languageTypescript,
    ...languageJavascript,
    ...languageCss,
    ...languageScss,
    ...languageJson,
    ...languageShellscript,
    ...languageXml,
    ...languageYaml,
    ...languageMarkdown,
    ...languageDiff,
    // Shiki bundles no Blueprint grammar. `name` is repeated because registration ignores the
    // grammar's own `name` field; the `aliases` (`blp`) travel with the JSON and still apply.
    { ...blueprint, name: 'blueprint' },
];

/**
 * The stylesheet {@link CodeHighlighter.highlight}'s HTML needs — without it a block has no colour
 * at all, because `defaultColor: false` deliberately emits none.
 *
 * `pre.shiki` rather than `.shiki`: a consumer stylesheet that paints `pre` (the site's own blog CSS
 * does) ties with a bare class selector, so appending this AFTER that stylesheet is what lets the
 * highlighter's background win, and a later override is still a plain CSS edit away.
 *
 * The attribute selectors exist for sites whose scheme toggle is not the OS preference: a reader
 * who forces `dark` gets it while their OS is light, and one who forces `light` keeps it while
 * their OS is dark. `schemeAttribute` names the attribute the site sets on an ancestor (usually
 * `<html>`) to `light` or `dark`.
 */
export function highlightCss(schemeAttribute = 'data-theme'): string {
    // The name lands in a selector verbatim; a build-time option, but a typo should fail loudly
    // here rather than ship a stylesheet that silently matches nothing.
    if (!/^[a-z_][\w-]*$/i.test(schemeAttribute)) {
        throw new Error(`highlightCss: "${schemeAttribute}" is not an attribute name`);
    }
    const dark = `[${schemeAttribute}='dark']`;
    const light = `[${schemeAttribute}='light']`;
    return `pre.shiki,
pre.shiki span {
    color: var(--shiki-light);
    background-color: var(--shiki-light-bg);
}
@media (prefers-color-scheme: dark) {
    pre.shiki,
    pre.shiki span {
        color: var(--shiki-dark);
        background-color: var(--shiki-dark-bg);
    }
}
${dark} pre.shiki,
${dark} pre.shiki span {
    color: var(--shiki-dark);
    background-color: var(--shiki-dark-bg);
}
${light} pre.shiki,
${light} pre.shiki span {
    color: var(--shiki-light);
    background-color: var(--shiki-light-bg);
}
`;
}

/** {@link highlightCss} for the default `data-theme` attribute. */
export const HIGHLIGHT_CSS = highlightCss();

/** What {@link createHighlighter} accepts. */
export interface HighlighterOptions {
    /**
     * The attribute the site's scheme toggle sets to `light` or `dark` on an ancestor of the code
     * blocks. Default `data-theme`.
     */
    schemeAttribute?: string;
}

/** What {@link createHighlighter} answers: the hook for `@gjsify/site`, plus the CSS it needs. */
export interface CodeHighlighter {
    /**
     * Shiki's `<pre class="shiki …">` for a language this package ships, `undefined` for any other
     * — which is what makes `renderMarkdown` fall back to its plain `<pre><code>` block instead of
     * printing an unhighlighted one that pretends to be highlighted.
     *
     * The returned HTML is complete and escaped by Shiki; `renderMarkdown` inserts it as markup.
     */
    highlight(code: string, lang: string): string | undefined;
    /** The stylesheet the HTML needs, to be appended after the site's own. */
    css: string;
}

/**
 * The Markdown fence's info string, reduced to the language name: ```` ```sh title=build ```` names
 * `sh`. An empty info string answers `''`, which no grammar claims, so the block stays plain.
 */
function languageName(info: string): string {
    return info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

/**
 * Loads the grammars and themes once; keep the result for the whole build. Creating one per block
 * would re-parse every grammar per code block — measurably slower, and it is the only thing this
 * package does that is not free.
 */
export async function createHighlighter(options: HighlighterOptions = {}): Promise<CodeHighlighter> {
    const css = highlightCss(options.schemeAttribute);
    const core = await createHighlighterCore({
        themes: [themeLight, themeDark],
        langs: LANGUAGES,
        engine: createJavaScriptRegexEngine(),
    });
    // `getLoadedLanguages()` lists the grammar names AND their aliases, so one membership test
    // answers for `ts` and `typescript` alike. It is not `getLanguage(name)`: that one THROWS on an
    // unknown name, and a `try`/`catch` here would also swallow a grammar that fails on real code —
    // which is a bug worth failing the build on.
    const known = new Set(core.getLoadedLanguages());
    return {
        highlight(code, lang) {
            const name = languageName(lang);
            if (!known.has(name)) return undefined;
            return core.codeToHtml(code, { lang: name, themes: THEMES, defaultColor: false });
        },
        css,
    };
}
