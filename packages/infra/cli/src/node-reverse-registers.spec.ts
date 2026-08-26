// Regression coverage for the `--app node` reverse-bridge REGISTER routing.
//
// When a node build carries an EXPLICIT `--globals` register-inject stub
// (`pluginOptions.autoGlobalsInject` — a genuine GJS source asking for the DOM
// surface, e.g. the Excalibur/WebGLBridge capstone), `enableGjsRegistersForNode`
// rebuilds the base alias map so the injected register modules resolve to their
// REAL `@gjsify/*` bodies over `@gjsify/node-gi` instead of the plain-Node
// `@gjsify/empty` stubs:
//
//   1. every `<pkg>/register…` → `@gjsify/empty` entry is DROPPED,
//   2. the gjs target's bare→scoped register routes (`fetch/register/fetch` →
//      `@gjsify/fetch/register/fetch`, …) are merged in,
//   3. everything else — including NON-register `@gjsify/empty` routings —
//      stays byte-identical (the plain-Node loadability contract for
//      cross-platform packages is untouched when no inject stub is present:
//      the factory only applies this transform when one is).
//
// Tested from @gjsify/cli's `test:node` harness (like `node-gi-externals.spec`)
// — `@gjsify/rolldown-plugin-gjsify` has no test runner of its own.

import { describe, expect, it } from '@gjsify/unit';

import { enableGjsRegistersForNode, isGjsSourceBuild, setupForNode } from '@gjsify/rolldown-plugin-gjsify';
import { ALIASES_WEB_FOR_NODE, ALIASES_WEB_FOR_GJS } from '@gjsify/resolve-npm';

const REGISTER_SUBPATH_RE = /\/register(\/|$)/;

/** The non-register keys the reverse-bridge lift adds — see `routes solid-js…` below. */
const REVERSE_BRIDGE_ROUTED: Record<string, true> = { 'solid-js': true };

