// SPDX-License-Identifier: MIT
// Phase 8: @ts-for-gir/language-server programmatic tests.
// Validates that the TypeScript Language Server validation API works in the
// bundled Node.js environment (TypeScript compiler runs in-process via the
// `typescript` npm package).
//
// GLib-specific GVariant type-inference tests (ported from
// refs/ts-for-gir/tests/language-server-validation/src/gvariant-validation.test.ts)
// require pre-generated @girs/glib-2.0 ambient declarations to be resolvable
// by the in-process TypeScript compiler.  That setup (generate + path-wiring)
// is deferred to a follow-up PR.  The tests here cover the language-server API
// surface and pure-TypeScript compilation paths that work without any GIR types.
//
// All tests run on Node.js only — the TypeScript compiler relies on `typescript`
// (a CJS package using __dirname to locate lib.*.d.ts files) which is bundled
// correctly for Node but not yet validated for GJS/SpiderMonkey 128.

import { describe, it, expect, on } from '@gjsify/unit';
import {
    validateTypeScript,
    validateGIRTypeScriptAuto,
    getIdentifierType,
    expectIdentifierType,
    type ValidationResult,
    type TypeExpectationResult,
} from '@ts-for-gir/language-server';

// Allow up to 30 s per test — the TypeScript compiler initialises its lib files
// on first use (cold cache) which can take several seconds on Node.
const TS_TIMEOUT_MS = 30_000;

export default async () => {
    // All language-server tests are Node.js only.
    // TypeScript compiler on GJS requires additional __dirname injection and
    // is tracked in STATUS.md "Open TODOs — Phase 8".
    await on('Node.js', async () => {
        await describe('@ts-for-gir/language-server — API surface', async () => {
            await it('exports validateTypeScript as a function', async () => {
                expect(typeof validateTypeScript).toBe('function');
            });

            await it('exports validateGIRTypeScriptAuto as a function', async () => {
                expect(typeof validateGIRTypeScriptAuto).toBe('function');
            });

            await it('exports getIdentifierType as a function', async () => {
                expect(typeof getIdentifierType).toBe('function');
            });

            await it('exports expectIdentifierType as a function', async () => {
                expect(typeof expectIdentifierType).toBe('function');
            });
        });

        await describe('@ts-for-gir/language-server — validateTypeScript (pure TS)', async () => {
            await it('returns success:true for valid TypeScript', async () => {
                const code = `const x: string = "hello"; const y: number = 42;`;
                const result: ValidationResult = validateTypeScript(code, { strict: false });
                expect(result.success).toBeTruthy();
                expect(Array.isArray(result.errors)).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('returns success:false for a type error', async () => {
                // Assigning a string to a number — should fail under strict mode.
                const code = `const x: number = "not a number";`;
                const result: ValidationResult = validateTypeScript(code, { strict: true });
                expect(result.success).toBeFalsy();
                expect(result.errors.length).toBeGreaterThan(0);
            }, { timeout: TS_TIMEOUT_MS });

            await it('result has errors and warnings arrays', async () => {
                const code = `const v = 1;`;
                const result: ValidationResult = validateTypeScript(code);
                expect(Array.isArray(result.errors)).toBeTruthy();
                expect(Array.isArray(result.warnings)).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('accepts a union type declaration', async () => {
                const code = `
                    type Status = 'ok' | 'error' | 'pending';
                    const s: Status = 'ok';
                `;
                const result = validateTypeScript(code);
                expect(result.success).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('detects an incorrect union member', async () => {
                const code = `
                    type Status = 'ok' | 'error';
                    const s: Status = 'unknown';
                `;
                const result = validateTypeScript(code, { strict: true });
                expect(result.success).toBeFalsy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('accepts a generic function type', async () => {
                const code = `
                    function identity<T>(x: T): T { return x; }
                    const n: number = identity(42);
                    const s: string = identity("hi");
                `;
                const result = validateTypeScript(code);
                expect(result.success).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });
        });

        await describe('@ts-for-gir/language-server — getIdentifierType (pure TS)', async () => {
            await it('returns the inferred type of a const declaration', async () => {
                const code = `const greeting = "hello";`;
                const result = getIdentifierType(code, 'greeting');
                expect(result.success).toBeTruthy();
                expect(result.type ?? result.documentation).toBeDefined();
            }, { timeout: TS_TIMEOUT_MS });

            await it('returns failure when identifier is not found', async () => {
                const code = `const x = 1;`;
                const result = getIdentifierType(code, 'nonExistent');
                expect(result.success).toBeFalsy();
            }, { timeout: TS_TIMEOUT_MS });
        });

        await describe('@ts-for-gir/language-server — expectIdentifierType (pure TS)', async () => {
            await it('matches a string literal type', async () => {
                const code = `const greeting = "hello";`;
                const result: TypeExpectationResult = expectIdentifierType(code, 'greeting', /string/);
                expect(result.success).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('matches a numeric literal type', async () => {
                const code = `const count = 42;`;
                const result = expectIdentifierType(code, 'count', /number/);
                expect(result.success).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('matches a boolean type', async () => {
                const code = `const flag: boolean = true;`;
                const result = expectIdentifierType(code, 'flag', /boolean/);
                expect(result.success).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('matches an array type', async () => {
                const code = `const items: string[] = [];`;
                const result = expectIdentifierType(code, 'items', /string.*\[\]/);
                expect(result.success).toBeTruthy();
            }, { timeout: TS_TIMEOUT_MS });

            await it('actualType field is populated on success', async () => {
                const code = `const x: number = 0;`;
                const result = expectIdentifierType(code, 'x', /number/);
                expect(result.actualType).toBeDefined();
            }, { timeout: TS_TIMEOUT_MS });
        });
    });
};
