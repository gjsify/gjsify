// `gjsify/no-css-side-effect-import` — a bare `import '<something that is CSS>';`
// registers nothing in a gjsify build, and says so nowhere.
//
// THE MECHANISM. `cssAsStringPlugin` (`@gjsify/rolldown-plugin-gjsify`, composed by
// every `--app browser`/`--app gjs` build) hooks `load` for `.css`/`.scss`/`.sass`
// and returns `export default "<css>"` — a JS module, because Rolldown dropped CSS
// bundling and would otherwise error on the extension. A module whose whole body is
// a string literal has NO side effect, so a side-effect import of it is tree-shaken
// and the build exits 0.
//
// THE INCIDENT it was written for — a 0-byte bundle, exit 0, invisible on a GNOME
// host — is `docs/code-anti-patterns.md` § "a side-effect import that has no side
// effect". Repo-wide there were exactly TWO instances, and both had the convention
// already written down beside them (`@gjsify/adwaita-web`'s entry comment,
// `style.css.d.ts`): two files followed it and one did not, which is the
// measurement that turns a comment into a check.
//
// WHY A LINT RULE AND NOT THE PLUGIN, where the knowledge is: the hooks that
// could see a dropped module are argument-less no-ops on the
// `@gjsify/rolldown-native` bridge, so the diagnostic would exist under Node and
// not under GJS. Full reasoning, and the consumer-facing half that is still
// missing, in `status/open-todos.md`.
//
// WHAT IT FLAGS. An `ImportDeclaration` with NO specifiers whose source is CSS:
// either by extension (`./app.css`), or because the package it names exports CSS
// from that subpath (`@gjsify/adwaita-fonts` → `index.css`). The second half is
// the one that matters — a specifier with no extension is exactly the shape that
// reads like a JS side-effect module.
//
// WHAT IT DOES NOT FLAG. A VALUE import (`import css from './app.css'`) — that is
// the correct spelling, and what the app does with the string is its business. A
// bare import of anything that resolves to JS, which is the ordinary `/register`
// pattern and must stay silent.
//
// SCOPE. Repo-wide, no config override: the one legitimate site (an Astro component
// — Astro IS a CSS pipeline) carries a per-line reasoned disable, which
// `reportUnusedDisableDirectives` retires the day the import goes. The rule found
// that file on its first run; the author's own grep had missed it, not reading
// `.astro`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

import type { Context, Node, Rule } from './types.ts';

/** Extensions `cssAsStringPlugin` claims in its `load` filter. */
const CSS_EXTENSIONS = /\.(css|s[ac]ss)(\?|#|$)/i;

/** Export conditions to follow, in the order a browser/ESM build resolves them. */
const CONDITIONS = ['browser', 'import', 'module', 'default', 'require'];

/** `@scope/pkg/sub/path` → `['@scope/pkg', './sub/path']`; `pkg` → `['pkg', '.']`. */
function splitSpecifier(specifier: string): [string, string] {
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const rest = specifier.slice(name.length);
    return [name, rest.length === 0 ? '.' : `.${rest}`];
}

/** The first string an `exports` value yields under {@link CONDITIONS}, or `undefined`. */
function pickCondition(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        for (const entry of value) {
            const picked = pickCondition(entry);
            if (picked !== undefined) return picked;
        }
        return undefined;
    }
    if (value === null || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const condition of CONDITIONS) {
        if (condition in record) {
            const picked = pickCondition(record[condition]);
            if (picked !== undefined) return picked;
        }
    }
    return undefined;
}

/**
 * The manifest of `name` as seen from `fromDir`, by walking `node_modules` upward.
 *
 * Deliberately NOT `createRequire(...).resolve()`: that answers with a path only
 * when the target FILE exists, and half the interesting targets are build outputs
 * (`@gjsify/adwaita-web/style.css` → `dist/adwaita-web.css`) that a fresh checkout
 * has not produced yet. A rule that goes quiet on an unbuilt tree is a rule that
 * is quiet in CI's lint job, which is where it has to speak. `exports` is a
 * DECLARATION and is present either way.
 */