export default async () => {
    await describe('enableGjsRegistersForNode', async () => {
        const base: Record<string, string> = { ...(ALIASES_WEB_FOR_NODE as Record<string, string>) };
        const out = enableGjsRegistersForNode(base);

        await it('drops every register→empty routing', async () => {
            const leftoverEmptyRegisters = Object.entries(out).filter(
                ([key, value]) => value === '@gjsify/empty' && REGISTER_SUBPATH_RE.test(key),
            );
            expect(leftoverEmptyRegisters.length).toBe(0);
            // A concrete load-bearing example: the dom surface the capstone needs.
            expect(out['@gjsify/dom-elements/register/document']).toBeUndefined();
        });

        await it('merges the gjs bare→scoped register routes', async () => {
            for (const [key, value] of Object.entries(ALIASES_WEB_FOR_GJS as Record<string, string>)) {
                if (!REGISTER_SUBPATH_RE.test(key)) continue;
                expect(out[key]).toBe(value);
            }
            // Concrete: the XHR register Excalibur's Detector needs.
            expect(out['xmlhttprequest/register']).toBe('@gjsify/fetch/register/xhr');
        });

        await it('keeps non-register routings byte-identical', async () => {
            for (const [key, value] of Object.entries(base)) {
                if (REGISTER_SUBPATH_RE.test(key) || key in REVERSE_BRIDGE_ROUTED) continue;
                expect(out[key]).toBe(value);
            }
        });

        await it('does not mutate the input map', async () => {
            expect(base['@gjsify/dom-elements/register/document']).toBe('@gjsify/empty');
        });

        await it('routes solid-js to the client entry both legs share', async () => {
            // The measured cluster: solid-js's `node` condition is dist/server.js,
            // the SSR build whose `createEffect` has an EMPTY body — a perfect
            // initial render and not one reactive update reaching GTK. Sixteen of
            // @gjsify/gtk-host's node-leg suites failed as
            // `Expected ["second"], Actual ["first"]` while the identical source
            // passed on gjs, which ADR 0030 reads as a node-gi defect. The map's
            // own top-level `import`/`require` already point at the client build;
            // `node` merely shadows them, being declared first.
            expect(out['solid-js']).toBe('solid-js/dist/solid.js');
        });

        await it('leaves solid-js SUBPATHS alone', async () => {
            // `solid-js/universal` — the renderer @gjsify/gtk-host binds to —
            // declares no `node` condition at all and reaches the root through the
            // routed specifier. A prefix rule here would break it.
            expect(out['solid-js/universal']).toBeUndefined();
            expect(out['solid-js/store']).toBeUndefined();
        });
    });

    // Why the fix is a ROUTE and not a change to the resolve CONDITIONS — the
    // half a reader will otherwise try to simplify away.
    //
    // Dropping `node` from `conditionNames` does nothing: `platform: 'node'`
    // implies that condition whatever the list says (measured — solid-js stayed
    // on the SSR build). The lever that does work is `browser`, which outranks
    // `node` in solid-js's map, and taking it is the SYMMETRIC defect: the gjs
    // target can afford `browser` only because its ALIAS map has already
    // replaced the node-facing npm packages, while the reverse bridge lifts the
    // `/register` routes and keeps the rest real. Then `ws` — whose map declares
    // `browser` FIRST, pointing at a one-line
    // `throw new Error('ws does not work in the browser…')` — took the node-gi
    // consumer harness from `pass 19/19` to `0/5 passed, 10 failed`, every one
    // `W.WebSocket is not a constructor`.
    await describe('setupForNode — resolve conditions are the SAME for both build kinds', async () => {
        const resolveFor = async (pluginOptions: Parameters<typeof setupForNode>[0]['pluginOptions']) =>
            (await setupForNode({ output: { file: 'dist/x.mjs' }, pluginOptions })).options.resolve;
        const NODE_VIEW = {
            mainFields: ['module', 'main', 'browser'],
            conditionNames: ['require', 'node', 'module'],
        };

        await it('a reverse-bridge build keeps the node view', async () => {
            expect(await resolveFor({ nodeGiGlobalsInject: true })).toStrictEqual(NODE_VIEW);
            expect(await resolveFor({ autoGlobalsInject: '\0gjsify-inject-globals' })).toStrictEqual(NODE_VIEW);
        });

        await it('and so does a cross-platform build — byte-unchanged', async () => {
            expect(await resolveFor({})).toStrictEqual(NODE_VIEW);
        });
    });

    // The GATE that decides whether the lift above runs at all. Regression: the
    // two consumers of this question used to disagree — `emptyGirs` took the
    // union of both reverse-bridge signals while the register-alias lift took
    // only the explicit `--globals` stub. A plain `gjsify build … --app node` of
    // a genuine GJS source (recognised via `nodeGiGlobalsInject`) therefore got
    // its `@girs/*` routed through to `requireGi` while a `/register` import in
    // the SAME graph was still emptied, silently dropping the `'2d'` context
    // factory so `Canvas2DBridge.onReady` never fired. Guarded end-to-end by the
    // node-gi `test/canvas2d-bridge.test.mjs` golden; pinned cheaply here.
    await describe('isGjsSourceBuild — the reverse-bridge gate', async () => {
        await it('qualifies on the ambient-globals signal alone', async () => {
            expect(isGjsSourceBuild({ nodeGiGlobalsInject: true })).toBe(true);
        });

        await it('qualifies on the explicit --globals inject stub alone', async () => {
            expect(isGjsSourceBuild({ registerInject: '\0gjsify-inject-globals' })).toBe(true);
        });

        await it('does NOT qualify when neither signal is present', async () => {
            // A cross-platform package's node bundle must keep loading on plain
            // Node without node-gi installed — so the empty routing stays.
            expect(isGjsSourceBuild({})).toBe(false);
            expect(isGjsSourceBuild({ nodeGiGlobalsInject: false, registerInject: undefined })).toBe(false);
        });
    });
};
