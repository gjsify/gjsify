// E2E guard for the SHIPPED typings of @gjsify/canvas2d. A consumer that
// compiles with `skipLibCheck: false` must not need lib.dom (GJS) or any
// nativescript types to import the package:
//
//   - fixture/gjs:     lib es2022, types @girs/gjs, NO DOM  → `@gjsify/canvas2d`
//   - fixture/browser: lib es2022 + DOM                     → `@gjsify/canvas2d/browser`
//
// The fixtures resolve workspace packages through the monorepo node_modules,
// so they type-check against the BUILT `lib/types` of every dependency.
// Requires `gjsify run build` of @gjsify/canvas2d and its dependencies.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const BUILT_TYPES = join(MONOREPO_ROOT, 'packages', 'framework', 'canvas2d', 'lib', 'types', 'index.d.ts');

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

describe('@gjsify/canvas2d — consumer typings', () => {
    it('has built types (precondition)', () => {
        assert.ok(existsSync(BUILT_TYPES), `build @gjsify/canvas2d first: ${BUILT_TYPES} missing`);
    });

    it('GJS consumer without lib.dom compiles the root entry', () => {
        const { code, output } = runGjsifyTsc(join(__dirname, 'fixture', 'gjs', 'tsconfig.json'));
        assert.equal(code, 0, `expected clean exit, got ${code}:\n${output}`);
    });

    it('browser consumer with lib.dom compiles ./browser', () => {
        const { code, output } = runGjsifyTsc(join(__dirname, 'fixture', 'browser', 'tsconfig.json'));
        assert.equal(code, 0, `expected clean exit, got ${code}:\n${output}`);
    });
});
