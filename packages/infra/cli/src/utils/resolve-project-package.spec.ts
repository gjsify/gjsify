// SPDX-License-Identifier: MIT
// Regression for the second half of the published-0.64.2 bug: `gjsify devtools`/
// `gjsify debug` generate an entry importing `@gjsify/devtools-mcp` from the
// CONSUMER's node_modules by design (see devtools.ts's header comment), so a
// consumer installing only `@gjsify/cli` (plus `@gjsify/devtools` +
// `@gjsify/devtools-protocol` transitively via `@gjsify/adwaita-app`) hit
// rolldown-plugin-gjsify's unresolved-workspace-import error two steps into a
// build it did not ask for. `resolveProjectPackage` is the pre-flight that turns
// that into an actionable message BEFORE any bundling starts.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectPackage } from './resolve-project-package.js';

export default async () => {
    await describe('resolveProjectPackage', async () => {
        await it('finds a scoped package installed directly in cwd/node_modules', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-resolve-pkg-'));
            try {
                const pkgDir = join(dir, 'node_modules', '@gjsify', 'devtools-mcp');
                mkdirSync(pkgDir, { recursive: true });
                writeFileSync(join(pkgDir, 'package.json'), '{"name":"@gjsify/devtools-mcp"}');
                expect(resolveProjectPackage(dir, '@gjsify/devtools-mcp')).toBe(pkgDir);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('walks up to a parent node_modules — the hoisted case', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-resolve-pkg-'));
            try {
                const pkgDir = join(dir, 'node_modules', '@gjsify', 'devtools-mcp');
                mkdirSync(pkgDir, { recursive: true });
                writeFileSync(join(pkgDir, 'package.json'), '{"name":"@gjsify/devtools-mcp"}');
                const nested = join(dir, 'packages', 'app');
                mkdirSync(nested, { recursive: true });
                expect(resolveProjectPackage(nested, '@gjsify/devtools-mcp')).toBe(pkgDir);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('reports undefined — never throws — when the package is not installed anywhere', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-resolve-pkg-'));
            try {
                mkdirSync(join(dir, 'node_modules', '@gjsify', 'devtools'), { recursive: true });
                writeFileSync(
                    join(dir, 'node_modules', '@gjsify', 'devtools', 'package.json'),
                    '{"name":"@gjsify/devtools"}',
                );
                // A consumer with @gjsify/devtools (transitive) but NOT devtools-mcp —
                // exactly the measured shape (@gjsify/cli + @gjsify/adwaita-app, no
                // direct devtools-mcp dependency).
                expect(resolveProjectPackage(dir, '@gjsify/devtools-mcp')).toBe(undefined);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
