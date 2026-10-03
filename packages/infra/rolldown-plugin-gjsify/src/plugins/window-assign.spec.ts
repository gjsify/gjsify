// SPDX-License-Identifier: MIT
// A bare assignment to an undeclared `window` (ADR 0079's addendum): the Excalibur shape
// it exists for, the four kinds of write it must NOT touch, and the four `--app` targets
// that compose it.
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
    findWindowAssignments,
    rewriteWindowAssignments,
    windowAssignPlugin,
    WINDOW_ASSIGN_PLUGIN,
} from './window-assign.js';

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
    await describe('rewriteWindowAssignments', async () => {
        await it('rewrites the Excalibur polyfill shape', () => {
            const out = rewriteWindowAssignments(EXCALIBUR_POLYFILL, '/pkg/polyfill.js') ?? '';
            expect(out).toContain('globalThis.window = { audioContext: function () { return; } };');
            // Anchored, because `globalThis.window = {` CONTAINS the bare spelling.
            expect(out).not.toMatch(/(?:^|[^.\w$])window = \{ audioContext/);
        });

        await it('keeps the typeof guard, so the branch still decides itself', () => {
            const out = rewriteWindowAssignments(EXCALIBUR_POLYFILL, '/pkg/polyfill.js') ?? '';
            // A define would rewrite the guard and flip every isomorphic branch in the
            // ecosystem (ADR 0079) — the reason this is a transform at all.
            expect(out).toContain("if (typeof window === 'undefined') {");
            expect(out).toContain("if (typeof window !== 'undefined' && !window.requestAnimationFrame)");
        });

        await it('leaves a write ONTO the runtime window alone', () => {
            // `window.x = 1` is a member expression on the left: the guarded branches
            // around the Excalibur assignment all do it, and there is no error to fix.
            const out = rewriteWindowAssignments('window.x = 1;', '/pkg/a.js');
            expect(out).toBeNull();
            expect(rewriteWindowAssignments('this.window = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('foo.window = 1;', '/pkg/a.js')).toBeNull();
        });

        await it('leaves a read alone', () => {
            expect(rewriteWindowAssignments('const w = window;', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('window.foo();', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('if (window === globalThis) {}', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('({ window } = obj);', '/pkg/a.js')).toBeNull();
        });

        await it('skips a window the module DECLARES', () => {
            // A local variable, not a global: rewriting it would write globalThis.window
            // where the program means its own.
            expect(rewriteWindowAssignments('var window; window = {};', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('let window; window = {};', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('const window = {};', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('import window from "x"; window = 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('export function f(window) { window = 1; }', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('try {} catch (window) { window = 1; }', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('function window() {} window = 1;', '/pkg/a.js')).toBeNull();
            // A declaration in an OUTER scope still hides the name — the chain is walked,
            // not just the innermost function.
            expect(
                rewriteWindowAssignments('const window = {}; export function f() { window = 1; }', '/pkg/a.js'),
            ).toBeNull();
        });

        await it('rewrites for a function that does not bind it, beside one that does', () => {
            // The precision that makes this a transform rather than a text pass: a
            // parameter in a NEIGHBOUR function is not in scope in this one.
            const out = rewriteWindowAssignments(
                'function other(window) { window = 1; } export function f() { window = 2; }',
                '/pkg/a.js',
            );
            expect(out).toContain('function other(window) { window = 1; }');
            expect(out).toContain('export function f() { globalThis.window = 2; }');
        });

        await it('rewrites the logical-assignment idiom, but not an arithmetic one', () => {
            // `??=` READS window on purpose — "unless there already is one" — so the read
            // is the author's, not a free global use.
            expect(rewriteWindowAssignments('window ??= {};', '/pkg/a.js')).toContain('globalThis.window ??= {}');
            expect(rewriteWindowAssignments('window ||= {};', '/pkg/a.js')).toContain('globalThis.window ||= {}');
            // `+=` is a value use: rewriting it would trade a Node build's ReferenceError
            // for a silent NaN, which is the wrong kind of fix.
            expect(rewriteWindowAssignments('window += 1;', '/pkg/a.js')).toBeNull();
            expect(rewriteWindowAssignments('window++;', '/pkg/a.js')).toBeNull();
        });

        await it('refuses a module whose bindings are dynamic', () => {
            // `with` can supply `window` from an object, and no static pass sees which.
            expect(rewriteWindowAssignments('with (o) { window = 1; }', '/pkg/a.js')).toBeNull();
        });

        await it('reads a TypeScript source with its type syntax intact', () => {
            const out = rewriteWindowAssignments(
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
            const out = rewriteWindowAssignments(
                'if (typeof window === "undefined") { window = <any>{ audioContext: function () { return; } }; }',
                '/pkg/polyfill.ts',
            );
            expect(out).toBeNull();
        });

        await it('returns nothing for a source acorn cannot read', () => {
            // The measured blind spot of the pinned parser (`utils/scan-named-imports.ts`):
            // such a module keeps the bug and the bundler reports the parse itself.
            expect(rewriteWindowAssignments('const x = 1 satisfies number; window = x;', '/pkg/a.ts')).toBeNull();
        });

        await it('is inert on a module with no assignment at all', () => {
            expect(rewriteWindowAssignments('export const a = 1;', '/pkg/a.js')).toBeNull();
            expect(findWindowAssignments('window = 1;', '/pkg/a.js')).toHaveLength(1);
            expect(findWindowAssignments('window.x = 1;', '/pkg/a.js')).toHaveLength(0);
        });
    });

    await describe('windowAssignPlugin', async () => {
        await it('rewrites through the hook, and only for a source file', async () => {
            const plugin = windowAssignPlugin();
            expect(plugin.name).toBe(WINDOW_ASSIGN_PLUGIN);
            const transform = (plugin as { transform: Hook | { handler: Hook['handler'] } }).transform as {
                handler: Hook['handler'];
            };
            const out = (await transform.handler('window = 1;', '/pkg/a.js')) as { code: string } | null;
            expect(out?.code).toBe('globalThis.window = 1;');
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
            expect(pluginNames(plugins)).toContain(WINDOW_ASSIGN_PLUGIN);
        });

        await it('composes on --app node', async () => {
            const { plugins } = await setupForNode(factoryInput);
            expect(pluginNames(plugins)).toContain(WINDOW_ASSIGN_PLUGIN);
        });

        await it('composes on --app browser', async () => {
            const { plugins } = await setupForBrowser(factoryInput);
            expect(pluginNames(plugins)).toContain(WINDOW_ASSIGN_PLUGIN);
        });

        await it('composes on --app nativescript', async () => {
            const { plugins } = await setupForNativescript(factoryInput);
            expect(pluginNames(plugins)).toContain(WINDOW_ASSIGN_PLUGIN);
        });
    });
};
