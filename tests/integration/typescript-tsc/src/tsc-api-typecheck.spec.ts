// The real "does tsc work" probe: build an in-memory Program with a
// fixture source file, ask for diagnostics, assert the type-checker
// produced sensible answers on a hand-crafted snippet whose type
// errors we know in advance.
//
// Uses a `CompilerHost` with a literal `getSourceFile` implementation
// so we don't have to write a temp file through `@gjsify/fs` —
// the test stays self-contained and runs identically on both runtimes.

import { describe, expect, it } from '@gjsify/unit';
import ts from 'typescript';

/** Same shape but with the default-lib synthesised inline so the type
 *  checker can resolve `string` / `number` / `Array` etc. without
 *  needing to read TypeScript's lib.*.d.ts off disk (which would
 *  require functional @gjsify/fs at compile-host call time).
 */
function makeStandaloneHost(files: Record<string, string>): ts.CompilerHost {
    const sourceFiles = new Map<string, ts.SourceFile>();
    for (const [name, source] of Object.entries(files)) {
        sourceFiles.set(name, ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
    }
    return {
        getSourceFile: (name) => sourceFiles.get(name),
        writeFile: () => {},
        getCurrentDirectory: () => '/',
        getCanonicalFileName: (f) => f,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        getDefaultLibFileName: () => 'lib.d.ts',
        fileExists: (name) => sourceFiles.has(name),
        readFile: (name) => files[name],
        getEnvironmentVariable: () => '',
    };
}

// A minimal hand-rolled "lib" — just enough to type-check primitive
// arithmetic. Avoids the entire lib.*.d.ts file-loading machinery,
// which on GJS would go through @gjsify/fs and complicate the test
// orthogonally to what we want to measure.
const MINIMAL_LIB = `
interface Number { toString(): string; }
interface String { length: number; }
interface Boolean {}
interface Object {}
interface Function {}
interface Array<T> { length: number; }
declare var console: { log(...args: any[]): void };
`;

export default async () => {
    await describe('typescript compiler API — Program + diagnostics', async () => {
        await it('createSourceFile parses valid TS into a SourceFile', () => {
            const sf = ts.createSourceFile(
                'a.ts',
                'const x: number = 42;',
                ts.ScriptTarget.ESNext,
                true,
                ts.ScriptKind.TS,
            );
            expect(sf.kind).toBe(ts.SyntaxKind.SourceFile);
            expect(sf.fileName).toBe('a.ts');
            expect(sf.statements.length).toBe(1);
        });

        await it('createSourceFile flags a syntax error with parseDiagnostics', () => {
            const sf = ts.createSourceFile(
                'b.ts',
                'const x: number = ;', // missing initializer
                ts.ScriptTarget.ESNext,
                true,
                ts.ScriptKind.TS,
            );
            // parseDiagnostics is the internal field where parse errors land
            // before binder/checker run. TS stores them on the SourceFile.
            const parseDiagnostics = (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] })
                .parseDiagnostics;
            expect(parseDiagnostics).toBeDefined();
            expect((parseDiagnostics ?? []).length).toBeGreaterThan(0);
        });

        await it('Program builds end-to-end against an in-memory host', () => {
            const host = makeStandaloneHost({
                'lib.d.ts': MINIMAL_LIB,
                'main.ts': 'const x: number = 42; console.log(x.toString());',
            });
            const program = ts.createProgram(['main.ts'], { noEmit: true, skipLibCheck: true }, host);
            expect(typeof program.getCompilerOptions).toBe('function');
            expect(program.getSourceFiles().length).toBeGreaterThan(0);
        });

        await it('getPreEmitDiagnostics returns [] for correct code', () => {
            const host = makeStandaloneHost({
                'lib.d.ts': MINIMAL_LIB,
                'main.ts': 'const x: number = 42; console.log(x.toString());',
            });
            const program = ts.createProgram(['main.ts'], { noEmit: true, skipLibCheck: true }, host);
            const diags = ts.getPreEmitDiagnostics(program);
            // Filter to user-file diagnostics — synthesised lib may emit
            // benign warnings that aren't germane to the test.
            const userDiags = diags.filter((d) => d.file?.fileName === 'main.ts');
            expect(userDiags.length).toBe(0);
        });

        await it('getPreEmitDiagnostics catches a type mismatch', () => {
            const host = makeStandaloneHost({
                'lib.d.ts': MINIMAL_LIB,
                'main.ts': 'const x: number = "hello"; // ← type error',
            });
            const program = ts.createProgram(['main.ts'], { noEmit: true, skipLibCheck: true }, host);
            const diags = ts.getPreEmitDiagnostics(program);
            const userDiags = diags.filter((d) => d.file?.fileName === 'main.ts');
            expect(userDiags.length).toBeGreaterThan(0);
            // The error message should mention the mismatched types.
            const flat = ts.flattenDiagnosticMessageText(userDiags[0].messageText, '\n');
            expect(flat).toMatch(/string|number/);
        });

        await it('flattenDiagnosticMessageText handles chained DiagnosticMessageChain', () => {
            // A more advanced diagnostic emitted by some checker paths is
            // a `DiagnosticMessageChain`, not a flat string. Make sure the
            // helper unfolds it. We construct one directly because we
            // don't always reliably get one out of the user fixture.
            const chain: ts.DiagnosticMessageChain = {
                messageText: 'outer',
                category: ts.DiagnosticCategory.Error,
                code: 0,
                next: [{ messageText: 'inner', category: ts.DiagnosticCategory.Error, code: 0 }],
            };
            const flat = ts.flattenDiagnosticMessageText(chain, '\n');
            expect(flat).toContain('outer');
            expect(flat).toContain('inner');
        });
    });
};
