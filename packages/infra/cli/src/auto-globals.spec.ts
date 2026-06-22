// Regression coverage for the `--app gjs` externals policy + the
// `isRegisterSubpath` predicate that enforces it.
//
// Invariant: `@gjsify/<pkg>/register[/<feature>]` (and the bare
// `<pkg>/register` form) MUST NEVER be externalized for `--app gjs`.
//
// Reasons (see AGENTS.md §Tree-shakeable globals — /register subpath
// convention):
//   - GJS's native ESM loader has no node_modules walker.
//   - GJS's native ESM loader does NOT follow `package.json#exports`
//     maps for bare specifiers.
// → An externalized `import '@gjsify/buffer/register'` at runtime
//   throws `Module not found` even when the file is physically present
//   on disk under `<pkg>/lib/esm/register.js` via the exports map.
//
// Force-inlining these in the externals predicate is the only safe
// option until upstream GJS gains an exports-map-aware resolver.
//
// The predicate `isRegisterSubpath` lives in @gjsify/rolldown-plugin-gjsify
// (`src/app/gjs.ts`) and is exercised from `setupForGjs`'s externals
// callback. We test it from @gjsify/cli's test harness because the
// plugin package has no `test:node` script of its own and @gjsify/cli
// already declares the plugin as a dependency.

