// SPDX-License-Identifier: MIT
// A bare assignment to an UNDECLARED name (ADR 0079's addendum): the Excalibur shape it
// exists for, the other names the same bug reaches, the six kinds of write it must NOT
// touch, and the four `--app` targets that compose it.
//
// The rewrite is only safe because of what it REFUSES, so the refusals are the tests that
// matter here — a `window` that is a local variable rewritten to `globalThis.window` would
// silently retarget a program that means something else, and no downstream suite would see
// it: the bundle still loads, and the wrong variable is written.

import { describe, expect, it } from '@gjsify/unit';

import { setupForBrowser } from '../app/browser.js';
import { setupForGjs } from '../app/gjs.js';
import { setupForNativescript } from '../app/nativescript.js';
import { setupForNode } from '../app/node.js';
import {
    findImplicitGlobalAssignments,
    implicitGlobalAssignPlugin,
    rewriteImplicitGlobalAssignments,
    IMPLICIT_GLOBAL_ASSIGN_PLUGIN,
} from './implicit-global-assign.js';

type Hook = { handler: (this: unknown, ...args: unknown[]) => unknown };

/**
 * The Excalibur 0.32.0 shape, adapted from
 * `refs/excalibur/src/engine/polyfill.ts`. The guard is what decides the branch and the
 * write is what throws: in a strict module body the bare assignment is a `ReferenceError`
 * on every runtime without a `window` (map-editor#300).
 */
const EXCALIBUR_POLYFILL = `export function polyfill() {
  if (typeof window === 'undefined') {
    window = { audioContext: function () { return; } };
  }
  if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
    window.requestAnimationFrame = function (callback) {
      window.setInterval(callback, 1000 / 60);
    };
  }
}`;

/** Plugin names of one orchestrator's plugin array, whatever shape an entry has. */
function pluginNames(plugins: unknown[]): string[] {
    const names: string[] = [];
    for (const entry of plugins) {
        const candidates = Array.isArray(entry) ? entry : [entry];
        for (const candidate of candidates) {
            if (
                candidate &&
                typeof candidate === 'object' &&
                typeof (candidate as { name?: unknown }).name === 'string'
            ) {
                names.push((candidate as { name: string }).name);
            }
        }
    }
    return names;
}

