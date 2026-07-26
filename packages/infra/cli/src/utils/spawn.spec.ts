// Unit tests for the unified `spawnToCompletion` wrapper.
//
// Runs on the CLI's Node harness (`test:node`), where `isGjs()` is false and
// therefore the streaming async path is always taken — which is exactly the
// contract to pin down: `completion` must NEVER change behaviour off GJS. The
// GJS-side half of the contract (a `'return'` caller must not park the CLI at
// 0% CPU after the child exits) is a whole-process property that only shows up
// in a real bundle, so it is guarded end-to-end by
// `tests/e2e/spawn-gjs-teardown` instead.

import { describe, expect, it } from '@gjsify/unit';
import { describeExit, spawnToCompletion } from './spawn.js';

/** A command that is guaranteed absent from PATH. */
const MISSING = 'gjsify-spawn-spec-definitely-not-a-command';

export default async () => {
    await describe('spawnToCompletion — exit codes', async () => {
        await it('resolves 0 for a successful child', async () => {
            const r = await spawnToCompletion('/bin/sh', ['-c', 'exit 0'], { completion: 'return' });
            expect(r.code).toBe(0);
            expect(r.signal).toBeNull();
        });

        await it('resolves (does not reject) with a non-zero exit code', async () => {
            const r = await spawnToCompletion('/bin/sh', ['-c', 'exit 7'], { completion: 'return' });
            expect(r.code).toBe(7);
            expect(r.signal).toBeNull();
        });

        await it('reports the same result for both completion contracts on Node', async () => {
            const onExit = await spawnToCompletion('/bin/sh', ['-c', 'exit 3'], { completion: 'exit' });
            const onReturn = await spawnToCompletion('/bin/sh', ['-c', 'exit 3'], { completion: 'return' });
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
            const r = await spawnToCompletion('/bin/sh', ['-c', 'echo hello-from-child'], {
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
            // The child writes a chunk and exits immediately; awaiting `close`
            // rather than `exit` is what guarantees the data is readable by the
            // time the caller flushes.
            let out = '';
            await spawnToCompletion('/bin/sh', ['-c', 'printf "a%.0s" $(seq 1 5000)'], {
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
                await spawnToCompletion('/bin/sh', ['-c', 'printf "%s" "$GJSIFY_SPAWN_SPEC_MARKER"'], {
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
                await spawnToCompletion('/bin/sh', ['-c', 'printf "%s" "$FORCE_COLOR"'], {
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
                await spawnToCompletion('/bin/sh', ['-c', 'printf "[%s]" "$FORCE_COLOR"'], {
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
            await spawnToCompletion('/bin/sh', ['-c', 'printf "%s" "$GJSIFY_SPAWN_SPEC_EXPLICIT"'], {
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
            let out = '';
            await spawnToCompletion('/bin/sh', ['-c', 'pwd'], {
                completion: 'exit',
                cwd: '/',
                stdio: 'pipe',
                onSpawn: (child) => {
                    child.stdout?.setEncoding('utf-8');
                    child.stdout?.on('data', (c: string) => {
                        out += c;
                    });
                },
            });
            expect(out.trim()).toBe('/');
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
