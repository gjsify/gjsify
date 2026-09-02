// SPDX-License-Identifier: MIT
// GJS-only spec for @gjsify/lightningcss-native.
//
// Runs only under GJS (via `on('Gjs', …)`) because `imports.gi.GjsifyLightningcss`
// is unavailable on Node.
//
// The point of this suite is the SHARED ENGINE. `transform()`/`bundle()` used to
// construct a fresh `GjsifyLightningcss.Engine` on every call; they now reuse one
// lazily-created module-level instance (see `getEngine` in `index.ts`). That is
// only sound because the engine holds no per-call state — a claim established by
// reading all three layers of the bridge (Vala class with zero fields, stateless
// C glue, free Rust `extern "C"` functions with no statics and
// `ParserOptions.warnings: None`).
//
// Reading is not a regression guard, so this suite pins the property behaviourally:
// every option that could plausibly be remembered (targets, minify, sourceMap,
// filename) is exercised in an A → B → A order and the second `A` must byte-match
// the first. Under a naively-shared engine that accumulated ANY of them, the
// trailing `A` would differ. It also pins that a thrown error does not wedge the
// shared instance, and that the instance really is reused (construction counter).

import { describe, expect, it, on } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import { bundle, getLoadError, hasNativeLightningcss, loadNativeLightningcss, transform } from './index.js';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Nesting + a media-nested rule: lowered when `targets` is set, kept verbatim otherwise. */
const NESTED_CSS = '.btn { color: red; & .icon { padding: 4px; } &:hover { color: blue; } }';
const FIREFOX60 = 'firefox >= 60';

