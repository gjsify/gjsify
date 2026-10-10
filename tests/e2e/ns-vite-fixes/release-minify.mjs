// E2E for `@gjsify/nativescript-vite`'s release-minify defaults (`nativescriptReleaseMinify`).
//
// The incident: the default oxc minifier writes `extend(\`com.tns.X\`, …)` as a template
// literal and the syntax pass folds `__decorate([JavaProxy("…")], t)` into a comma expression;
// NativeScript's Android static binding generator reads neither, skips the class, and the
// release app dies with `Class not found`. Two layers are held here: the config carries the
// defaults and a consumer's override wins, and a REAL vite build with those defaults keeps the
// shape the generator reads.
//
// CI-safe: no `@nativescript/vite`, no NS CLI — only `vite` + `esbuild`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, mergeConfig } from 'vite';

const LIB_URL = new URL('../../../packages/infra/nativescript-vite/lib/index.js', import.meta.url);
const { nativescriptReleaseMinify } = await import(LIB_URL);

const SOURCE = `
const JavaProxy = (name) => (target) => { target.__proxy = name; return target; };
function __decorate(decorators, target) {
    for (const d of decorators) target = d(target) || target;
    return target;
}
class Base { static extend(name, def) { globalThis.__ext = name; return def; } }
export let Activity = Base.extend("com.tns.NativeScriptActivity", { onCreate() {} });
export let Fragment = class FragmentClass {};
Fragment = __decorate([JavaProxy("com.tns.FragmentClass")], Fragment);
export class AdwBin { static GTypeName = 'AdwBin'; }
`;

async function minified(extra) {
    const dir = mkdtempSync(join(tmpdir(), 'ns-minify-'));
    try {
        const entry = join(dir, 'entry.js');
        writeFileSync(entry, SOURCE);
        const base = mergeConfig(
            {
                logLevel: 'silent',
                configFile: false,
                root: dir,
                build: { write: false, lib: { entry, formats: ['es'], fileName: 'out' } },
            },
            extra,
        );
        const result = await build(base);
        const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
        return outputs.find((o) => o.type === 'chunk').code;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('@gjsify/nativescript-vite nativescriptReleaseMinify', () => {
    it('defaults to esbuild without the syntax pass and with kept names', () => {
        const cfg = nativescriptReleaseMinify({});
        assert.equal(cfg.build.minify, 'esbuild');
        assert.equal(cfg.esbuild.minifySyntax, false);
        assert.equal(cfg.esbuild.keepNames, true);
    });

    it('leaves a build that upstream does not minify alone', () => {
        assert.deepEqual(nativescriptReleaseMinify({ build: { minify: false } }), {});
    });

    it("lets the consumer's own settings win after the merge", () => {
        const merged = mergeConfig(nativescriptReleaseMinify({}), {
            build: { minify: 'oxc' },
            esbuild: { minifySyntax: true, keepNames: false },
        });
        assert.equal(merged.build.minify, 'oxc');
        assert.equal(merged.esbuild.minifySyntax, true);
        assert.equal(merged.esbuild.keepNames, false);
    });

    it('keeps the string literal, the decorator call and the class name through a real minify', async () => {
        const code = await minified(nativescriptReleaseMinify({}));
        assert.match(code, /extend\("com\.tns\.NativeScriptActivity"/, 'extend() keeps a string literal');
        assert.doesNotMatch(code, /`com\.tns/, 'no template literal for a com.tns name');
        // Identifiers are mangled (`__decorate` -> `i`); what must survive is the call with an
        // array of decorator calls, not a folded comma expression.
        assert.match(
            code,
            /\w+\(\[\s*\w+\("com\.tns\.FragmentClass"\)\s*\],/,
            'decorator call keeps its array argument',
        );
        assert.match(code, /class AdwBin|AdwBin/, 'the class name survives');
    });
});
