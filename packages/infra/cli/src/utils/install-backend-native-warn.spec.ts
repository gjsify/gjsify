// Unit tests for warnMissingNativeBuilds (install-backend-native.ts).
//
// gjsify install is node-free and does NOT run a package's install/postinstall
// lifecycle script, so a native package that ships no prebuild for the platform
// loads no binary (the @gjsify/node-gi 0.21.0 case). This surfaces that at install
// time WITHOUT running any script (node-free-preserving). These verify the warning
// fires only when a native build script exists AND no prebuild/build binary is present.
import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { warnMissingNativeBuilds } from './install-backend-native.js';

// Minimal ResolvedNode-shaped mock (structural — only name + installPath are read).
function node(name: string, installPath: string) {
    return {
        name,
        version: '1.0.0',
        tarballUrl: '',
        installPath,
        dependencies: {},
        optionalDependencies: {},
        // Declares no os/cpu/libc — the host-platform gate is a separate
        // concern (install-platform.spec.ts) and must not affect this warning.
        platform: {},
    };
}

// Capture logger: records [fmt, ...args] for each call.
function capture() {
    const calls: unknown[][] = [];
    const log = (...args: unknown[]) => {
        calls.push(args);
    };
    const warnedFor = (name: string) =>
        calls.some((c) => typeof c[0] === 'string' && c[0].includes('WARNING') && c.includes(name));
    return { log, calls, warnedFor };
}

export default async () => {
    await describe('warnMissingNativeBuilds', async () => {
        await it('WARNS for a native install-script package with no prebuild/build binary', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-native-warn-'));
            try {
                const dir = join(prefix, 'node_modules', 'native-pkg');
                mkdirSync(dir, { recursive: true });
                writeFileSync(
                    join(dir, 'package.json'),
                    JSON.stringify({ name: 'native-pkg', scripts: { install: 'node-gyp rebuild' } }),
                );
                const cap = capture();
                warnMissingNativeBuilds([node('native-pkg', 'node_modules/native-pkg')], prefix, cap.log);
                expect(cap.warnedFor('native-pkg')).toBeTruthy();
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('does NOT warn when a platform prebuild ships', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-native-warn-'));
            try {
                const dir = join(prefix, 'node_modules', 'native-pkg');
                const pb = join(dir, 'prebuilds', `${process.platform}-${process.arch}`);
                mkdirSync(pb, { recursive: true });
                writeFileSync(
                    join(dir, 'package.json'),
                    JSON.stringify({ name: 'native-pkg', scripts: { install: 'node-gyp rebuild' } }),
                );
                writeFileSync(join(pb, 'addon.node'), '');
                const cap = capture();
                warnMissingNativeBuilds([node('native-pkg', 'node_modules/native-pkg')], prefix, cap.log);
                expect(cap.calls.length).toBe(0);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('does NOT warn when a build/Release binary is present', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-native-warn-'));
            try {
                const dir = join(prefix, 'node_modules', 'native-pkg');
                const rel = join(dir, 'build', 'Release');
                mkdirSync(rel, { recursive: true });
                writeFileSync(
                    join(dir, 'package.json'),
                    JSON.stringify({ name: 'native-pkg', scripts: { install: 'node-gyp rebuild' } }),
                );
                writeFileSync(join(rel, 'addon.node'), '');
                const cap = capture();
                warnMissingNativeBuilds([node('native-pkg', 'node_modules/native-pkg')], prefix, cap.log);
                expect(cap.calls.length).toBe(0);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('does NOT warn for a package with no install/pre/postinstall script', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-native-warn-'));
            try {
                const dir = join(prefix, 'node_modules', 'plain-pkg');
                mkdirSync(dir, { recursive: true });
                writeFileSync(
                    join(dir, 'package.json'),
                    JSON.stringify({ name: 'plain-pkg', scripts: { build: 'tsc', test: 'node --test' } }),
                );
                const cap = capture();
                warnMissingNativeBuilds([node('plain-pkg', 'node_modules/plain-pkg')], prefix, cap.log);
                expect(cap.calls.length).toBe(0);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });
    });
};
