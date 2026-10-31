// CSS nesting for NativeScript apps.
//
// GTK 4 reads `#main-button { revealer { padding-bottom: 16px; } }` as `#main-button revealer
// { … }`, and a GTK app's stylesheet is written that way (Learn6502's `main-button.css`).
// NativeScript's own CSS parser does not: its `css-tree` transform files a nested rule under
// the parent's `declarations`, so the parent keeps no real declaration and the inner rule
// never applies. Measured on a Galaxy S9: the app's floating action button kept libadwaita's
// 34 dp default padding instead of the authored 12 px.
//
// `@nativescript/vite` feeds `app.css` through Vite's `preprocessCSS()` and parses the result,
// so the one seam that runs before NativeScript's parser is the PostCSS stage. This module
// appends `postcss-nesting` (the CSS Nesting spec's reference plugin, the same semantics GTK
// implements) to the PostCSS config the app already has. `css.postcss` given inline replaces
// Vite's config-file lookup, so the app's own `postcss.config.*` is loaded here and kept first.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postcssNesting from 'postcss-nesting';
import selectorParser from 'postcss-selector-parser';
import type { UserConfig } from 'vite';

type InlinePostcss = Exclude<NonNullable<NonNullable<UserConfig['css']>['postcss']>, string>;
type PostcssPlugin = NonNullable<InlinePostcss['plugins']>[number];

const CONFIG_FILES = [
    'postcss.config.js',
    'postcss.config.cjs',
    'postcss.config.mjs',
    '.postcssrc.json',
    '.postcssrc.js',
    '.postcssrc.cjs',
    '.postcssrc.mjs',
    '.postcssrc',
];

/** The name `postcss-nesting` registers; an app that already runs it is not given a second pass. */
const NESTING_PLUGIN_NAME = 'postcss-nesting';

/**
 * `postcss-nesting` writes a nested rule under a complex parent as `:is(#main-button revealer)
 * button` — the spec's specificity-preserving form, and the only one its current edition has
 * (the `noIsPseudoSelector` option belongs to the 2021 edition, which does not accept GTK's
 * bare `button { … }` nested rule). NativeScript's selector engine has no `:is()`, so the rule
 * would be dropped as silently as the nesting was. A LEADING `:is()` followed by a combinator
 * (or alone) is the parent itself, so it is unwrapped: `:is(A, B) c` becomes `A c, B c`, which
 * is what GTK reads. An `:is()` anywhere else is left as authored.
 */
function unwrapIs(selector: string): string {
    return selectorParser((selectors) => {
        let changed = true;
        while (changed) {
            changed = false;
            selectors.each((sel) => {
                const head = sel.first;
                if (head?.type !== 'pseudo' || head.value.toLowerCase() !== ':is') return;
                const next = sel.at(1);
                if (next !== undefined && next.type !== 'combinator') return;
                for (const arg of head.nodes) {
                    const copy = sel.clone();
                    copy.first.replaceWith(...arg.clone().nodes);
                    sel.parent?.insertBefore(sel, copy);
                }
                sel.remove();
                changed = true;
            });
        }
    }).processSync(selector);
}

const unwrapLeadingIs = {
    postcssPlugin: 'gjsify-ns-unwrap-is',
    OnceExit(root: { walkRules(callback: (rule: { selector: string }) => void): void }) {
        root.walkRules((rule) => {
            if (rule.selector.includes(':is(')) rule.selector = unwrapIs(rule.selector);
        });
    },
} as PostcssPlugin;

function findConfigFile(from: string): string | undefined {
    let dir = resolve(from);
    for (;;) {
        for (const name of CONFIG_FILES) {
            const candidate = join(dir, name);
            if (existsSync(candidate)) return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** `plugins: { name: options }` — the object form `postcss-load-config` accepts. */
function pluginsFromMap(map: Record<string, unknown>, file: string): PostcssPlugin[] {
    const requireFrom = createRequire(file);
    const plugins: PostcssPlugin[] = [];
    for (const [name, options] of Object.entries(map)) {
        if (options === false) continue;
        const loaded = requireFrom(name);
        const factory = (loaded?.default ?? loaded) as (options?: unknown) => PostcssPlugin;
        plugins.push(
            typeof factory === 'function' && options !== undefined
                ? factory(options)
                : (factory as unknown as PostcssPlugin),
        );
    }
    return plugins;
}

async function loadConfigFile(file: string, mode: string): Promise<InlinePostcss> {
    if (file.endsWith('.json') || file.endsWith('.postcssrc')) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        return normalise(parsed, file);
    }
    const imported = (await import(pathToFileURL(file).href)) as { default?: unknown };
    let exported: unknown = imported.default ?? imported;
    if (typeof exported === 'function')
        exported = await (exported as (ctx: object) => unknown)({ env: mode, file, options: {} });
    return normalise((exported ?? {}) as Record<string, unknown>, file);
}

function normalise(config: Record<string, unknown>, file: string): InlinePostcss {
    const { plugins, ...options } = config;
    const list: PostcssPlugin[] = Array.isArray(plugins)
        ? (plugins as PostcssPlugin[])
        : plugins && typeof plugins === 'object'
          ? pluginsFromMap(plugins as Record<string, unknown>, file)
          : [];
    return { ...options, plugins: list };
}

function hasNesting(plugins: readonly PostcssPlugin[]): boolean {
    return plugins.some(
        (plugin) => (plugin as { postcssPlugin?: string } | undefined)?.postcssPlugin === NESTING_PLUGIN_NAME,
    );
}

/**
 * Add `postcss-nesting` after the app's own PostCSS plugins.
 *
 * - `css.postcss` unset: the app's `postcss.config.*` (searched upward from `root`, like Vite)
 *   is loaded and kept, nesting follows it.
 * - `css.postcss` a path: that directory is searched the same way.
 * - `css.postcss` inline: its plugins stay, nesting is appended.
 *
 * Idempotent: an app that already runs `postcss-nesting` is returned as it came.
 *
 * @param config  the composed config, user layer included.
 * @param root    the app root; `config.root` wins, then this, then the working directory.
 * @param mode    the Vite mode, handed to a config FUNCTION the way `postcss-load-config` does.
 */
export async function nativescriptCssNesting(
    config: UserConfig,
    root?: string,
    mode = 'production',
): Promise<UserConfig> {
    const appRoot = resolve(config.root ?? root ?? process.cwd());
    const declared = config.css?.postcss;
    let base: InlinePostcss;
    if (declared !== undefined && typeof declared !== 'string') {
        base = declared;
    } else {
        const searchFrom = typeof declared === 'string' ? resolve(appRoot, declared) : appRoot;
        const file = findConfigFile(searchFrom);
        base = file === undefined ? { plugins: [] } : await loadConfigFile(file, mode);
    }
    const plugins = base.plugins ?? [];
    if (hasNesting(plugins)) return config;
    return {
        ...config,
        css: { ...config.css, postcss: { ...base, plugins: [...plugins, postcssNesting(), unwrapLeadingIs] } },
    };
}
