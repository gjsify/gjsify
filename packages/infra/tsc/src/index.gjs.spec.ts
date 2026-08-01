// GJS-only smoke tests for the committed @gjsify/tsc bundle (dist/tsc.gjs.mjs).
//
// The bundle is the actual artifact consumers reach for (via `gjsify-tsc`
// or the `./bundle` subpath). We exercise it end-to-end through a child
// `gjs -m <bundle> …` subprocess so the test mirrors how downstream
// integrations invoke it — `--version` and `-p <tsconfig>` against both a
// clean project (exit 0) and a buggy one (exit 2 + TS2322 diagnostic).
//
// .gjs.spec.ts because the bundle is a GJS executable; there is no Node
// target for `@gjsify/tsc` (the runtime triplet is
// `{gjs: "polyfill", node: "none", browser: "none"}`).

import { describe, it, expect, on } from '@gjsify/unit';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import { TSC_BUNDLE_PATH, TYPESCRIPT_VERSION } from './index.ts';

/** Run the committed bundle as `gjs -m <bundle> <args>` and capture stdio. */
function runTsc(args: string[]): { stdout: string; stderr: string; status: number } {
    const proc = Gio.Subprocess.new(
        ['gjs', '-m', TSC_BUNDLE_PATH, ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    const [, stdout, stderr] = proc.communicate_utf8(null, null);
    return {
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        status: proc.get_exit_status(),
    };
}

/** Create a throwaway tsconfig + source-file fixture, return its absolute path. */
function makeProject(filename: string, source: string, lib?: string[]): string {
    const tmp = GLib.dir_make_tmp('gjsify-tsc-spec-XXXXXX');
    if (!tmp) {
        throw new Error('GLib.dir_make_tmp returned null');
    }
    const tsconfig = JSON.stringify({
        compilerOptions: {
            noEmit: true,
            strict: true,
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            ...(lib ? { lib } : {}),
        },
        include: ['*.ts'],
    });
    GLib.file_set_contents(`${tmp}/tsconfig.json`, tsconfig);
    GLib.file_set_contents(`${tmp}/${filename}`, source);
    return tmp;
}

/** Recursive rmdir for the fixture; failure to clean up should not break the test. */
function cleanupProject(dir: string): void {
    try {
        const file = Gio.File.new_for_path(dir);
        const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let info = enumerator.next_file(null); info !== null; info = enumerator.next_file(null)) {
            file.get_child(info.get_name()).delete(null);
        }
        enumerator.close(null);
        file.delete(null);
    } catch {
        // Best-effort cleanup; the OS will eventually reap /tmp.
    }
}

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/tsc bundle (dist/tsc.gjs.mjs) — smoke tests', async () => {
            await it('--version returns the pinned TYPESCRIPT_VERSION', async () => {
                const { stdout, status } = runTsc(['--version']);
                expect(status).toBe(0);
                expect(stdout.trim()).toBe(`Version ${TYPESCRIPT_VERSION}`);
            });

            await it('-p on a clean project exits 0 with no diagnostics on stdout', async () => {
                const tmp = makeProject('ok.ts', 'const x: number = 42;\nconsole.log(x);\n');
                try {
                    const { stdout, status } = runTsc(['-p', tmp]);
                    expect(status).toBe(0);
                    // tsc only emits diagnostics-style lines on failure; a clean run is silent.
                    expect(stdout.includes('error TS')).toBe(false);
                } finally {
                    cleanupProject(tmp);
                }
            });

            await it('-p on a buggy project exits 2 with a TS2322 diagnostic', async () => {
                const tmp = makeProject('bad.ts', 'const x: number = "string";\n');
                try {
                    const { stdout, status } = runTsc(['-p', tmp]);
                    // tsc exits 2 when type errors are found (1 = bad CLI args).
                    expect(status).toBe(2);
                    expect(stdout).toContain('TS2322');
                    expect(stdout).toContain('bad.ts');
                } finally {
                    cleanupProject(tmp);
                }
            });

            // Drop-in regression: with an explicit `"lib": ["ESNext","DOM"]`,
            // the bundled `lib.*.d.ts` must resolve from the SHIPPED libs (the
            // consumer has no upstream `typescript`). Before the lib-resolution
            // fix this printed `error TS6053: File '…/lib.esnext.d.ts' not found`
            // + a cascade of `error TS2318: Cannot find global type 'Array'/…`.
            // Now the only error must be the deliberate Promise type mismatch.
            await it('resolves explicit "lib" without TS6053/TS2318 and still catches the deliberate error', async () => {
                const tmp = makeProject('libcheck.ts', 'const p: Promise<number> = "x";\nexport { p };\n', [
                    'ESNext',
                    'DOM',
                ]);
                try {
                    const { stdout, status } = runTsc(['-p', tmp]);
                    // No missing-lib / missing-global-type errors.
                    expect(stdout.includes('TS6053')).toBe(false);
                    expect(stdout.includes('TS2318')).toBe(false);
                    expect(stdout.includes('lib.esnext.d.ts')).toBe(false);
                    // The deliberate `Promise<number> = "x"` must still be caught.
                    expect(status).toBe(2);
                    expect(stdout).toContain('TS2322');
                    expect(stdout).toContain('libcheck.ts');
                } finally {
                    cleanupProject(tmp);
                }
            });
        });
    });
};
