// Runs on the CLI's Node harness (`test:node`), where `isGjs()` is false and the
// streaming async path is always taken — which is the contract to pin down:
// `completion` must NEVER change behaviour off GJS. The GJS half (a `'return'`
// caller must not park the CLI at 0% CPU after the child exits) is a whole-process
// property visible only in a real bundle, guarded by
// `tests/e2e/spawn-gjs-teardown`.

import { describe, expect, it } from '@gjsify/unit';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describeExit, spawnToCompletion } from './spawn.js';

/** A command that is guaranteed absent from PATH. */
const MISSING = 'gjsify-spawn-spec-definitely-not-a-command';

/**
 * A portable stand-in for `/bin/sh -c …`.
 *
 * No assertion here needs a shell to produce its observable, and `/bin/sh` does
 * not exist on Windows, where these rows all died of ENOENT before checking
 * anything. `process.execPath` is the one interpreter guaranteed present and
 * identical on every platform. `-e` also keeps the shell's quoting out of it:
 * `printf "%s" "$VAR"` has no cmd.exe equivalent, and an approximation would test
 * cmd's parser rather than this module.
 */
function node(script: string): [string, string[]] {
    return [process.execPath, ['-e', script]];
}

/** Echo one environment variable, so a child can report what it inherited. */
function echoEnv(name: string, fmt = '%s'): [string, string[]] {
    const [before, after] = fmt.split('%s');
    return node(
        `process.stdout.write(${JSON.stringify(before)} + (process.env[${JSON.stringify(name)}] ?? '') + ${JSON.stringify(after)})`,
    );
}

