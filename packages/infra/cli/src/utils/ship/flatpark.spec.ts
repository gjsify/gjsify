// `gjsify flatpark` (ADR 0143): the rendered package directory.
//
// The rules under test are the two the Phase-0 spike measured: the unpack hook
// carries no version, and the same inputs give the same bytes.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    parseGithubRepo,
    readFlatparkSources,
    releaseDateOf,
    renderApplyExtra,
    renderFlatparkPackage,
    renderWrapper,
    withRelease,
    type FlatparkInputs,
} from './flatpark.js';
import { RELEASE_RECORD_SUFFIX } from './release-record.js';

const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>eu.example.Hello</id>
  <categories>
    <category>Utility</category>
  </categories>
  <keywords>
    <keyword>Greeting</keyword>
  </keywords>
</component>
`;

const INPUTS: FlatparkInputs = {
    appId: 'eu.example.Hello',
    name: 'Hello',
    binaryName: 'hello-app',
    summary: 'Says hello',
    version: '1.2.3',
    homepage: 'https://example.eu/hello/',
    repo: 'example/hello',
    flatpak: {
        runtime: 'org.gnome.Platform',
        runtimeVersion: '51',
        sdk: 'org.gnome.Sdk',
        finishArgs: ['--share=ipc', '--socket=wayland'],
    },
    sources: [
        {
            arch: 'x86_64',
            artifact: 'hello-app-1.2.3-linux-x86_64-flatpak.tar.gz',
            url: 'https://github.com/example/hello/releases/download/v1.2.3/hello-app-1.2.3-linux-x86_64-flatpak.tar.gz',
            sha256: 'a'.repeat(64),
            size: 1234,
        },
    ],
    desktopEntry: '[Desktop Entry]\nName=Hello\nExec=hello-app\nIcon=eu.example.Hello\n',
    metainfo: METAINFO,
    icon: { bytes: new Uint8Array([137, 80, 78, 71]), size: 128 },
    releaseDate: '2026-11-14',
};

function record(dir: string, artifact: string, arch: string, format = 'linux-tar-flatpak'): void {
    writeFileSync(
        join(dir, `${artifact}${RELEASE_RECORD_SUFFIX}`),
        JSON.stringify({ schema: 1, artifact, sha256: 'b'.repeat(64), size: 99, format, os: 'linux', arch }),
    );
}

export default async () => {
    await describe('gjsify flatpark', async () => {
        await it('writes exactly the eight files of a FlatPark package', () => {
            expect(renderFlatparkPackage(INPUTS).map((file) => file.path)).toStrictEqual([
                'eu.example.Hello.yml',
                'apply_extra.sh',
                'hello-app-wrapper',
                'eu.example.Hello.desktop',
                'eu.example.Hello.metainfo.xml',
                'eu.example.Hello.png',
                'flatpark.yml',
                'resolve-update.sh',
            ]);
        });

        await it('puts no version in the unpack hook, even for a versioned asset', () => {
            const hook = renderApplyExtra('hello-app');
            expect(hook.includes('1.2.3')).toBe(false);
            expect(/\d+\.\d+\.\d+/.test(hook)).toBe(false);
            expect(hook.includes('-linux-')).toBe(false);
            expect(hook.includes('find stage -mindepth 1 -maxdepth 1 -type d')).toBe(true);
            expect(renderWrapper('hello-app').includes('1.2.3')).toBe(false);
        });

        await it('derives the asserted launcher path from the binary name', () => {
            expect(renderApplyExtra('hello-app').includes('[ -x app/bin/hello-app ]')).toBe(true);
            expect(renderApplyExtra('other').includes('[ -x app/bin/other ]')).toBe(true);
            expect(renderWrapper('other')).toBe('#!/bin/sh\nset -eu\nexec /app/extra/app/bin/other "$@"\n');
            expect(() => renderApplyExtra('a b; rm')).toThrow();
        });

        await it('is byte-identical across two runs', () => {
            const first = renderFlatparkPackage(INPUTS);
            const second = renderFlatparkPackage({ ...INPUTS, sources: [...INPUTS.sources] });
            expect(second.length).toBe(first.length);
            for (const [index, file] of first.entries()) {
                expect(second[index]!.path).toBe(file.path);
                expect(second[index]!.mode).toBe(file.mode);
                expect(String(second[index]!.data)).toBe(String(file.data));
            }
        });

        await it('emits no absolute path, host name or clock reading', () => {
            for (const file of renderFlatparkPackage(INPUTS)) {
                if (typeof file.data !== 'string') continue;
                expect(/(^|[\s"'=])\/(home|tmp|root|Users)\//.test(file.data)).toBe(false);
            }
            expect(releaseDateOf(1_700_000_000)).toBe('2023-11-14');
        });

        await it('pins url, sha256 and size from the record inside the managed block', () => {
            const manifest = String(renderFlatparkPackage(INPUTS)[0]!.data);
            const block = manifest.slice(manifest.indexOf('# BEGIN MANAGED'), manifest.indexOf('# END MANAGED'));
            expect(block.includes(`sha256: ${'a'.repeat(64)}`)).toBe(true);
            expect(block.includes('size: 1234')).toBe(true);
            expect(block.includes('/releases/download/v1.2.3/')).toBe(true);
            expect(manifest.includes('runtime-version: "51"')).toBe(true);
        });

        await it('adds one dated release to a metainfo that has none', () => {
            const out = withRelease(METAINFO, '1.2.3', '2026-11-14');
            expect(out.includes('<release version="1.2.3" date="2026-11-14" />')).toBe(true);
            expect(withRelease(out, '9.9.9', '2030-01-01')).toBe(out);
        });

        await it('stops with a clear message when the release record is missing', () => {
            const dir = mkdtempSync(join(tmpdir(), 'flatpark-spec-'));
            try {
                expect(() => readFlatparkSources({ dir, repo: 'example/hello', version: '1.2.3', tagPrefix: 'v' })).toThrow(
                    'no release record',
                );
                record(dir, 'hello-app-1.2.3-linux-x64.tar.gz', 'x64', 'linux-tar');
                expect(() => readFlatparkSources({ dir, repo: 'example/hello', version: '1.2.3', tagPrefix: 'v' })).toThrow(
                    'no release record',
                );
                expect(() =>
                    readFlatparkSources({ dir: join(dir, 'absent'), repo: 'example/hello', version: '1.2.3', tagPrefix: 'v' }),
                ).toThrow('no release record');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('reads the record, maps the arch and derives the URL from repo and version', () => {
            const dir = mkdtempSync(join(tmpdir(), 'flatpark-spec-'));
            try {
                mkdirSync(dir, { recursive: true });
                record(dir, 'hello-app-1.2.3-linux-arm64-flatpak.tar.gz', 'arm64');
                record(dir, 'hello-app-1.2.3-linux-x64-flatpak.tar.gz', 'x64');
                const sources = readFlatparkSources({ dir, repo: 'example/hello', version: '1.2.3', tagPrefix: 'v' });
                expect(sources.map((source) => source.arch)).toStrictEqual(['aarch64', 'x86_64']);
                expect(sources[1]!.url).toBe(
                    'https://github.com/example/hello/releases/download/v1.2.3/hello-app-1.2.3-linux-x64-flatpak.tar.gz',
                );
                expect(sources[1]!.sha256).toBe('b'.repeat(64));
                expect(sources[1]!.size).toBe(99);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('takes the stage arch for a noarch record', () => {
            const dir = mkdtempSync(join(tmpdir(), 'flatpark-spec-'));
            try {
                record(dir, 'hello-app-1.2.3-linux-x86_64-flatpak.tar.gz', 'noarch');
                const args = { dir, repo: 'example/hello', version: '1.2.3', tagPrefix: 'v' };
                expect(readFlatparkSources({ ...args, stageArch: 'x64' })[0]!.arch).toBe('x86_64');
                expect(() => readFlatparkSources(args)).toThrow('no Flatpak arch');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('reads a repository from the spellings package.json uses', () => {
            expect(parseGithubRepo('JumpLink/beifahrer')).toBe('JumpLink/beifahrer');
            expect(parseGithubRepo('git+https://github.com/JumpLink/beifahrer.git')).toBe('JumpLink/beifahrer');
            expect(parseGithubRepo('https://github.com/JumpLink/beifahrer/')).toBe('JumpLink/beifahrer');
            expect(parseGithubRepo('https://gitlab.com/a/b')).toBe(undefined);
        });
    });
};
