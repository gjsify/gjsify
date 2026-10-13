// E2E guard for the SHIPPED typings of @gjsify/adwaita-web, @gjsify/adwaita-nativescript and
// @gjsify/gtksource-nativescript. A consumer compiling with `skipLibCheck: false` (TS 6) must not
// see an error in OUR declarations, with or without lib.dom:
//
//   - fixture/web:    lib es2022, NO DOM  → `@gjsify/adwaita-web/canvas2d`
//   - fixture/web-dom: lib es2022 + DOM   → same entry, `onReady` takes DOM-typed callbacks
//   - fixture/ns:     lib es2022, NO DOM  → adwaita-nativescript (+ canvas2d) and gtksource-nativescript
//   - fixture/ns-dom: as ns plus DOM
//
// WHAT IS JUDGED. Only diagnostics located in our packages count. `@nativescript/core` is never
// loaded: its own `.d.ts` fail under TS 6 (and its `global-types.d.ts` redeclares `Reflect` and
// `WeakRef`, which collides with any TS 6 lib), and that is third-party. The ns fixtures
// resolve it to the ambient slice `adwaita-nativescript/src/ns-core.d.ts` (`types: []`, no
// `paths`), merged with `ns-core-contract.d.ts` — the members upstream 9.x declares on `View` and
// `GridLayout` that our widgets re-declare.
//
// KNOWN GAPS. Five widget members re-declare a NativeScript member under its GTK name with an
// incompatible type (TS2416). That is a pending rename-vs-widen decision, not a pass: the list is
// asserted EXACTLY, so a new clash fails the suite and so does a gap that was fixed but is still
// listed. Remove the entry when you fix it.
//
// Requires `gjsify run build` of the three packages and their dependencies.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const BUILT_TYPES = [
    ['web', 'adwaita-web'],
    ['nativescript-bridge', 'adwaita'],
    ['nativescript-bridge', 'gtksource'],
].map(([group, pkg]) => join(MONOREPO_ROOT, 'packages', group, pkg, 'lib', 'types', 'index.d.ts'));

/** `<Class>.<member>` pairs that are known TS2416 clashes with a NativeScript member. */
const KNOWN_GAPS = [
    'AdwBottomSheet.modal',
    'AdwDataGrid.columns',
    'AdwDataGrid.rows',
    'AdwSplitButton.direction',
    'AdwToggle.name',
];

/** Run `gjsify tsc -p <cfg>`; return { code, output }. */
function runGjsifyTsc(cfg) {
    try {
        const output = execFileSync('node', [CLI_ENTRY, 'tsc', '-p', cfg], {
            cwd: MONOREPO_ROOT,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, output };
    } catch (err) {
        return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

const fixture = (name) => join(__dirname, 'fixture', name, 'tsconfig.json');

/** The distinct diagnostics (`file CODE`) of an output, one per top-level error line. */
function diagnostics(output) {
    return output.split('\n').filter((line) => /^\S.*\(\d+,\d+\): error TS\d+:/.test(line));
}

/** `Class.member` of a TS2416 line (`Property 'm' in type 'C' is not assignable …`), else null. */
function clashOf(line) {
    const m = /error TS2416: Property '([^']+)' in type '([^']+)'/.exec(line);
    return m ? `${m[2]}.${m[1]}` : null;
}

describe('adwaita typings — consumer without skipLibCheck', () => {
    it('has built types (precondition)', () => {
        for (const file of BUILT_TYPES) assert.ok(existsSync(file), `build the package first: ${file} missing`);
    });

    for (const name of ['web', 'web-dom']) {
        it(`${name}: @gjsify/adwaita-web/canvas2d compiles`, () => {
            const { code, output } = runGjsifyTsc(fixture(name));
            assert.equal(code, 0, `expected clean exit, got ${code}:\n${output}`);
        });
    }

    for (const name of ['ns', 'ns-dom']) {
        it(`${name}: only the known gaps remain in our declarations`, () => {
            const { output } = runGjsifyTsc(fixture(name));
            const lines = diagnostics(output);
            const clashes = new Set();
            const other = [];
            for (const line of lines) {
                const clash = clashOf(line);
                if (clash) clashes.add(clash);
                else other.push(line);
            }
            assert.deepEqual(other, [], `unexpected diagnostics in the shipped declarations:\n${other.join('\n')}`);
            assert.deepEqual(
                [...clashes].sort(),
                [...KNOWN_GAPS].sort(),
                'KNOWN_GAPS is stale: a listed gap no longer errors, or a new one appeared',
            );
        });
    }
});