export default async () => {
    await describe('spawnToCompletion — exit codes', async () => {
        await it('resolves 0 for a successful child', async () => {
            const r = await spawnToCompletion(...node('process.exit(0)'), { completion: 'return' });
            expect(r.code).toBe(0);
            expect(r.signal).toBeNull();
        });

        await it('resolves (does not reject) with a non-zero exit code', async () => {
            const r = await spawnToCompletion(...node('process.exit(7)'), { completion: 'return' });
            expect(r.code).toBe(7);
            expect(r.signal).toBeNull();
        });

        await it('reports the same result for both completion contracts on Node', async () => {
            const onExit = await spawnToCompletion(...node('process.exit(3)'), { completion: 'exit' });
            const onReturn = await spawnToCompletion(...node('process.exit(3)'), { completion: 'return' });
            expect(onExit.code).toBe(onReturn.code);
            expect(onExit.signal).toBe(onReturn.signal);
        });
    });

    await describe('spawnToCompletion — spawn failures', async () => {
        await it('rejects with the raw errno error when no notFound mapper is given', async () => {
            let thrown: NodeJS.ErrnoException | null = null;
            try {
                await spawnToCompletion(MISSING, [], { completion: 'exit' });
            } catch (e) {
                thrown = e as NodeJS.ErrnoException;
            }
            expect(thrown !== null).toBe(true);
            expect(thrown?.code).toBe('ENOENT');
        });

        await it('maps ENOENT through notFound so callers keep their install hint', async () => {
            let thrown: Error | null = null;
            try {
                await spawnToCompletion(MISSING, [], {
                    completion: 'exit',
                    notFound: () => new Error('install it first'),
                });
            } catch (e) {
                thrown = e as Error;
            }
            expect(thrown?.message).toBe('install it first');
        });
    });

    await describe('spawnToCompletion — stdio + onSpawn', async () => {
        await it('exposes piped streams through onSpawn', async () => {
            let out = '';
            const r = await spawnToCompletion(...node("console.log('hello-from-child')"), {
                completion: 'exit',
                stdio: 'pipe',
                onSpawn: (child) => {
                    child.stdout?.setEncoding('utf-8');
                    child.stdout?.on('data', (c: string) => {
                        out += c;
                    });
                },
            });
            expect(r.code).toBe(0);
            expect(out).toContain('hello-from-child');
        });

        await it('resolves only after piped output has drained (close, not exit)', async () => {
            // The child writes a chunk and exits immediately: awaiting `close` rather
            // than `exit` is what guarantees the data is readable when the caller
            // flushes.
            let out = '';
            await spawnToCompletion(...node("process.stdout.write('a'.repeat(5000))"), {
                completion: 'exit',
                stdio: 'pipe',
                onSpawn: (child) => {
                    child.stdout?.setEncoding('utf-8');
                    child.stdout?.on('data', (c: string) => {
                        out += c;
                    });
                },
            });
            expect(out.length).toBe(5000);
        });
    });

    await describe('spawnToCompletion — environment', async () => {
        await it('inherits the parent environment by default', async () => {
            const prev = process.env.GJSIFY_SPAWN_SPEC_MARKER;
            process.env.GJSIFY_SPAWN_SPEC_MARKER = 'inherited';
            let out = '';
            try {
                await spawnToCompletion(...echoEnv('GJSIFY_SPAWN_SPEC_MARKER'), {
                    completion: 'exit',
                    stdio: 'pipe',
                    onSpawn: (child) => {
                        child.stdout?.setEncoding('utf-8');
                        child.stdout?.on('data', (c: string) => {
                            out += c;
                        });
                    },
                });
            } finally {
                if (prev === undefined) delete process.env.GJSIFY_SPAWN_SPEC_MARKER;
                else process.env.GJSIFY_SPAWN_SPEC_MARKER = prev;
            }
            expect(out).toBe('inherited');
        });

        await it('seeds FORCE_COLOR=1 when color is requested and the user set neither flag', async () => {
            const prevForce = process.env.FORCE_COLOR;
            const prevNo = process.env.NO_COLOR;
            delete process.env.FORCE_COLOR;
            delete process.env.NO_COLOR;
            let out = '';
            try {
                await spawnToCompletion(...echoEnv('FORCE_COLOR'), {
                    completion: 'exit',
                    color: true,
                    stdio: 'pipe',
                    onSpawn: (child) => {
                        child.stdout?.setEncoding('utf-8');
                        child.stdout?.on('data', (c: string) => {
                            out += c;
                        });
                    },
                });
            } finally {
                if (prevForce === undefined) delete process.env.FORCE_COLOR;
                else process.env.FORCE_COLOR = prevForce;
                if (prevNo === undefined) delete process.env.NO_COLOR;
                else process.env.NO_COLOR = prevNo;
            }
            expect(out).toBe('1');
        });

        await it('does not override an explicit NO_COLOR', async () => {
            const prevForce = process.env.FORCE_COLOR;
            const prevNo = process.env.NO_COLOR;
            delete process.env.FORCE_COLOR;
            process.env.NO_COLOR = '1';
            let out = '';
            try {
                await spawnToCompletion(...echoEnv('FORCE_COLOR', '[%s]'), {
                    completion: 'exit',
                    color: true,
                    stdio: 'pipe',
                    onSpawn: (child) => {
                        child.stdout?.setEncoding('utf-8');
                        child.stdout?.on('data', (c: string) => {
                            out += c;
                        });
                    },
                });
            } finally {
                if (prevForce === undefined) delete process.env.FORCE_COLOR;
                else process.env.FORCE_COLOR = prevForce;
                if (prevNo === undefined) delete process.env.NO_COLOR;
                else process.env.NO_COLOR = prevNo;
            }
            expect(out).toBe('[]');
        });

        await it('uses an explicit env verbatim when color is off', async () => {
            let out = '';
            await spawnToCompletion(...echoEnv('GJSIFY_SPAWN_SPEC_EXPLICIT'), {
                completion: 'exit',
                env: { ...process.env, GJSIFY_SPAWN_SPEC_EXPLICIT: 'explicit' },
                stdio: 'pipe',
                onSpawn: (child) => {
                    child.stdout?.setEncoding('utf-8');
                    child.stdout?.on('data', (c: string) => {
                        out += c;
                    });
                },
            });
            expect(out).toBe('explicit');
        });
    });

    await describe('spawnToCompletion — cwd', async () => {
        await it('runs the child in the requested working directory', async () => {
            // The temp dir rather than `/`: on Windows `/` means "root of the current
            // drive", so the child reported `C:\` and the assertion could never hold.
            // `realpathSync` because macOS hands out `/var/folders/…`, a symlink to
            // `/private/var/…`, and `process.cwd()` reports the resolved form.
            const dir = realpathSync(tmpdir());
            let out = '';
            await spawnToCompletion(...node('process.stdout.write(process.cwd())'), {
                completion: 'exit',
                cwd: dir,
                stdio: 'pipe',
                onSpawn: (child) => {
                    child.stdout?.setEncoding('utf-8');
                    child.stdout?.on('data', (c: string) => {
                        out += c;
                    });
                },
            });
            expect(out.trim()).toBe(dir);
        });
    });

    // The two options `runLifecycleScript` needs. Lacking them it was the one spawn
    // in the CLI that bypassed this helper (a raw `node:child_process.spawn`), which
    // under GJS armed `ensureMainLoop()` with nothing to tear it down: `gjsify pack`
    // on a package with a `prepack` parked at 0% CPU after writing its tarball
    // (#1010).
    await describe('spawnToCompletion — shell + inherit-stderr', async () => {
        await it('runs a command LINE through the shell', async () => {
            // `&&` is the observable: it is shell syntax, not argv.
            const r = await spawnToCompletion(
                `${JSON.stringify(process.execPath)} -e "process.exit(0)" && exit 3`,
                [],
                {
                    completion: 'return',
                    shell: true,
                },
            );
            expect(r.code).toBe(3);
        });

        await it('reports a shell command that fails', async () => {
            const r = await spawnToCompletion(`${JSON.stringify(process.execPath)} -e "process.exit(4)"`, [], {
                completion: 'return',
                shell: true,
            });
            expect(r.code).toBe(4);
        });

        await it('accepts inherit-stderr without disturbing the exit code', async () => {
            // Where the bytes LAND is an fd-level property this harness cannot observe
            // from inside the parent (the e2e that packs with `--json` covers it).
            // Asserted here: the mode is wired through both paths, not dropped.
            const r = await spawnToCompletion(...node("process.stdout.write('chatter'); process.exit(0)"), {
                completion: 'return',
                stdio: 'inherit-stderr',
            });
            expect(r.code).toBe(0);
        });

        await it('capture hands both streams back instead of emitting them', async () => {
            const r = await spawnToCompletion(
                ...node("process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"),
                { completion: 'return', stdio: 'capture' },
            );
            expect(r.code).toBe(3);
            expect(r.stdout).toBe('out');
            expect(r.stderr).toBe('err');
        });

        await it('capture composes with completion: return, unlike pipe', async () => {
            // The reason the mode exists: `'pipe'` hands back a live `ChildProcess`
            // the blocking path cannot produce, so it is `'exit'`-only — which left a
            // caller that must stay quiet on success and return normally (`gjsify
            // flatpak check`) with no option but a raw spawn.
            const r = await spawnToCompletion(...node('process.exit(0)'), {
                completion: 'return',
                stdio: 'capture',
            });
            expect(r.code).toBe(0);
            expect(r.stdout).toBe('');
            expect(r.stderr).toBe('');
        });
    });

    await describe('describeExit', async () => {
        await it('names the exit code on a normal exit', async () => {
            expect(describeExit({ code: 2, signal: null })).toBe('code 2');
        });

        await it('names the signal when the child was killed', async () => {
            expect(describeExit({ code: null, signal: 'SIGTERM' })).toBe('signal SIGTERM');
        });
    });
};
