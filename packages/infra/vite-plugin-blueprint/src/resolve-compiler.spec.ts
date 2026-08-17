// Every case here drives INJECTED host facts, so the win32 and darwin branches
// — which are most of this module, and the ones nobody can exercise from CI —
// are decided on a Linux box. A test that read ambient `process.platform` could
// only ever cover one third of the file, and it would be the third that has
// never been the problem.

import { join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';
import {
    BlueprintCompileError,
    BlueprintCompilerNotFoundError,
    type BlueprintHost,
    formatMissingBlueprintCompiler,
    resolveBlueprintCompiler,
} from './resolve-compiler.js';

/** A host with nothing installed. A case overrides only what it is about. */
function host(over: Partial<BlueprintHost> = {}): BlueprintHost {
    return { platform: 'linux', env: {}, exists: () => false, ...over };
}

/** `exists` backed by an explicit set, so a case states its whole filesystem. */
function withFiles(...paths: string[]): (path: string) => boolean {
    const present = new Set(paths);
    return (path) => present.has(path);
}

export default async () => {
    await describe('resolveBlueprintCompiler', async () => {
        await it('answers null on a host with nothing installed', async () => {
            expect(resolveBlueprintCompiler(host())).toBe(null);
        });

        await it('finds a POSIX compiler on PATH', async () => {
            const found = join('/usr/bin', 'blueprint-compiler');
            const resolved = resolveBlueprintCompiler(
                host({ env: { PATH: '/usr/local/bin:/usr/bin' }, exists: withFiles(found) }),
            );
            expect(resolved).toStrictEqual({ file: found, prefixArgs: [], source: 'path' });
        });

        await it('splits PATH on the separator the host uses, not the one we run on', async () => {
            // A win32 PATH split on ':' would break at the drive letter and find
            // nothing; a POSIX PATH split on ';' would yield one unusable entry.
            const win = join('C:\\Program Files\\bp', 'blueprint-compiler.exe');
            expect(
                resolveBlueprintCompiler(
                    host({
                        platform: 'win32',
                        env: { PATH: 'C:\\Windows\\System32;C:\\Program Files\\bp' },
                        exists: withFiles(win),
                    }),
                )?.file,
            ).toBe(win);

            expect(
                resolveBlueprintCompiler(
                    host({ env: { PATH: '/a;/b' }, exists: withFiles(join('/a', 'blueprint-compiler')) }),
                ),
            ).toBe(null);
        });

        await it('tries the win32 executable suffixes, and only there', async () => {
            const cmd = join('C:\\bin', 'blueprint-compiler.cmd');
            expect(
                resolveBlueprintCompiler(host({ platform: 'win32', env: { PATH: 'C:\\bin' }, exists: withFiles(cmd) }))
                    ?.file,
            ).toBe(cmd);

            // The same filesystem on POSIX is a miss: `.cmd` is not an executable
            // suffix there, and inventing one would find a file we cannot spawn.
            expect(resolveBlueprintCompiler(host({ env: { PATH: 'C:\\bin' }, exists: withFiles(cmd) }))).toBe(null);
        });

        await it('finds an MSYS2 install that is deliberately NOT on PATH', async () => {
            // The reason the MSYS2 probe exists: MSYS2 does not put its bin dirs
            // on the system PATH, so a PATH-only answer reports "missing" on a
            // host where every `.blp` would build.
            const bin = join('C:\\msys64', 'ucrt64', 'bin');
            const script = join(bin, 'blueprint-compiler');
            const python = join(bin, 'python.exe');
            const resolved = resolveBlueprintCompiler(
                host({ platform: 'win32', env: { PATH: 'C:\\Windows\\System32' }, exists: withFiles(script, python) }),
            );
            expect(resolved).toStrictEqual({
                file: python,
                prefixArgs: [script],
                env: { PATH: `${bin};C:\\Windows\\System32` },
                source: 'msys2',
            });
        });

        await it('spawns MSYS2 python rather than the shebang script Windows cannot execute', async () => {
            // A script with no interpreter beside it is not a usable answer.
            const bin = join('C:\\msys64', 'ucrt64', 'bin');
            expect(
                resolveBlueprintCompiler(
                    host({ platform: 'win32', exists: withFiles(join(bin, 'blueprint-compiler')) }),
                ),
            ).toBe(null);
        });

        await it('honours MSYS2_ROOT and USERPROFILE installs', async () => {
            const bin = join('D:\\dev\\msys64', 'mingw64', 'bin');
            expect(
                resolveBlueprintCompiler(
                    host({
                        platform: 'win32',
                        env: { MSYS2_ROOT: 'D:\\dev\\msys64' },
                        exists: withFiles(join(bin, 'blueprint-compiler'), join(bin, 'python.exe')),
                    }),
                )?.source,
            ).toBe('msys2');

            const userBin = join(join('C:\\Users\\p', 'msys64'), 'clang64', 'bin');
            expect(
                resolveBlueprintCompiler(
                    host({
                        platform: 'win32',
                        env: { USERPROFILE: 'C:\\Users\\p' },
                        exists: withFiles(join(userBin, 'blueprint-compiler'), join(userBin, 'python.exe')),
                    }),
                )?.source,
            ).toBe('msys2');
        });

        await it('never probes MSYS2 off win32', async () => {
            const bin = join('C:\\msys64', 'ucrt64', 'bin');
            const files = withFiles(join(bin, 'blueprint-compiler'), join(bin, 'python.exe'));
            expect(resolveBlueprintCompiler(host({ platform: 'darwin', exists: files }))).toBe(null);
            expect(resolveBlueprintCompiler(host({ exists: files }))).toBe(null);
        });

        await it('takes BLUEPRINT_COMPILER as a path when it names one', async () => {
            const resolved = resolveBlueprintCompiler(
                host({ env: { BLUEPRINT_COMPILER: '/opt/bp/bin/bpc' }, exists: withFiles('/opt/bp/bin/bpc') }),
            );
            expect(resolved).toStrictEqual({ file: '/opt/bp/bin/bpc', prefixArgs: [], source: 'env' });
        });

        await it('looks a bare BLUEPRINT_COMPILER name up on PATH', async () => {
            const found = join('/usr/bin', 'bpc');
            expect(
                resolveBlueprintCompiler(
                    host({ env: { BLUEPRINT_COMPILER: 'bpc', PATH: '/usr/bin' }, exists: withFiles(found) }),
                ),
            ).toStrictEqual({ file: found, prefixArgs: [], source: 'env' });
        });

        await it('refuses a set-but-unusable override instead of silently searching past it', async () => {
            // Returning the bad path sent its ENOENT into the "the compiler EXISTS
            // and refused the file" branch, which then blamed the .blp for a typo
            // in an environment variable. Falling through to PATH would instead
            // run a different compiler than the one the caller demanded.
            const onPath = join('/usr/bin', 'blueprint-compiler');
            expect(
                resolveBlueprintCompiler(
                    host({
                        env: { BLUEPRINT_COMPILER: '/typo/blueprint-compiler', PATH: '/usr/bin' },
                        exists: withFiles(onPath),
                    }),
                ),
            ).toBe(null);
            expect(
                resolveBlueprintCompiler(
                    host({ env: { BLUEPRINT_COMPILER: 'bpc', PATH: '/usr/bin' }, exists: withFiles(onPath) }),
                ),
            ).toBe(null);
        });
    });

    await describe('formatMissingBlueprintCompiler', async () => {
        await it('says what the compiler is FOR, not just that it is absent', async () => {
            expect(formatMissingBlueprintCompiler(host())).toContain('GtkBuilder XML');
        });

        await it('gives one Linux line that is right on every distro', async () => {
            const message = formatMissingBlueprintCompiler(host());
            expect(message).toContain('sudo dnf install blueprint-compiler');
            for (const manager of ['apt', 'pacman', 'zypper', 'apk']) {
                expect(message).toContain(manager);
            }
            expect(message).not.toContain('brew');
        });

        await it('names brew on darwin and MSYS2 on win32, and neither elsewhere', async () => {
            expect(formatMissingBlueprintCompiler(host({ platform: 'darwin' }))).toContain(
                'brew install blueprint-compiler',
            );
            const win = formatMissingBlueprintCompiler(host({ platform: 'win32' }));
            expect(win).toContain('mingw-w64-ucrt-x86_64-blueprint-compiler');
            // The conclusion this whole message exists to prevent — that the tool
            // is simply unavailable on Windows — is answered in the message.
            expect(win).toContain('no Windows wheel');
            expect(win).toContain('does NOT need to be on PATH');
            expect(win).not.toContain('sudo dnf');
        });

        await it('does not repeat "set BLUEPRINT_COMPILER" at someone who just set it', async () => {
            const missingPath = formatMissingBlueprintCompiler(host({ env: { BLUEPRINT_COMPILER: '/typo/bpc' } }));
            expect(missingPath).toContain('/typo/bpc');
            expect(missingPath).toContain('not a file that exists');
            expect(missingPath).not.toContain('sudo dnf');
            expect(missingPath).not.toContain('Or set BLUEPRINT_COMPILER');

            const missingName = formatMissingBlueprintCompiler(host({ env: { BLUEPRINT_COMPILER: 'bpc' } }));
            expect(missingName).toContain('not on PATH');
        });
    });

    await describe('the error classes', async () => {
        await it('BlueprintCompilerNotFoundError names the .blp and carries the hint', async () => {
            const error = new BlueprintCompilerNotFoundError('/src/main-window.blp', host());
            expect(error.name).toBe('BlueprintCompilerNotFoundError');
            expect(error.blueprintPath).toBe('/src/main-window.blp');
            expect(error.message).toContain('/src/main-window.blp');
            expect(error.message).toContain('sudo dnf install blueprint-compiler');
        });

        await it('BlueprintCompileError surfaces the compiler diagnostic and no install hint', async () => {
            // The reader has the compiler; repeating how to install it buries the
            // one line that tells them what is wrong with their template.
            const error = new BlueprintCompileError(
                '/src/main-window.blp',
                '/usr/bin/blueprint-compiler',
                'main-window.blp:3:1: expected `{`',
            );
            expect(error.name).toBe('BlueprintCompileError');
            expect(error.compilerFile).toBe('/usr/bin/blueprint-compiler');
            expect(error.message).toContain('/src/main-window.blp');
            expect(error.message).toContain('/usr/bin/blueprint-compiler');
            expect(error.message).toContain('expected `{`');
            expect(error.message).not.toContain('install');
            expect(error.message).not.toContain('BLUEPRINT_COMPILER');
        });
    });
};
