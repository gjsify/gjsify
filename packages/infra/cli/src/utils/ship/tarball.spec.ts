// `linux-tar` / `linux-tar-flatpak` (ADR 0142): the descriptor rows and the packer.
//
// The artifact is read back with this tree's own `parseTar` and compared with the
// payload it was built from — which is also the stage manifest's `staged[]`. The
// e2e suite repeats the read with GNU `tar`, which shares no code with the writer.

import { describe, expect, it } from '@gjsify/unit';
import { gunzip, parseTar } from '@gjsify/tar';

import { defaultFormatIds, FORMATS, FORMAT_IDS } from './formats.js';
import type { PayloadEntry } from './payload.js';
import { assertTarballHygiene, buildLinuxTarball, tarballTopDir } from './tarball.js';
import type { PackSettings } from './types.js';

const encoder = new TextEncoder();

const settings = { binaryName: 'hello-app', version: '1.2.3', release: '1', app: 'gjs' } as PackSettings;

function payload(entries: Array<[string, number, string]>): PayloadEntry[] {
    return entries.map(([path, mode, data]) => ({ path, mode, data: encoder.encode(data) }));
}

const PAYLOAD = payload([
    ['bin/hello-app', 0o755, '#!/bin/sh\nexec gjs -m "$0"\n'],
    ['lib/hello-app/main.js', 0o644, 'print(1)\n'],
    ['share/licenses/hello-app/LICENSE', 0o644, 'MIT\n'],
]);

export default async () => {
    await describe('linux-tar descriptors', async () => {
        await it('are in the closed vocabulary', () => {
            expect(FORMAT_IDS.includes('linux-tar')).toBe(true);
            expect(FORMAT_IDS.includes('linux-tar-flatpak')).toBe(true);
        });

        await it('never join the default Linux formats', () => {
            expect(defaultFormatIds('linux')).toStrictEqual(['deb', 'rpm']);
        });

        await it('name the archive <binary>-<version>-linux-<arch>[-flatpak].tar.gz', () => {
            expect(FORMATS['linux-tar'].fileName(settings, 'x86_64')).toBe('hello-app-1.2.3-linux-x86_64.tar.gz');
            expect(FORMATS['linux-tar-flatpak'].fileName(settings, 'x86_64')).toBe(
                'hello-app-1.2.3-linux-x86_64-flatpak.tar.gz',
            );
        });

        await it('map process.arch and refuse an unknown one', () => {
            expect(FORMATS['linux-tar'].archName('x64', true)).toBe('x86_64');
            expect(FORMATS['linux-tar'].archName('arm64', false)).toBe('aarch64');
            expect(() => FORMATS['linux-tar'].archName('mips', false)).toThrow();
        });

        await it('only the Flatpak variant needs the schema compiler and drops node', () => {
            expect(FORMATS['linux-tar'].host.requiredTools).toStrictEqual([]);
            expect(FORMATS['linux-tar-flatpak'].host.requiredTools).toStrictEqual(['glib-compile-schemas']);
            expect(FORMATS['linux-tar-flatpak'].interpreters).toStrictEqual(['gjs']);
        });
    });

    await describe('buildLinuxTarball', async () => {
        await it('holds exactly the payload under one top directory, with modes', async () => {
            const bytes = await buildLinuxTarball({
                settings,
                payload: PAYLOAD,
                archLabel: 'x86_64',
                mtime: 1700000000,
            });
            const entries = parseTar(await gunzip(bytes));
            const top = tarballTopDir(settings, 'x86_64');
            expect(top).toBe('hello-app-1.2.3-linux-x86_64');

            const files = entries.filter((e) => e.type === 'file');
            expect(files.map((e) => e.name).sort()).toStrictEqual(PAYLOAD.map((e) => `${top}/${e.path}`).sort());
            for (const entry of entries) expect(entry.name.startsWith(`${top}/`)).toBe(true);

            const launcher = files.find((e) => e.name === `${top}/bin/hello-app`);
            expect((launcher?.mode ?? 0) & 0o777).toBe(0o755);
            expect(launcher?.mtime).toBe(1700000000);
            for (const entry of PAYLOAD) {
                const read = files.find((e) => e.name === `${top}/${entry.path}`);
                expect(new TextDecoder().decode(read?.body)).toBe(new TextDecoder().decode(entry.data));
            }
        });

        await it('is byte-identical across two packs', async () => {
            const a = await buildLinuxTarball({ settings, payload: PAYLOAD, archLabel: 'x86_64', mtime: 5 });
            const b = await buildLinuxTarball({ settings, payload: PAYLOAD, archLabel: 'x86_64', mtime: 5 });
            expect(a).toStrictEqual(b);
        });
    });

    await describe('assertTarballHygiene', async () => {
        await it('refuses .env, .git, logs and a foreign node_modules', () => {
            for (const bad of [
                '.env',
                'lib/.env.local',
                'lib/.git/config',
                'share/run.log',
                'lib/node_modules/x/i.js',
            ]) {
                expect(() => assertTarballHygiene(payload([[bad, 0o644, 'x']]), settings)).toThrow();
            }
        });

        await it('allows node_modules for a Node payload', () => {
            const node = { ...settings, app: 'node' } as PackSettings;
            expect(() => assertTarballHygiene(payload([['lib/node_modules/x/i.js', 0o644, 'x']]), node)).not.toThrow();
        });

        await it('accepts a clean payload', () => {
            expect(() => assertTarballHygiene(PAYLOAD, settings)).not.toThrow();
        });
    });
};
