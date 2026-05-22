// Smoke test: the `typescript` package loads + exposes its public API.
//
// If this fails on GJS, the cause is one of:
//   - module resolution (typescript's `main` / `exports` not reachable)
//   - synchronous top-level code that touches a Node-only API the
//     gjsify polyfill doesn't cover (e.g. specific os.platform branches)
//   - GJS-side ESM cycle that Node's loader tolerates but SpiderMonkey
//     rejects
//
// Each failure mode is informative — the test message names the
// specific symptom so a follow-up plan can target it.

import { describe, expect, it } from '@gjsify/unit';
import ts from 'typescript';

export default async () => {
    await describe('typescript module — load + version surface', async () => {
        await it('imports without throwing', () => {
            expect(typeof ts).toBe('object');
        });

        await it('exposes ts.version as a non-empty semver-shaped string', () => {
            expect(typeof ts.version).toBe('string');
            expect(ts.version.length).toBeGreaterThan(0);
            // semver shape: at least major.minor.patch with optional pre-release
            expect(ts.version).toMatch(/^\d+\.\d+\.\d+(-.+)?$/);
        });

        await it('exposes the core compiler API surface', () => {
            // The handful of entry points the rest of the suite reaches
            // for. If any of these is undefined, the module loaded but
            // some sub-tree failed silently — surface that as a hard
            // failure here so subsequent tests don't crash with cryptic
            // "X is not a function" messages.
            expect(typeof ts.createProgram).toBe('function');
            expect(typeof ts.createSourceFile).toBe('function');
            expect(typeof ts.getPreEmitDiagnostics).toBe('function');
            expect(typeof ts.flattenDiagnosticMessageText).toBe('function');
            expect(typeof ts.ScriptTarget).toBe('object');
            expect(typeof ts.ModuleKind).toBe('object');
        });

        await it('exposes the language-server entry (ts.server)', () => {
            // Used by tsserver-handshake.spec.ts. `ts.server` is the
            // internal namespace that hosts the LSP session machinery —
            // not part of the documented public API but stable enough
            // that VS Code's TS extension depends on it.
            expect(typeof ts.server).toBe('object');
        });
    });
};
