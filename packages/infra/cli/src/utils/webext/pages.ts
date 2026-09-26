// An extension page (popup, options, side panel …) as the build sees it: the
// local scripts it loads, the local stylesheets it links, and the page with
// both rewritten to point at the built files in the target root.
//
// Regex-based on purpose, like `utils/html-entry.ts`: this rewrites attribute
// values in author-written shell pages, it is not an HTML pipeline. Everything
// not matched (inline `<style>`, inline scripts, remote URLs) passes through.

import { basename, dirname, isAbsolute, resolve } from 'node:path';

export interface PageScript {
    /** Absolute path of the source the tag points at. */
    entry: string;
    /** `esm` for a `type="module"` tag, `iife` for a classic one. */
    format: 'esm' | 'iife';
    /** File name written into the target root. */
    output: string;
}

export interface PageStylesheet {
    source: string;
    output: string;
}

export interface PagePlan {
    html: string;
    scripts: PageScript[];
    stylesheets: PageStylesheet[];
}

const SCRIPT_TAG_RE = /<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const SRC_RE = /\bsrc\s*=\s*(["'])([^"']+)\1/i;
const HREF_RE = /\bhref\s*=\s*(["'])([^"']+)\1/i;
const MODULE_RE = /\btype\s*=\s*["']module["']/i;
const STYLESHEET_RE = /\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i;
/** Remote, protocol-relative, data: and extension-absolute URLs are not ours to bundle. */
const NOT_LOCAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/i;

/**
 * Plan one page: which scripts to bundle and which stylesheets to copy, and the
 * page with their references rewritten.
 *
 * Every relative `src` naming a JS/TS file is bundled. A prebuilt script that
 * must load verbatim goes in `public/` and is referenced by an absolute
 * extension path (`/vendor/x.js`), which is left alone.
 */
export function planPage(name: string, htmlPath: string, html: string): PagePlan {
    const dir = dirname(htmlPath);
    const scripts: PageScript[] = [];
    const stylesheets: PageStylesheet[] = [];

    const local = (value: string): string | null => {
        if (NOT_LOCAL_RE.test(value) || value.startsWith('/')) return null;
        const path = value.replace(/[?#].*$/, '');
        return isAbsolute(path) ? path : resolve(dir, path);
    };

    let out = html.replace(SCRIPT_TAG_RE, (tag) => {
        const src = SRC_RE.exec(tag);
        if (!src) return tag;
        const entry = local(src[2] as string);
        if (entry === null || !SOURCE_EXT_RE.test(entry)) return tag;
        const output = scripts.length === 0 ? `${name}.js` : `${name}-${scripts.length + 1}.js`;
        scripts.push({ entry, format: MODULE_RE.test(tag) ? 'esm' : 'iife', output });
        return tag.replace(SRC_RE, (_whole, quote: string) => `src=${quote}${output}${quote}`);
    });

    out = out.replace(LINK_TAG_RE, (tag) => {
        if (!STYLESHEET_RE.test(tag)) return tag;
        const href = HREF_RE.exec(tag);
        if (!href) return tag;
        const source = local(href[2] as string);
        if (source === null) return tag;
        const output = basename(source);
        stylesheets.push({ source, output });
        return tag.replace(HREF_RE, (_whole, quote: string) => `href=${quote}${output}${quote}`);
    });

    return { html: out, scripts, stylesheets };
}
