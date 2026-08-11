// HTML-entry support for `gjsify build --app browser`.
//
// Brings Vite's HTML-entry behaviour to the production Rolldown build: treat `index.html` as
// the entry, find its `<script type="module" src="...">`, bundle that module, and emit a
// processed HTML whose script points at the built asset.
//
// Emission MUST run as a CLI post-bundle step (mirroring `applyShebang`), NOT as a Rolldown
// plugin `emitFile`: the native `@gjsify/rolldown-native` engine implements no `emitFile`, so a
// plugin-based emit would work on the npm engine (Node) and throw under the GJS-bundled CLI.
// Parsing is regex-based and tolerant on purpose — this is a shell-page rewrite, not a full HTML
// pipeline. CSS is NOT extracted here: it travels in the JS bundle as a string via
// css-as-string and is injected by the app, the same pattern the `--app gjs` target uses.

import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { RolldownOptions } from 'rolldown';

export interface ParsedHtmlEntry {
    /** Absolute path to the module the `<script type="module" src>` references. */
    moduleEntry: string;
    /** The full matched `<script …></script>`/`<script … />` tag text. */
    scriptTag: string;
    /** The raw `src` attribute value from that tag (as authored in the HTML). */
    scriptSrc: string;
}

/**
 * The `.html` path when `input` is a SINGLE html entry (a literal `.html` string, a 1-element
 * array of one, or a 1-key record whose value is one) — else `null`. Multi-entry inputs and
 * non-html entries are never treated as html. Returned as authored; the caller resolves + reads it.
 */
export function detectHtmlEntry(input: RolldownOptions['input'] | undefined): string | null {
    if (!input) return null;

    const isHtml = (v: unknown): v is string => typeof v === 'string' && /\.html?$/i.test(v);

    if (typeof input === 'string') return isHtml(input) ? input : null;

    if (Array.isArray(input)) {
        return input.length === 1 && isHtml(input[0]) ? input[0] : null;
    }

    // Record<name, path> form.
    if (typeof input === 'object') {
        const values = Object.values(input as Record<string, unknown>);
        return values.length === 1 && isHtml(values[0]) ? (values[0] as string) : null;
    }

    return null;
}

const SCRIPT_MODULE_RE = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>(?:<\/script>)?/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const EXTERNAL_SRC_RE = /^(?:https?:)?\/\//i;

/**
 * The FIRST `<script type="module" src="…">` whose `src` is a local (non-`http(s)://`, non-`//`)
 * path, with the module resolved against the HTML file's directory. Throws when there is none.
 */
export function parseHtmlEntry(htmlPath: string, htmlSource: string): ParsedHtmlEntry {
    for (const match of htmlSource.matchAll(SCRIPT_MODULE_RE)) {
        const scriptTag = match[0];
        const srcMatch = SRC_ATTR_RE.exec(scriptTag);
        if (!srcMatch) continue; // inline module script — not an entry
        const scriptSrc = srcMatch[1];
        if (EXTERNAL_SRC_RE.test(scriptSrc)) continue; // externally hosted — leave alone
        const moduleEntry = isAbsolute(scriptSrc) ? scriptSrc : resolve(dirname(htmlPath), scriptSrc);
        return { moduleEntry, scriptTag, scriptSrc };
    }
    throw new Error(
        `gjsify build: ${htmlPath} has no local <script type="module" src="…"> to bundle. ` +
            `Add one pointing at your app entry (e.g. <script type="module" src="./main.ts">).`,
    );
}

export interface EmitBrowserHtmlInput {
    /** The original HTML source. */
    htmlSource: string;
    /** The `<script>` tag matched by {@link parseHtmlEntry}. */
    scriptTag: string;
    /** That tag's original `src` value. */
    scriptSrc: string;
    /** Absolute path to the built JS bundle the emitted page should load. */
    jsOutPath: string;
    /** Absolute path the emitted HTML will be written to. */
    outHtmlPath: string;
}

/**
 * The original source with the entry script's `src` rewritten to the built JS bundle, relative
 * to the output HTML's own directory so the page is portable wherever `dist/` is served from.
 * All other markup is preserved.
 */
export function emitBrowserHtml(input: EmitBrowserHtmlInput): string {
    const { htmlSource, scriptTag, scriptSrc, jsOutPath, outHtmlPath } = input;
    let rel = relative(dirname(outHtmlPath), jsOutPath).split(/[\\/]/).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    // Rewrite the src WITHIN the matched tag, then swap that tag back in — so no other `src=`
    // in the document is touched.
    const newTag = scriptTag.replace(SRC_ATTR_RE, (whole) => whole.replace(scriptSrc, rel));
    return htmlSource.replace(scriptTag, newTag);
}

/** Convenience: the emitted HTML filename for a given JS outfile (sibling `index.html`). */
export function htmlOutPathFor(jsOutPath: string): string {
    return resolve(dirname(jsOutPath), 'index.html');
}

/** Derive a JS outfile from an outdir + the module entry basename (`<outdir>/<name>.js`). */
export function jsOutPathForOutdir(outdir: string, moduleEntry: string): string {
    const name = basename(moduleEntry).replace(/\.[cm]?[jt]sx?$/i, '');
    return resolve(outdir, `${name}.js`);
}