import { describe, expect, it } from '@gjsify/unit';
import { isRegisterSubpath, createGjsExternalsPredicate } from '@gjsify/rolldown-plugin-gjsify';
import {
    detectAutoGlobals,
    detectFreeGlobals,
    isRegisterPathResolvable,
    filterResolvableRegisterPaths,
    describeGiBackedInjection,
} from '@gjsify/rolldown-plugin-gjsify/globals';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export default async () => {
    await describe('--app gjs externals: /register subpath invariant', async () => {
        await it('recognizes the bare-specifier register form', () => {
            expect(isRegisterSubpath('fetch/register')).toBe(true);
            expect(isRegisterSubpath('buffer/register')).toBe(true);
        });

        await it('recognizes the fully-qualified @gjsify register form', () => {
            expect(isRegisterSubpath('@gjsify/buffer/register')).toBe(true);
            expect(isRegisterSubpath('@gjsify/fetch/register')).toBe(true);
        });

        await it('recognizes the granular feature subpaths', () => {
            expect(isRegisterSubpath('@gjsify/node-globals/register/buffer')).toBe(true);
            expect(isRegisterSubpath('@gjsify/node-globals/register/process')).toBe(true);
            expect(isRegisterSubpath('@gjsify/node-globals/register/encoding')).toBe(true);
            expect(isRegisterSubpath('@gjsify/dom-events/register/event-target')).toBe(true);
            expect(isRegisterSubpath('@gjsify/fetch/register/xhr')).toBe(true);
        });

        await it('recognizes resolved on-disk register paths', () => {
            // Rolldown sees these after the alias plugin walks the
            // `<pkg>/register` specifier through node_modules.
            expect(
                isRegisterSubpath('/repo/node_modules/@gjsify/buffer/lib/esm/register.js'),
            ).toBe(true);
            expect(
                isRegisterSubpath('/repo/node_modules/@gjsify/node-globals/lib/esm/register/buffer.js'),
            ).toBe(true);
            expect(
                isRegisterSubpath('/repo/packages/web/fetch/lib/esm/register/xhr.js'),
            ).toBe(true);
        });

        await it('does NOT match unrelated specifiers', () => {
            // Plain `@gjsify/<pkg>` root entries are inlined by the
            // alias layer + Rolldown's resolver; they don't need the
            // register-shape carve-out.
            expect(isRegisterSubpath('@gjsify/buffer')).toBe(false);
            expect(isRegisterSubpath('buffer')).toBe(false);
            // Externals that LOOK register-adjacent must still go through
            // the normal externals path.
            expect(isRegisterSubpath('gi://Gtk?version=4.0')).toBe(false);
            expect(isRegisterSubpath('cairo')).toBe(false);
            expect(isRegisterSubpath('register')).toBe(false);
            // Word boundary — `unregister` must not match.
            expect(isRegisterSubpath('@something/unregister')).toBe(false);
            expect(isRegisterSubpath('foo/unregister/bar')).toBe(false);
            // Query strings on disk paths (Rolldown adds these for
            // synthetic ids) — disambiguate vs. the resolved-path
            // regex's strict `.js` tail.
            expect(isRegisterSubpath('foo/register.js?query=1')).toBe(false);
        });

        await it('matches both @gjsify and non-@gjsify scoped register shapes', () => {
            // Some npm packages (the curated set in
            // ALIASES_WEB_FOR_GJS) expose a bare-specifier `/register`
            // path that the alias layer rewrites to @gjsify. Both the
            // pre- and post-rewrite forms must be matched so the
            // externals predicate sees `false` on either side of the
            // alias plugin.
            expect(isRegisterSubpath('webcrypto/register')).toBe(true);
            expect(isRegisterSubpath('dom-exception/register')).toBe(true);
            expect(isRegisterSubpath('domparser/register')).toBe(true);
        });
    });

    await describe('createGjsExternalsPredicate — full --app gjs externals policy', async () => {
        // The predicate backs BOTH the in-process alias layer and the
        // `externalsPlugin` resolveId hook in setupForGjs's plugin chain.
        // The hook form is what makes the policy hold under the native
        // engine (a function `external` OPTION is dropped at the JSON
        // boundary — the third shipped instance of that class).

        await it('externalizes gi:// URIs by prefix', () => {
            const external = createGjsExternalsPredicate();
            expect(external('gi://Gtk?version=4.0')).toBe(true);
            expect(external('gi://GLib?version=2.0')).toBe(true);
        });

        await it('externalizes the GJS built-in string specifiers by exact name', () => {
            const external = createGjsExternalsPredicate();
            expect(external('cairo')).toBe(true);
            expect(external('gettext')).toBe(true);
            expect(external('system')).toBe(true);
        });

        await it('externalizes user bundler.external entries by exact name', () => {
            const external = createGjsExternalsPredicate(['typedoc', 'prettier']);
            expect(external('typedoc')).toBe(true);
            expect(external('prettier')).toBe(true);
            // Exact match only — no prefix/glob semantics for user entries.
            expect(external('typedoc-plugin-foo')).toBe(false);
        });

        await it('does NOT externalize ordinary resolvable packages', () => {
            const external = createGjsExternalsPredicate();
            expect(external('three')).toBe(false);
            expect(external('@gjsify/buffer')).toBe(false);
        });

        await it('force-inlines register subpaths even when listed in user externals', () => {
            // The AGENTS.md invariant: `<pkg>/register[/<feature>]` MUST
            // NEVER be externalized for --app gjs — the carve-out fires
            // BEFORE the user-external check.
            const external = createGjsExternalsPredicate(['@gjsify/buffer/register', 'fetch/register']);
            expect(external('@gjsify/buffer/register')).toBe(false);
            expect(external('fetch/register')).toBe(false);
            expect(external('@gjsify/node-globals/register/buffer')).toBe(false);
        });
    });

    await describe('detectAutoGlobals — closure-map expansion vs generator bypass', async () => {
        // A fake AnalysisBundler whose output only ever references
        // `ReadableStream`. With the closure map active, pass 1 expands that
        // to the register module's full transitive set (Buffer, process, …)
        // and pass 2 verifies subset-convergence. With
        // `disableClosureExpansion` (the GENERATOR mode), the loop must stay
        // at exactly the detected identifier — generating THROUGH the
        // committed map would ratchet stale identifiers forever.
        const fakeBundler = async () => ['ReadableStream;\n'];
        const legacyFactory = () => [] as never;
        const analysis = { input: 'virtual-entry.ts', format: 'esm' as const };
        const pluginOpts = { app: 'gjs', format: 'esm' } as never;

        await it('expands pass-1 detection through the committed closure map by default', async () => {
            const { detected } = await detectAutoGlobals(
                analysis,
                pluginOpts,
                legacyFactory,
                false,
                {},
                fakeBundler,
            );
            expect(detected.has('ReadableStream')).toBe(true);
            // The web-streams register closure pulls shared infra globals.
            expect(detected.size > 1).toBe(true);
        });

        await it('disableClosureExpansion keeps the pure iterative result (generator mode)', async () => {
            const { detected } = await detectAutoGlobals(
                analysis,
                pluginOpts,
                legacyFactory,
                false,
                { disableClosureExpansion: true },
                fakeBundler,
            );
            expect(detected.has('ReadableStream')).toBe(true);
            expect(detected.size).toBe(1);
        });
    });

    // -------------------------------------------------------------------------
    // Fix (b): typeof-guard-only suppression in detectFreeGlobals
    // -------------------------------------------------------------------------
    await describe('detectFreeGlobals — typeof guard suppression (fix b)', async () => {
        await it('does NOT detect a global that appears only in a typeof guard', () => {
            // `typeof document !== 'undefined'` is a dead compat check on GJS.
            // It must NOT trigger injection of @gjsify/dom-elements/register/document.
            const code = `
                function guard() {
                    if (typeof document !== 'undefined') {
                        // dead branch — never reached on GJS
                    }
                }
                guard();
            `;
            const result = detectFreeGlobals(code);
            expect(result.has('document')).toBe(false);
        });

        await it('does NOT detect navigator appearing only in a typeof guard', () => {
            const code = `
                if (typeof navigator !== 'undefined') {
                    console.log('browser only');
                }
            `;
            const result = detectFreeGlobals(code);
            expect(result.has('navigator')).toBe(false);
        });

        await it('DOES detect a global that appears in a real use (not just typeof guard)', () => {
            // `document.getElementById` is a genuine use → must inject.
            const code = `
                if (typeof document !== 'undefined') {
                    document.getElementById('app');
                }
            `;
            const result = detectFreeGlobals(code);
            expect(result.has('document')).toBe(true);
        });

        await it('DOES detect a global with only a real use and no typeof guard', () => {
            const code = `document.getElementById('app');`;
            const result = detectFreeGlobals(code);
            expect(result.has('document')).toBe(true);
        });

        await it('handles multiple globals — suppresses typeof-only, keeps real uses', () => {
            // navigator: typeof guard only → suppressed
            // fetch: genuine call → kept
            const code = `
                if (typeof navigator !== 'undefined') { /* guard */ }
                fetch('/api');
            `;
            const result = detectFreeGlobals(code);
            expect(result.has('navigator')).toBe(false);
            expect(result.has('fetch')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Fix (a): resolvability gate in scan-globals / auto-globals
    // -------------------------------------------------------------------------
    await describe('isRegisterPathResolvable — package presence check (fix a)', async () => {
        // Walk up from process.cwd() — when this test runs from packages/infra/cli,
        // the gjsify monorepo node_modules is two or three levels above. The
        // isRegisterPathResolvable walker will find it automatically.
        const monoroot = process.cwd();

        await it('returns true for a package that is installed', () => {
            // @gjsify/fetch is a workspace dep — its package.json exists.
            expect(isRegisterPathResolvable('@gjsify/fetch/register/xhr', monoroot)).toBe(true);
        });

        await it('returns false for a package that is NOT installed', () => {
            // Use a deliberately-fictional package name.
            expect(isRegisterPathResolvable('@gjsify/__fixture-not-installed__/register', monoroot)).toBe(false);
        });

        await it('handles unscoped bare-specifier register paths', () => {
            // 'fetch/register' bare form — fetch is in node_modules via alias
            // resolution in most projects. Use the known-present one.
            // We can't guarantee 'fetch' (unscoped) is resolvable, so just
            // verify the function doesn't throw and returns a boolean.
            const result = isRegisterPathResolvable('fetch/register', monoroot);
            expect(typeof result).toBe('boolean');
        });
    });

    await describe('filterResolvableRegisterPaths — warns + filters unresolvable (fix a)', async () => {
        const monoroot = process.cwd();

        await it('passes through resolvable paths unchanged', () => {
            const paths = new Set(['@gjsify/fetch/register/xhr']);
            const result = filterResolvableRegisterPaths(paths, monoroot);
            expect(result.has('@gjsify/fetch/register/xhr')).toBe(true);
            expect(result.size).toBe(1);
        });

        await it('drops unresolvable paths and emits a warning', () => {
            const warnMessages: string[] = [];
            const origWarn = console.warn.bind(console);
            console.warn = (...args: unknown[]) => warnMessages.push(args.join(' '));
            try {
                const paths = new Set([
                    '@gjsify/fetch/register/xhr',
                    '@gjsify/__fixture-not-installed__/register/document',
                ]);
                const result = filterResolvableRegisterPaths(paths, monoroot);
                expect(result.has('@gjsify/fetch/register/xhr')).toBe(true);
                expect(result.has('@gjsify/__fixture-not-installed__/register/document')).toBe(false);
                expect(result.size).toBe(1);
                // A warning must have been emitted for the dropped path.
                expect(warnMessages.some((m) => m.includes('__fixture-not-installed__'))).toBe(true);
                expect(warnMessages.some((m) => m.includes('not installed'))).toBe(true);
            } finally {
                console.warn = origWarn;
            }
        });
    });

    await describe('detectAutoGlobals — skips injection when package absent (fix a)', async () => {
        // Repro for the bug: a bundle that references `document` only inside
        // a typeof guard AND @gjsify/dom-elements is NOT installed in the
        // project. Before the fix this caused an unresolved import error in
        // the analysis bundle on the NEXT pass.
        //
        // We simulate `@gjsify/dom-elements` being absent by using a fake cwd
        // that has no node_modules (the system /tmp directory).
        const fakeCwd = '/tmp';
        const legacyFactory = () => [] as never;
        const pluginOpts = { app: 'gjs', format: 'esm' } as never;

        await it('does not produce a register inject path when the package is absent (typeof-guard-only)', async () => {
            // Bundle output: `document` appears only in a typeof guard.
            // Fix (b) suppresses the detection; fix (a) provides the second
            // layer in case the detection somehow slips through.
            const fakeBundler = async () => [
                `if (typeof document !== 'undefined') { /* dead guard */ }\n`,
            ];
            const { injectPath } = await detectAutoGlobals(
                { input: 'entry.ts', format: 'esm' },
                pluginOpts,
                legacyFactory,
                false,
                { cwd: fakeCwd },
                fakeBundler,
            );
            // No inject stub should be written — document was only in a typeof guard.
            expect(injectPath).toBe(undefined);
        });

        await it('emits no unresolved register import when dom-elements is absent and document is typeof-guard-only', async () => {
            // This is the verbatim repro of the reported bug.
            // A dependency bundles: if (typeof document !== 'undefined') { ... }
            // @gjsify/dom-elements is NOT installed → before the fix this
            // caused a Rolldown ImportError on the analysis bundle.
            const fakeBundler = async () => [
                `// simulated npm dep with browser compat guard\n` +
                `var __guard = typeof document !== 'undefined';\n` +
                `if (__guard) { console.log('browser'); }\n`,
            ];
            // Should complete without throwing.
            let threw = false;
            try {
                await detectAutoGlobals(
                    { input: 'entry.ts', format: 'esm' },
                    pluginOpts,
                    legacyFactory,
                    false,
                    { cwd: fakeCwd },
                    fakeBundler,
                );
            } catch {
                threw = true;
            }
            expect(threw).toBe(false);
        });
    });

    await describe('detectAutoGlobals — regression: genuine use still injects (fix a guard)', async () => {
        // When @gjsify/fetch IS resolvable from the project and fetch is
        // genuinely used in the bundle, injection must still fire.
        // process.cwd() resolves into the gjsify monorepo which has @gjsify/fetch.
        const monoroot = process.cwd();
        const legacyFactory = () => [] as never;
        const pluginOpts = { app: 'gjs', format: 'esm' } as never;

        await it('injects fetch/register when fetch is genuinely used and package is installed', async () => {
            // Simulate a bundle that calls fetch() directly — a real use.
            const fakeBundler = async () => [`fetch('/api');\n`];
            const { detected } = await detectAutoGlobals(
                { input: 'entry.ts', format: 'esm' },
                pluginOpts,
                legacyFactory,
                false,
                { cwd: monoroot },
                fakeBundler,
            );
            expect(detected.has('fetch')).toBe(true);
        });

        await it('does NOT suppress a global that appears in typeof guard + real use', async () => {
            // `document` is in BOTH a typeof guard AND a real call.
            // Fix (b) must NOT suppress it when there is a genuine use.
            const fakeBundler = async () => [
                `if (typeof document !== 'undefined') { document.getElementById('x'); }\n`,
            ];
            const { detected } = await detectAutoGlobals(
                { input: 'entry.ts', format: 'esm' },
                pluginOpts,
                legacyFactory,
                false,
                { cwd: monoroot },
                fakeBundler,
            );
            expect(detected.has('document')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Fix (a) wiring: the REAL CLI build path must pass `cwd` into
    // detectAutoGlobals — otherwise the resolvability gate is dead code in
    // production (the gate is opt-in via `options.cwd`). This regression
    // guard fails if a refactor drops the `cwd` argument from the call site
    // in `actions/build.ts`, silently disabling the gate again.
    //
    // Resolve the source relative to process.cwd(): the test runner always
    // executes from the @gjsify/cli package root (same assumption as
    // affected-classifier.spec.ts).
    // -------------------------------------------------------------------------
    await describe('actions/build.ts — wires cwd into the auto-globals gate (fix a)', async () => {
        const buildActionPath = resolve(process.cwd(), 'src/actions/build.ts');

        await it('passes cwd into the detectAutoGlobals options object', async () => {
            const src = await readFile(buildActionPath, 'utf-8');

            // Locate the detectAutoGlobals(...) call in buildApp.
            const callIdx = src.indexOf('detectAutoGlobals(');
            expect(callIdx).toBeGreaterThan(-1);

            // Inspect the call body up to the next gjsifyPlugin call (the
            // final build) — the options object must contain `cwd:`.
            const after = src.slice(callIdx, callIdx + 1500);
            expect(after.includes('cwd: process.cwd()')).toBe(true);
        });

        await it('keeps passing the existing extraGlobalsList + excludeGlobals options', async () => {
            // Guard against an accidental options-object rewrite that drops
            // the pre-existing fields when adding cwd.
            const src = await readFile(buildActionPath, 'utf-8');
            const callIdx = src.indexOf('detectAutoGlobals(');
            const after = src.slice(callIdx, callIdx + 1500);
            expect(after.includes('extraGlobalsList: extras')).toBe(true);
            expect(after.includes('excludeGlobals')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // GI-backed register diagnostic (B): when --globals auto injects a register
    // that pulls a gi:// typelib, the build emits an actionable note instead of
    // letting the bundle crash silently at runtime in a GTK-less host.
    // -------------------------------------------------------------------------
    await describe('describeGiBackedInjection — GI-backed register note', async () => {
        await it('returns null when no injected register is GI-backed', () => {
            const registers = new Set(['@gjsify/node-globals/register/buffer', 'fetch/register/fetch']);
            const detected = new Set(['Buffer', 'fetch']);
            expect(describeGiBackedInjection(registers, detected)).toBeNull();
        });

        await it('names the gi:// namespaces and the triggering globals', () => {
            const registers = new Set([
                '@gjsify/dom-elements/register/document',
                '@gjsify/dom-elements/register/canvas',
            ]);
            // Buffer is detected too but maps to a non-GI register → not a trigger.
            const detected = new Set(['document', 'HTMLElement', 'HTMLCanvasElement', 'Buffer']);
            const note = describeGiBackedInjection(registers, detected);
            expect(note).toBeTruthy();
            const msg = note as string;
            expect(msg.includes('gi://Gdk')).toBe(true);
            expect(msg.includes('gi://GdkPixbuf')).toBe(true);
            // Trigger refs: the DOM globals that map into the injected GI registers.
            expect(msg.includes('document')).toBe(true);
            expect(msg.includes('HTMLElement')).toBe(true);
            expect(msg.includes('HTMLCanvasElement')).toBe(true);
            // Buffer must NOT be listed as a trigger (non-GI register).
            expect(msg.includes('Buffer')).toBe(false);
            // Actionable hint present.
            expect(msg.includes('excludeGlobals')).toBe(true);
        });

        await it('reports only the GI-backed subset in a mixed inject set', () => {
            const registers = new Set([
                '@gjsify/dom-elements/register/document',
                '@gjsify/node-globals/register/process',
            ]);
            const detected = new Set(['document', 'process']);
            const note = describeGiBackedInjection(registers, detected);
            expect(note).toBeTruthy();
            const msg = note as string;
            expect(msg.includes('gi://GdkPixbuf')).toBe(true);
            expect(msg.includes('document')).toBe(true);
            // `process` (non-GI) is not a trigger.
            expect(msg.includes('process')).toBe(false);
        });

        await it('matches every granular subpath of a GI-backed package via prefix', () => {
            // observers + font-face are also dom-elements register subpaths.
            const registers = new Set(['@gjsify/dom-elements/register/observers']);
            const detected = new Set(['IntersectionObserver']);
            const note = describeGiBackedInjection(registers, detected);
            expect(note).toBeTruthy();
            expect((note as string).includes('IntersectionObserver')).toBe(true);
        });
    });
};