function writeTempCss(dir: string, name: string, css: string): string {
    const path = `${dir}/${name}`;
    GLib.file_set_contents(path, new TextEncoder().encode(css));
    return path;
}

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/lightningcss-native — module loading', async () => {
            await it('loads the GjsifyLightningcss typelib successfully', () => {
                expect(hasNativeLightningcss()).toBe(true);
                expect(getLoadError()).toBeNull();
                expect(typeof loadNativeLightningcss()?.Engine).toBe('function');
            });
        });

        await describe('@gjsify/lightningcss-native — shared engine: option independence', async () => {
            // Baselines are the FIRST observation of each option set, so a later
            // repeat that disagrees proves the engine remembered something.
            const plain = decode(transform({ filename: 'a.css', code: NESTED_CSS }).code);
            const lowered = decode(transform({ filename: 'a.css', code: NESTED_CSS, targets: FIREFOX60 }).code);

            await it('the fixture actually distinguishes targets (guards the guard)', () => {
                // If these ever collapse to the same string the contamination
                // assertions below become vacuous, so assert the premise.
                expect(plain).not.toBe(lowered);
                expect(lowered).toContain('.btn .icon');
            });

            await it('targets do not leak from a previous call', () => {
                // targets → no targets must reproduce the untargeted baseline.
                transform({ filename: 'a.css', code: NESTED_CSS, targets: FIREFOX60 });
                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS }).code)).toBe(plain);

                // …and the reverse direction too.
                transform({ filename: 'a.css', code: NESTED_CSS });
                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS, targets: FIREFOX60 }).code)).toBe(
                    lowered,
                );
            });

            await it('minify does not leak from a previous call', () => {
                const pretty = decode(transform({ filename: 'a.css', code: NESTED_CSS, minify: false }).code);
                const minified = decode(transform({ filename: 'a.css', code: NESTED_CSS, minify: true }).code);
                expect(pretty).not.toBe(minified);

                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS, minify: false }).code)).toBe(pretty);
                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS, minify: true }).code)).toBe(minified);
            });

            await it('a stored source map does not leak into a later map-less call', () => {
                const withMap = transform({ filename: 'a.css', code: NESTED_CSS, sourceMap: true });
                expect(withMap.map).toBeDefined();

                // The classic shared-state bug: engine keeps the last source map
                // and hands it back on a call that never asked for one.
                const withoutMap = transform({ filename: 'a.css', code: NESTED_CSS, sourceMap: false });
                expect(withoutMap.map).toBeUndefined();
            });

            await it('the filename of a previous call does not leak into a later source map', () => {
                transform({ filename: 'first.css', code: NESTED_CSS, sourceMap: true });
                const second = transform({ filename: 'second.css', code: NESTED_CSS, sourceMap: true });
                const map = JSON.parse(decode(second.map as Uint8Array)) as { sources: string[] };
                expect(map.sources.join(',')).toContain('second.css');
                expect(map.sources.join(',')).not.toContain('first.css');
            });

            await it('stays stable across many interleaved option changes', () => {
                // Repetition matters: a state leak that only shows after N calls
                // (an appended diagnostics list, a growing source map) would slip
                // past a single A → B → A pass.
                for (let i = 0; i < 25; i++) {
                    expect(decode(transform({ filename: 'a.css', code: NESTED_CSS }).code)).toBe(plain);
                    expect(decode(transform({ filename: 'a.css', code: NESTED_CSS, targets: FIREFOX60 }).code)).toBe(
                        lowered,
                    );
                }
            });
        });

        await describe('@gjsify/lightningcss-native — shared engine: error isolation', async () => {
            await it('surfaces a transform error and leaves the shared engine usable', () => {
                const baseline = decode(transform({ filename: 'a.css', code: NESTED_CSS }).code);

                // Empty input is rejected by the Rust layer (`empty input CSS`).
                expect(() => transform({ filename: 'a.css', code: '' })).toThrow();

                // A shared instance must not be wedged by the failed call.
                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS }).code)).toBe(baseline);
            });

            await it('surfaces a bundle error and leaves the shared engine usable', () => {
                const baseline = decode(transform({ filename: 'a.css', code: NESTED_CSS }).code);

                expect(() => bundle({ filename: '/nonexistent/gjsify-does-not-exist.css' })).toThrow();

                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS }).code)).toBe(baseline);
            });
        });

        await describe('@gjsify/lightningcss-native — shared engine: bundle/transform interop', async () => {
            const dir = GLib.Dir.make_tmp('gjsify-lightningcss-XXXXXX');
            const leaf = writeTempCss(dir, 'leaf.css', '.leaf { color: green; }');
            const entry = writeTempCss(dir, 'entry.css', `@import "./leaf.css";\n${NESTED_CSS}`);

            await it('bundle() resolves @import chains', () => {
                const out = decode(bundle({ filename: entry }).code);
                expect(out).toContain('.leaf');
                expect(out).toContain('.btn');
            });

            await it('bundle() and transform() do not contaminate each other', () => {
                const bundledPlain = decode(bundle({ filename: entry }).code);
                const transformedPlain = decode(transform({ filename: 'a.css', code: NESTED_CSS }).code);

                // Interleave both methods with different options on the one shared
                // engine; each must still reproduce its own baseline.
                bundle({ filename: entry, targets: FIREFOX60, minify: true });
                expect(decode(transform({ filename: 'a.css', code: NESTED_CSS }).code)).toBe(transformedPlain);

                transform({ filename: 'a.css', code: NESTED_CSS, targets: FIREFOX60, sourceMap: true });
                expect(decode(bundle({ filename: entry }).code)).toBe(bundledPlain);
            });

            await it('cleans up the temp fixture directory', () => {
                GLib.unlink(entry);
                GLib.unlink(leaf);
                GLib.rmdir(dir);
                expect(GLib.file_test(dir, GLib.FileTest.EXISTS)).toBe(false);
            });
        });

        await describe('@gjsify/lightningcss-native — shared engine: the engine really is reused', async () => {
            await it('constructs no further Engine instances after the first call', () => {
                const native = loadNativeLightningcss();
                expect(native).not.toBeNull();

                // Warm the module-level singleton so the counter below measures
                // steady-state behaviour, not the one-off lazy construction.
                transform({ filename: 'a.css', code: NESTED_CSS });

                const OriginalEngine = native!.Engine;
                let constructed = 0;
                const Counting = function (this: unknown) {
                    constructed++;
                    return new OriginalEngine();
                } as unknown as typeof OriginalEngine;

                let patched = false;
                try {
                    native!.Engine = Counting;
                    patched = native!.Engine === Counting;

                    for (let i = 0; i < 25; i++) transform({ filename: 'a.css', code: NESTED_CSS });
                } finally {
                    if (patched) native!.Engine = OriginalEngine;
                }

                // If the GI module object refuses the patch we cannot observe
                // construction at all — assert only when the double took effect,
                // so this never becomes a false failure on a stricter GJS.
                if (patched) expect(constructed).toBe(0);
                else expect(native!.Engine).toBe(OriginalEngine);
            });
        });
    });
};
