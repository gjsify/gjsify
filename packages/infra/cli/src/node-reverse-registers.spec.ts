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
import { enableGjsRegistersForNode } from '@gjsify/rolldown-plugin-gjsify';
import { ALIASES_WEB_FOR_NODE, ALIASES_WEB_FOR_GJS } from '@gjsify/resolve-npm';

const REGISTER_SUBPATH_RE = /\/register(\/|$)/;

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
                if (REGISTER_SUBPATH_RE.test(key)) continue;
                expect(out[key]).toBe(value);
            }
        });

        await it('does not mutate the input map', async () => {
            expect(base['@gjsify/dom-elements/register/document']).toBe('@gjsify/empty');
        });
    });
};
