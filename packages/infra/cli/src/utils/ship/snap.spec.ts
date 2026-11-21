// SPDX-License-Identifier: MIT
// The Snap target (ADR 0149): what `snapcraft.yaml` says, what is refused before snapcraft
// runs, and how the row sits in the table.
//
// No snapcraft here — the leg that runs this is the one in CI, where there is none. What only
// the tool can answer (does the launcher find `gjs` through the platform snap, which plugs an
// app needs) is recorded in ADR 0149 as not yet measured, not asserted.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { encodeUtf8 } from './bytes.js';
import { FORMATS, defaultFormatIds } from './formats.js';
import {
    assertSnapIsPackable,
    renderSnapcraftManifest,
    renderSnapcraftYaml,
    SNAP_BASE,
    SNAP_TOOL,
    snapcraftArgs,
    writeSnapProject,
} from './snap.js';
import type { PackSettings } from './types.js';

function packSettings(overrides: Partial<PackSettings> = {}): PackSettings {
    return {
        binaryName: 'hello-app',
        appId: 'org.example.Hello',
        name: 'Hello App',
        version: '1.2.3',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['First paragraph.', 'Second paragraph.'],
        license: 'MIT',
        homepage: 'https://example.org/hello',
        section: 'utils',
        group: 'Applications/System',
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        app: 'gjs' as const,
        minGjsVersion: '1.86',
        minNodeVersion: '24',
        flatpak: {
            runtime: 'org.gnome.Platform',
            runtimeVersion: '50',
            sdk: 'org.gnome.Sdk',
            branch: 'stable',
            sdkExtensions: [],
            appendPath: [],
            finishArgs: [],
            cleanup: [],
        },
        ...overrides,
    };
}

const DESKTOP = 'share/applications/org.example.Hello.desktop';

function payload() {
    return [
        { path: 'bin/hello-app', mode: 0o755, data: encodeUtf8('#!/bin/sh\n') },
        { path: DESKTOP, mode: 0o644, data: encodeUtf8('[Desktop Entry]\n') },
    ];
}

export default async () => {
    await describe('ship: the snap target (ADR 0149)', async () => {
        await it('declares the gnome extension on the app and dumps the payload as the one part', async () => {
            const m = renderSnapcraftManifest({ settings: packSettings() }) as Record<string, any>;
            expect(m.name).toBe('hello-app');
            expect(m.base).toBe(SNAP_BASE);
            expect(m.confinement).toBe('strict');
            expect(m.apps['hello-app'].extensions).toStrictEqual(['gnome']);
            expect(m.apps['hello-app'].command).toBe('usr/bin/hello-app');
            expect(m.apps['hello-app'].desktop).toBe(`usr/${DESKTOP}`);
            expect(m.apps['hello-app']['common-id']).toBe('org.example.Hello');
            expect(m.apps['hello-app'].environment).toStrictEqual({
                GI_TYPELIB_PATH: '$SNAP/gnome-platform/usr/lib/$CRAFT_ARCH_TRIPLET_BUILD_FOR/gjs/girepository-1.0',
            });
            expect(m.parts['hello-app']).toStrictEqual({ plugin: 'dump', source: 'payload' });
        });

        await it('joins the description paragraphs and carries the homepage only when there is one', async () => {
            const m = renderSnapcraftManifest({ settings: packSettings() }) as Record<string, any>;
            expect(m.description).toBe('First paragraph.\n\nSecond paragraph.');
            expect(m.website).toBe('https://example.org/hello');
            const bare = renderSnapcraftManifest({ settings: packSettings({ homepage: undefined }) });
            expect('website' in bare).toBe(false);
        });

        await it('renders text that round-trips as JSON, which is also YAML', async () => {
            const text = renderSnapcraftYaml({ settings: packSettings() });
            expect(text.endsWith('\n')).toBe(true);
            expect(JSON.parse(text).name).toBe('hello-app');
        });

        await it('builds for the declared architecture, in LXD unless told otherwise', async () => {
            expect(snapcraftArgs({ target: '/o/x.snap', archLabel: 'amd64', destructive: false })).toStrictEqual([
                'pack',
                '--build-for=amd64',
                '--output',
                '/o/x.snap',
            ]);
            expect(snapcraftArgs({ target: '/o/x.snap', archLabel: 'arm64', destructive: true })).toContain(
                '--destructive-mode',
            );
        });

        await it('refuses what the store would refuse, naming the field', async () => {
            expect(() => assertSnapIsPackable(payload(), packSettings())).not.toThrow();
            for (const bad of ['Hello', 'hello_app', '-hello', 'hello--app', '123', 'a'.repeat(41)]) {
                expect(() => assertSnapIsPackable(payload(), packSettings({ binaryName: bad }))).toThrow(
                    'not a snap name',
                );
            }
            expect(() => assertSnapIsPackable(payload(), packSettings({ version: '1'.repeat(33) }))).toThrow(
                'longer than 32',
            );
            expect(() => assertSnapIsPackable(payload(), packSettings({ summary: 'x'.repeat(79) }))).toThrow(
                'store takes 78',
            );
        });

        await it('refuses a payload whose desktop entry is missing', async () => {
            expect(() => assertSnapIsPackable([payload()[0] as { path: string }], packSettings())).toThrow(DESKTOP);
        });

        await it('writes snap/snapcraft.yaml and the payload under usr/, wiping what was there', async () => {
            const work = mkdtempSync(join(tmpdir(), 'gjsify-snap-'));
            try {
                writeSnapProject({
                    settings: packSettings(),
                    payload: payload(),
                    workDir: work,
                    target: join(work, 'x.snap'),
                    archLabel: 'amd64',
                    verbose: false,
                });
                expect(JSON.parse(readFileSync(join(work, 'snap', 'snapcraft.yaml'), 'utf8')).name).toBe('hello-app');
                expect(existsSync(join(work, 'payload', 'usr', 'bin', 'hello-app'))).toBe(true);
                expect(existsSync(join(work, 'payload', 'usr', DESKTOP))).toBe(true);
            } finally {
                rmSync(work, { recursive: true, force: true });
            }
        });

        await it('sits in the table as an opt-in Linux container with the platform snap as its runtime', async () => {
            const row = FORMATS.snap;
            expect(row.prefix).toBe('/usr');
            expect(row.layoutOs).toBe('linux');
            expect(row.host.finishOn).toStrictEqual(['linux']);
            expect(row.host.requiredTools).toContain(SNAP_TOOL);
            expect(row.host.requiredTools).toContain('glib-compile-schemas');
            expect(row.depends).toBe(null);
            expect(row.interpreters).toStrictEqual(['gjs']);
            expect(row.archName('x64', false)).toBe('amd64');
            expect(row.archName('arm64', false)).toBe('arm64');
            expect(row.fileName(packSettings(), 'amd64')).toBe('hello-app_1.2.3_amd64.snap');
            expect(defaultFormatIds('linux')).not.toContain('snap');
        });
    });
};