function readPackageManifest(fromDir: string, name: string): Record<string, unknown> | undefined {
    let dir = fromDir;
    for (;;) {
        const manifestPath = join(dir, 'node_modules', ...name.split('/'), 'package.json');
        if (existsSync(manifestPath)) {
            try {
                return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
            } catch {
                // A manifest we cannot parse is not evidence of CSS. Stay silent
                // rather than accuse — this rule's whole value is that a hit means
                // something.
                return undefined;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** Where a bare specifier's declared entry points, per the target's `exports`/`main`. */
function declaredTarget(fromDir: string, specifier: string): string | undefined {
    const [name, subpath] = splitSpecifier(specifier);
    const manifest = readPackageManifest(fromDir, name);
    if (!manifest) return undefined;

    const exportsField = manifest.exports;
    if (exportsField !== undefined && exportsField !== null) {
        if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
            return subpath === '.' ? pickCondition(exportsField) : undefined;
        }
        const map = exportsField as Record<string, unknown>;
        // A conditions-only map (no `.`-prefixed keys) IS the `.` entry.
        const isSubpathMap = Object.keys(map).some((key) => key.startsWith('.'));
        if (!isSubpathMap) return subpath === '.' ? pickCondition(map) : undefined;
        if (subpath in map) return pickCondition(map[subpath]);
        for (const [pattern, value] of Object.entries(map)) {
            if (!pattern.includes('*')) continue;
            const [head, tail] = pattern.split('*');
            if (!subpath.startsWith(head) || !subpath.endsWith(tail)) continue;
            const star = subpath.slice(head.length, subpath.length - tail.length);
            return pickCondition(value)?.replace('*', star);
        }
        return undefined;
    }
    return subpath === '.' ? (manifest.main as string | undefined) : subpath;
}

/** Does this import specifier name CSS, as written or as the target package declares? */
function resolvesToCss(specifier: string, fromDir: string): boolean {
    if (CSS_EXTENSIONS.test(specifier)) return true;
    if (specifier.startsWith('.')) {
        // A relative specifier with no CSS extension is JS. Extensionless relative
        // imports do not resolve to `.css` under any loader this repo uses.
        return false;
    }
    if (specifier.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) return false;
    const target = declaredTarget(fromDir, specifier);
    return target !== undefined && CSS_EXTENSIONS.test(target);
}

export const noCssSideEffectImportRule: Rule = {
    meta: {
        // No autofix. Deleting the line is right where the stylesheet is applied
        // some other way and WRONG where the author meant the CSS to arrive — the
        // two repairs are opposite, and only the author knows which.
        fixable: false,
    },
    create(context: Context) {
        const fromDir = dirname(resolvePath(context.filename));
        return {
            ImportDeclaration(node: Node) {
                const specifiers = node.specifiers;
                if (Array.isArray(specifiers) && specifiers.length > 0) return;
                const source = node.source as Node | undefined;
                const value = source?.value;
                if (typeof value !== 'string') return;
                if (!resolvesToCss(value, fromDir)) return;

                context.report({
                    message:
                        `\`import '${value}';\` imports CSS for a SIDE EFFECT it does not have. Every gjsify ` +
                        '`--app browser`/`--app gjs` build loads CSS through `cssAsStringPlugin`, which emits ' +
                        '`export default "<css>"` — a module with no side effect, so this import is tree-shaken ' +
                        'and the build exits 0 with the stylesheet nowhere in it (measured: a probe entry whose ' +
                        'only statement was this import produced a 0-byte bundle). Import the VALUE and apply it ' +
                        `(\`import css from '${value}'\`, then a <style> whose textContent is that string), or ` +
                        'drop the line if the stylesheet is already applied elsewhere. For a FONT that is still ' +
                        "only half of it: a relative `url()` inside the recovered string resolves against the " +
                        'document, and an `--app browser` build emits one file and no assets, so the rule parses ' +
                        'and the face 404s — it needs a `data:` URI or an asset-emitting pipeline. Under a real ' +
                        'CSS pipeline (Vite/webpack) the side-effect form IS correct — say so in a reasoned ' +
                        'oxlint-disable comment.',
                    node,
                });
            },
        };
    },
};
