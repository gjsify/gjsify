// E2E for `@gjsify/nativescript-vite`'s CSS nesting flattening (`nativescriptCssNesting`).
//
// The incident: Learn6502's `#main-button { revealer { padding-bottom: 16px; button { padding:
// 12px } } }` is valid GTK 4 CSS, but NativeScript's parser files a nested rule under the
// parent's declarations and never applies it — the floating action button kept the default
// 34 dp instead of 40. `@nativescript/vite` runs `app.css` through Vite's `preprocessCSS()`
// before it parses, so the PostCSS stage is where the nesting has to go.
//
// Held here: the PostCSS config the app already has is kept first and nesting follows it, and a
// REAL `preprocessCSS` run over the app's stylesheet leaves no rule inside a rule.
//
// CI-safe: no `@nativescript/vite`, no NS CLI — only `vite` + `postcss`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preprocessCSS, resolveConfig } from 'vite';
import postcss from 'postcss';

const LIB_URL = new URL('../../../packages/infra/nativescript-vite/lib/index.js', import.meta.url);
const { nativescriptCssNesting } = await import(LIB_URL);

const NESTED = `
#main-button {
  revealer {
    padding-bottom: 16px;
    button { padding: 12px; }
  }
}
#gamepad #buttonCenter { padding-left: 5px; }
.a { &.b { color: red; } }
`;

async function withApp(files, run) {
    // Inside the repo, so a config naming a plugin (`{ 'postcss-nesting': {} }`) can resolve it.
    const dir = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.nesting-'));
    try {
        for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
        return await run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** `[selector, declarations]` for every rule, plus whether any rule sits inside another. */
function describeCss(css) {
    const rules = [];
    let nested = false;
    postcss.parse(css).walkRules((rule) => {
        if (rule.parent?.type === 'rule') nested = true;
        rules.push([
            rule.selector.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' '),
            rule.nodes
                .filter((n) => n.type === 'decl')
                .map((n) => `${n.prop}:${n.value}`)
                .join(';'),
        ]);
    });
    return { rules, nested };
}

async function flattened(config, dir) {
    const withNesting = await nativescriptCssNesting({ ...config, configFile: false, logLevel: 'silent' }, dir);
    const resolved = await resolveConfig({ ...withNesting, root: dir }, 'build');
    return (await preprocessCSS(NESTED, join(dir, 'app.css'), resolved)).code;
}

describe('@gjsify/nativescript-vite nativescriptCssNesting', () => {
    it('flattens nested rules into the descendant selectors GTK reads them as', () =>
        withApp({}, async (dir) => {
            const { rules, nested } = describeCss(await flattened({}, dir));
            assert.equal(nested, false);
            assert.deepEqual(rules, [
                ['#main-button revealer', 'padding-bottom:16'],
                ['#main-button revealer button', 'padding:12'],
                ['#gamepad #buttonCenter', 'padding-left:5'],
                ['.a.b', 'color:red'],
            ]);
        }));

    it('writes a comma-separated parent as one selector per parent, never :is()', () =>
        withApp({}, async (dir) => {
            const nested = '.a, .b { c { x: 1 } }';
            const withNesting = await nativescriptCssNesting({ configFile: false, logLevel: 'silent', root: dir }, dir);
            const resolved = await resolveConfig(withNesting, 'build');
            const { rules } = describeCss((await preprocessCSS(nested, join(dir, 'a.css'), resolved)).code);
            assert.deepEqual(rules, [['.a c, .b c', 'x:1']]);
        }));

    it('keeps the app postcss.config.* first and adds nesting after it', () =>
        withApp(
            {
                'postcss.config.cjs': `module.exports = { plugins: [ { postcssPlugin: 'app-marker', Once(root) { root.append({ selector: '.marker', nodes: [] }); } } ] };`,
            },
            async (dir) => {
                const config = await nativescriptCssNesting({ root: dir }, dir);
                const names = config.css.postcss.plugins.map((p) => p.postcssPlugin);
                assert.deepEqual(names, [
                    'app-marker',
                    'postcss-nesting',
                    'gjsify-ns-unwrap-is',
                    'gjsify-ns-px-to-dip',
                ]);
                const { rules, nested } = describeCss(await flattened({}, dir));
                assert.equal(nested, false);
                assert.ok(
                    rules.some(([selector]) => selector === '.marker'),
                    'the app plugin still ran',
                );
            },
        ));

    it('appends to an inline css.postcss and is idempotent', async () => {
        const marker = { postcssPlugin: 'inline-marker', Once() {} };
        const once = await nativescriptCssNesting({ css: { postcss: { plugins: [marker] } } }, tmpdir());
        assert.deepEqual(
            once.css.postcss.plugins.map((p) => p.postcssPlugin),
            ['inline-marker', 'postcss-nesting', 'gjsify-ns-unwrap-is', 'gjsify-ns-px-to-dip'],
        );
        const twice = await nativescriptCssNesting(once, tmpdir());
        assert.equal(twice, once);
    });

    it('reads the object form of plugins from a config file', () =>
        withApp({ 'postcss.config.cjs': `module.exports = { plugins: { 'postcss-nesting': {} } };` }, async (dir) => {
            // The object form is resolved by name; finding `postcss-nesting` there means no second pass.
            const config = await nativescriptCssNesting({ root: dir }, dir);
            assert.deepEqual(
                config.css.postcss.plugins.map((p) => p.postcssPlugin),
                ['postcss-nesting', 'gjsify-ns-px-to-dip'],
            );
        }));

    it('rewrites px to the unitless device-independent length in declarations only', () =>
        withApp({}, async (dir) => {
            const css = `@media (min-width: 600px) { .a { margin: 0 -4px; content: "3px"; background: url(a-2px.png); } }
.b { --size: 44px; padding: 1.5px 0 8PX; width: 50%; font-size: 1.2em; }`;
            const withNesting = await nativescriptCssNesting({ configFile: false, logLevel: 'silent', root: dir }, dir);
            const resolved = await resolveConfig(withNesting, 'build');
            const out = (await preprocessCSS(css, join(dir, 'a.css'), resolved)).code;
            assert.match(out, /min-width: 600px/);
            assert.match(out, /margin: 0 -4;/);
            assert.match(out, /content: "3px"/);
            assert.match(out, /url\(a-2px\.png\)/);
            assert.match(out, /--size: 44;/);
            assert.match(out, /padding: 1\.5 0 8;/);
            assert.match(out, /width: 50%/);
            assert.match(out, /font-size: 1\.2em/);
        }));
});