export default async () => {
    await describe('rewriteImplicitGlobalAssignments', async () => {
        await it('rewrites the Excalibur polyfill shape', () => {
            const out = rewriteImplicitGlobalAssignments(EXCALIBUR_POLYFILL, '/pkg/polyfill.js') ?? '';
            expect(out).toContain('globalThis.window = { audioContext: function () { return; } };');
            // Anchored, because `globalThis.window = {` CONTAINS the bare spelling.
            expect(out).not.toMatch(/(?:^|[^.\w$])window = \{ audioContext/);
        });

        await it('keeps the typeof guard, so the branch still decides itself', () => {
            const out = rewriteImplicitGlobalAssignments(EXCALIBUR_POLYFILL, '/pkg/polyfill.js') ?? '';
            // A define would rewrite the guard and flip every isomorphic branch in the
            // ecosystem (ADR 0079) — the reason this is a transform at all.
            expect(out).toContain("if (typeof window === 'undefined') {");
            expect(out).toContain("if (typeof window !== 'undefined' && !window.requestAnimationFrame)");
        });

        await it('reaches every free name, not only `window`', () => {
            // The subject is sloppy mode's implicit-global CREATION; `window` is only the
            // case with an ADR behind it. Each of these is a `ReferenceError` in a strict
            // module body for the same reason.
            expect(rewriteImplicitGlobalAssignments('self = globalThis;', '/pkg/a.js')).toBe(
                'globalThis.self = globalThis;',
            );
            expect(rewriteImplicitGlobalAssignments('document = { createElement() {} };', '/pkg/a.js')).toContain(
                'globalThis.document = { createElement() {} };',
            );
            expect(rewriteImplicitGlobalAssignments('function f() { foo = 1; }', '/pkg/a.js')).toBe(
                'function f() { globalThis.foo = 1; }',
            );
            // A write to a global the runtime ALREADY has is legal in strict mode, so
            // `globalThis.onerror = …` is an identity, not a change.
            expect(rewriteImplicitGlobalAssignments('onerror = function () {};', '/pkg/a.js')).toContain(
                'globalThis.onerror = function () {};',
            );
        });

        await it('takes the left of a for-in/for-of, which sloppy mode declared too', () => {
            expect(rewriteImplicitGlobalAssignments('for (key in obj) {}', '/pkg/a.js')).toBe(
                'for (globalThis.key in obj) {}',
            );
            expect(rewriteImplicitGlobalAssignments('for (val of list) {}', '/pkg/a.js')).toBe(
                'for (globalThis.val of list) {}',
            );
            // A declared loop head binds the name, so it stays the author's variable.
            expect(rewriteImplicitGlobalAssignments('for (const key in obj) {}', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('for (var key in obj) {}', '/pkg/a.js')).toBeNull();
        });

        await it('leaves a write ONTO a runtime object alone', () => {
            // `window.x = 1` is a member expression on the left: the guarded branches
            // around the Excalibur assignment all do it, and there is no error to fix.
            expect(rewriteImplicitGlobalAssignments('window.x = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('self.x = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('this.window = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('foo.window = 1;', '/pkg/a.js')).toBeNull();
        });

        await it('leaves a read alone', () => {
            expect(rewriteImplicitGlobalAssignments('const w = window;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('window.foo();', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('if (window === globalThis) {}', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('typeof window;', '/pkg/a.js')).toBeNull();
            expect(
                rewriteImplicitGlobalAssignments('typeof window !== "undefined" && window;', '/pkg/a.js'),
            ).toBeNull();
        });

        await it('skips a name the module DECLARES', () => {
            // A local variable, not a global: rewriting it would write globalThis.window
            // where the program means its own.
            expect(rewriteImplicitGlobalAssignments('var window; window = {};', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('let foo; foo = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('const foo = {};', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('import window from "x"; window = 1;', '/pkg/a.js')).toBeNull();
            expect(
                rewriteImplicitGlobalAssignments('export function f(window) { window = 1; }', '/pkg/a.js'),
            ).toBeNull();
            expect(rewriteImplicitGlobalAssignments('try {} catch (window) { window = 1; }', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('function window() {} window = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('class self {} self = 1;', '/pkg/a.js')).toBeNull();
            // A declaration in an OUTER scope still hides the name — the chain is walked,
            // not just the innermost function.
            expect(
                rewriteImplicitGlobalAssignments('const window = {}; export function f() { window = 1; }', '/pkg/a.js'),
            ).toBeNull();
            expect(
                rewriteImplicitGlobalAssignments(
                    'const document = {}; export function f() { document = 1; }',
                    '/pkg/a.js',
                ),
            ).toBeNull();
        });

        await it('rewrites for a function that does not bind it, beside one that does', () => {
            // The precision that makes this a transform rather than a text pass: a
            // parameter in a NEIGHBOUR function is not in scope in this one.
            const out = rewriteImplicitGlobalAssignments(
                'function other(window) { window = 1; } export function f() { window = 2; }',
                '/pkg/a.js',
            );
            expect(out).toContain('function other(window) { window = 1; }');
            expect(out).toContain('export function f() { globalThis.window = 2; }');
        });

        await it('keeps two free names in one module independent', () => {
            // The walk records bindings per NAME, so one declared name must not silence
            // the rewrite of another beside it.
            const out = rewriteImplicitGlobalAssignments(
                'let declared; export function f() { declared = 1; free = 2; }',
                '/pkg/a.js',
            );
            expect(out).toContain('let declared; export function f() { declared = 1; globalThis.free = 2; }');
        });

        await it('leaves every compound assignment and update expression alone', () => {
            // They read the name first, so sloppy mode threw on an undeclared one too;
            // rewriting would trade the ReferenceError for a silent result.
            expect(rewriteImplicitGlobalAssignments('foo ??= {};', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('foo ||= {};', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('foo += 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('foo++;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('--window;', '/pkg/a.js')).toBeNull();
        });

        await it('skips the names that can never be an implicit global', () => {
            // Non-writable global properties: assigning is a `TypeError` in strict mode and
            // a no-op in sloppy mode, so there is no ReferenceError here to fix.
            expect(rewriteImplicitGlobalAssignments('undefined = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('NaN = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('Infinity = 1;', '/pkg/a.js')).toBeNull();
            // `globalThis` is a writable global property: the write already works.
            expect(rewriteImplicitGlobalAssignments('globalThis = x;', '/pkg/a.js')).toBeNull();
            // The CommonJS wrapper parameters are LOCAL bindings the descent cannot see —
            // it parses `sourceType: 'module'`. Rewriting one detaches the module's own
            // exports object, which is how `readable-stream`'s Writable/Duplex/Transform
            // became `undefined` without a single error.
            expect(rewriteImplicitGlobalAssignments('exports = module.exports = {};', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('exports.foo = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('module.exports = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('require = noop;', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('__dirname = "/x";', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('__filename = "/x/y";', '/pkg/a.js')).toBeNull();
        });

        await it('refuses a module whose bindings are dynamic', () => {
            // `with` can supply the name from an object, and no static pass sees which.
            expect(rewriteImplicitGlobalAssignments('with (o) { window = 1; }', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('with (o) { foo = 1; }', '/pkg/a.js')).toBeNull();
        });

        await it('leaves a destructuring target alone — the shapes it does not carry', () => {
            // Documented gap, not an oversight: `extractBindingNames` yields names, not
            // source ranges, so a pattern needs a second positional walk. A shorthand
            // destructuring target stays broken until that walk exists.
            expect(rewriteImplicitGlobalAssignments('({ window } = obj);', '/pkg/a.js')).toBeNull();
            expect(rewriteImplicitGlobalAssignments('[a, b] = pair;', '/pkg/a.js')).toBeNull();
        });

        await it('reads a TypeScript source with its type syntax intact', () => {
            const out = rewriteImplicitGlobalAssignments(
                'if (typeof window === "undefined") { window = { audioContext() {} } as any; }',
                '/pkg/polyfill.ts',
            );
            expect(out).toContain('globalThis.window = { audioContext() {} } as any;');
        });

        await it('leaves the `<any>` assertion spelling alone — measured parser gap', () => {
            // Excalibur's SOURCE writes `window = <any>{…}`, and acorn-typescript 1.4.13
            // cannot read an angle-bracket assertion (measured: `Unexpected token`). The
            // shipped dist is plain JS, which is the shape that reaches a build; this
            // fixture is here so the day the parser gains it, somebody moves it back
            // into the rewriting test instead of leaving a silent gap.
            const out = rewriteImplicitGlobalAssignments(
                'if (typeof window === "undefined") { window = <any>{ audioContext: function () { return; } }; }',
                '/pkg/polyfill.ts',
            );
            expect(out).toBeNull();
        });

        await it('returns nothing for a source acorn cannot read', () => {
            // The measured blind spot of the pinned parser (`utils/scan-named-imports.ts`):
            // such a module keeps the bug and the bundler reports the parse itself.
            expect(
                rewriteImplicitGlobalAssignments('const x = 1 satisfies number; window = x;', '/pkg/a.ts'),
            ).toBeNull();
        });

        await it('is inert on a module with no assignment at all', () => {
            expect(rewriteImplicitGlobalAssignments('export const a = 1;', '/pkg/a.js')).toBeNull();
            expect(findImplicitGlobalAssignments('window = 1;', '/pkg/a.js')).toHaveLength(1);
            expect(findImplicitGlobalAssignments('window.x = 1;', '/pkg/a.js')).toHaveLength(0);
            expect(findImplicitGlobalAssignments('a = 1; b = 2;', '/pkg/a.js')).toHaveLength(2);
        });
    });

    await describe('implicitGlobalAssignPlugin', async () => {
        await it('rewrites through the hook, and only for a source file', async () => {
            const plugin = implicitGlobalAssignPlugin();
            expect(plugin.name).toBe(IMPLICIT_GLOBAL_ASSIGN_PLUGIN);
            const transform = (plugin as { transform: Hook | { handler: Hook['handler'] } }).transform as {
                handler: Hook['handler'];
            };
            const out = (await transform.handler('window = 1;', '/pkg/a.js')) as { code: string } | null;
            expect(out?.code).toBe('globalThis.window = 1;');
            const free = (await transform.handler('function f() { foo = 1; }', '/pkg/a.js')) as { code: string } | null;
            expect(free?.code).toBe('function f() { globalThis.foo = 1; }');
            // The filter is engine plumbing, so the handler re-applies it: `.css` and a
            // `.blp` reach a transform hook and acorn cannot read either.
            expect(await transform.handler('window = 1;', '/pkg/a.css')).toBeNull();
            expect(await transform.handler('window = 1;', '/pkg/a.blp')).toBeNull();
        });
    });

    await describe('app targets', async () => {
        // ADR 0079's addendum asks for EVERY target: the fix has to hold where `window` is
        // defined and where it is not, or the artifact a consumer gets depends on which
        // `--app` they happened to build with.
        const factoryInput = { output: { file: 'dist/out.mjs' }, pluginOptions: {} };

        await it('composes on --app gjs', async () => {
            const { plugins } = await setupForGjs(factoryInput);
            expect(pluginNames(plugins)).toContain(IMPLICIT_GLOBAL_ASSIGN_PLUGIN);
        });

        await it('composes on --app node', async () => {
            const { plugins } = await setupForNode(factoryInput);
            expect(pluginNames(plugins)).toContain(IMPLICIT_GLOBAL_ASSIGN_PLUGIN);
        });

        await it('composes on --app browser', async () => {
            const { plugins } = await setupForBrowser(factoryInput);
            expect(pluginNames(plugins)).toContain(IMPLICIT_GLOBAL_ASSIGN_PLUGIN);
        });

        await it('composes on --app nativescript', async () => {
            const { plugins } = await setupForNativescript(factoryInput);
            expect(pluginNames(plugins)).toContain(IMPLICIT_GLOBAL_ASSIGN_PLUGIN);
        });
    });
};
