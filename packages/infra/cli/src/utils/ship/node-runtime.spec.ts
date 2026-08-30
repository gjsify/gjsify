// SPDX-License-Identifier: MIT
// Resolving the bundled Node interpreter — the "does this work for a STRANGER"
// half of the three `@gjsify/node-runtime-*` packages.
//
// The claim these tests exist to hold up is a claim about somebody else's
// project: the shipper finds the interpreter BY NAME in the consumer's own
// `node_modules`, with no dependency edge from anything of gjsify's reaching it.
// A test that only exercised this monorepo could not
// distinguish that from "it works because it is sitting in our tree" — so every
// case below builds a throwaway consumer whose `node_modules` contains exactly
// one package and nothing of gjsify at all.
//
// And every case resolves `win32-x64` FROM THIS HOST, which is the second thing
// worth proving: assembling a Windows artifact on Linux or macOS is a supported
// path (ADR 0024 § A1), so nothing in the resolution may key on
// `process.platform`.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    isNodeRuntimeTarget,
    nodeRuntimeBinaryName,
    nodeRuntimePackageName,
    NODE_RUNTIME_TARGETS,
    resolveNodeRuntime,
    type NodeRuntimeTarget,
} from './node-runtime.js';

/**
 * A consumer project with one installed package and nothing else.
 *
 * `populate: false` plants the package WITHOUT its payload, which is not a
 * contrived case: `bin/` is gitignored, so that is precisely what the package
 * looks like in a checkout of this repository.
 */
function consumerWith(target: NodeRuntimeTarget, { populate = true } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-node-runtime-spec-'));
    const dir = join(root, 'node_modules', '@gjsify', `node-runtime-${target}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
            name: nodeRuntimePackageName(target),
            version: '0.44.0',
            type: 'module',
            main: './index.js',
            exports: { '.': { default: './index.js' } },
        }),
    );
    writeFileSync(join(dir, 'index.js'), 'export default {};\n');
    if (populate) {
        mkdirSync(join(dir, 'bin'), { recursive: true });
        writeFileSync(join(dir, 'bin', nodeRuntimeBinaryName(target)), 'MZ-not-really');
        writeFileSync(join(dir, 'bin', 'LICENSE'), 'Node.js is licensed for use as follows:\n');
    }
    return root;
}

export default async () => {
    await describe('nodeRuntimeBinaryName', async () => {
        await it('names the binary from the TARGET, never from the running host', async () => {
            // The bug this forecloses: a `process.platform`-derived name looks
            // for `node` inside the win32 package while packing a Windows
            // artifact on Linux, finds nothing, and reports a missing payload —
            // a wrong answer wearing the right error message.
            expect(nodeRuntimeBinaryName('win32-x64')).toBe('node.exe');
            expect(nodeRuntimeBinaryName('darwin-arm64')).toBe('node');
            expect(nodeRuntimeBinaryName('darwin-x64')).toBe('node');
        });
    });

    await describe('NODE_RUNTIME_TARGETS', async () => {
        await it('is exactly the three published targets — Linux is absent on purpose', async () => {
            // Linux gets NO package: a `.deb`/`.rpm` declares a dependency on the
            // distribution's Node instead (`depends.ts` → NODE_PACKAGE). Adding
            // `linux-x64` here would be adding a package that does not exist.
            expect([...NODE_RUNTIME_TARGETS]).toStrictEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
            expect(isNodeRuntimeTarget('linux-x64')).toBe(false);
            expect(isNodeRuntimeTarget('darwin-arm64')).toBe(true);
        });

        await it('derives one npm name per target', async () => {
            expect(nodeRuntimePackageName('win32-x64')).toBe('@gjsify/node-runtime-win32-x64');
        });
    });

    await describe('resolveNodeRuntime', async () => {
        await it('finds it BY NAME in a project that declares no gjsify dependency', async () => {
            // The whole third-party contract in one assertion: the consumer's
            // tree holds one package, no `optionalDependencies` edge exists
            // anywhere, and the shipper still finds the interpreter.
            const cwd = consumerWith('win32-x64');
            try {
                const found = resolveNodeRuntime('win32-x64', { cwd, env: {} });
                expect(found?.source).toBe('@gjsify/node-runtime-win32-x64');
                expect(found?.nodePath.endsWith('node.exe')).toBe(true);
                // The licence travels WITH the binary, in the same result: an
                // interpreter copied into an artifact without it is
                // redistribution with no terms attached.
                expect(found?.licensePath.endsWith('LICENSE')).toBe(true);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('returns null when the package is installed but not POPULATED', async () => {
            // What a checkout of this repository looks like — `bin/` is
            // gitignored and fetched on CI. Handing back a path to a file that is
            // not there would fail later, inside a copy, with the target's name
            // nowhere in the message.
            const cwd = consumerWith('darwin-arm64', { populate: false });
            try {
                expect(resolveNodeRuntime('darwin-arm64', { cwd, env: {} })).toBe(null);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('returns null, never throws, when nothing is installed at all', async () => {
            // Whether a missing interpreter is fatal depends on what is being
            // built, and only the caller can say so usefully.
            const cwd = mkdtempSync(join(tmpdir(), 'gjsify-node-runtime-empty-'));
            try {
                expect(resolveNodeRuntime('darwin-x64', { cwd, env: {} })).toBe(null);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('lets GJSIFY_NODE_RUNTIME win over an installed package', async () => {
            // The maintainer hatch: a patched or unpublished interpreter, without
            // publishing one to try it.
            const installed = consumerWith('darwin-arm64');
            const override = mkdtempSync(join(tmpdir(), 'gjsify-node-runtime-override-'));
            try {
                writeFileSync(join(override, 'node'), 'override');
                writeFileSync(join(override, 'LICENSE'), 'terms');
                const found = resolveNodeRuntime('darwin-arm64', {
                    cwd: installed,
                    env: { GJSIFY_NODE_RUNTIME: override },
                });
                expect(found?.source).toBe('GJSIFY_NODE_RUNTIME');
                expect(found?.binDir).toBe(override);
            } finally {
                rmSync(installed, { recursive: true, force: true });
                rmSync(override, { recursive: true, force: true });
            }
        });

        await it('falls through an override that is incomplete rather than trusting it', async () => {
            // A half-populated override directory must not shadow a good
            // installed package — the failure would read as "the package is
            // broken" when the environment variable is what is wrong.
            const installed = consumerWith('darwin-arm64');
            const override = mkdtempSync(join(tmpdir(), 'gjsify-node-runtime-partial-'));
            try {
                writeFileSync(join(override, 'node'), 'binary but no licence');
                const found = resolveNodeRuntime('darwin-arm64', {
                    cwd: installed,
                    env: { GJSIFY_NODE_RUNTIME: override },
                });
                expect(found?.source).toBe('@gjsify/node-runtime-darwin-arm64');
            } finally {
                rmSync(installed, { recursive: true, force: true });
                rmSync(override, { recursive: true, force: true });
            }
        });
    });
};
