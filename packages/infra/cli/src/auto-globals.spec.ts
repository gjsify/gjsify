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
import { detectAutoGlobals } from '@gjsify/rolldown-plugin-gjsify/globals';

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
};
