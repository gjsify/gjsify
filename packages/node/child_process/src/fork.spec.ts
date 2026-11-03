import { describe, it, expect, on } from '@gjsify/unit';
// fork() over Node's own IPC wire (ADR 0133): NODE_CHANNEL_FD, newline-framed JSON.
// Each parent runtime forks a child of each runtime, so the same tests prove
// Node parity (Node → Node), the GJS child (Node → GJS) and the GJS parent
// (GJS → GJS, GJS → Node). The child is `src/fixtures/fork-child.mjs`, bundled
// per runtime by `build:test:fixtures`.
import { fork, spawnSync, type ChildProcess, type ForkOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Runtime = 'gjs' | 'node';

const ON_GJS = typeof process.versions?.gjs === 'string';
const PARENT: Runtime = ON_GJS ? 'gjs' : 'node';

const STREAM_PAIR_REASON =
    'the committed @gjsify/sab-native prebuild predates make_stream_pair — `commit-prebuilds` lands it after this merges';

function hasBinary(bin: string): boolean {
    try {
        return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

function fixture(runtime: Runtime): string {
    return fileURLToPath(new URL(`./fixtures/fork-child.${runtime}.mjs`, import.meta.url));
}

/** A child of the parent's own runtime needs no options; the other one names its binary. */
function forkOptions(runtime: Runtime): ForkOptions {
    if (runtime === PARENT) return {};
    return runtime === 'gjs' ? { execPath: 'gjs', execArgv: ['-m'] } : { execPath: 'node' };
}

function forkChild(runtime: Runtime, args: string[]): ChildProcess {
    return fork(fixture(runtime), args, forkOptions(runtime));
}

interface Exit {
    code: number | null;
    signal: string | null;
}

/** Resolve on 'exit'; a stuck child is killed, so the test fails instead of hanging the run. */
function exited(child: ChildProcess, ms = 10000): Promise<Exit> {
    return new Promise((resolve) => {
        const guard = setTimeout(() => child.kill('SIGKILL'), ms);
        child.on('exit', (code, signal) => {
            clearTimeout(guard);
            resolve({ code, signal });
        });
    });
}

function nextMessage(child: ChildProcess): Promise<unknown> {
    return new Promise((resolve) => child.once('message', resolve));
}

function disconnected(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => child.once('disconnect', () => resolve()));
}

/**
 * Whether a GJS parent can open the channel at all: it needs `make_stream_pair`
 * from @gjsify/sab-native, which an old prebuild lacks. Probed through fork()
 * itself, so the answer is the one the tests below get.
 */
async function streamPairMissing(): Promise<boolean> {
    if (!ON_GJS) return false;
    let child: ChildProcess;
    try {
        child = forkChild('gjs', ['info']);
    } catch (e) {
        if ((e as { code?: string }).code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') return true;
        throw e;
    }
    await exited(child);
    return false;
}

export default async () => {
    const missing = await streamPairMissing();

    for (const runtime of ['node', 'gjs'] as const) {
        const bin = runtime === 'gjs' ? 'gjs' : 'node';
        if (runtime !== PARENT && !hasBinary(bin)) continue;

        await describe(`child_process.fork — ${PARENT} parent, ${runtime} child`, async () => {
            const marked = (expectation: string, callback: () => Promise<void>): Promise<void> =>
                it.failing(expectation, callback, STREAM_PAIR_REASON, { when: missing });

            await marked('opens the channel before the child runs and passes the args through', async () => {
                const child = forkChild(runtime, ['info', 'a', 'b']);
                const exit = exited(child);
                expect(await nextMessage(child)).toStrictEqual({
                    connected: true,
                    // The child removes both variables, so a grandchild never adopts the channel.
                    fd: null,
                    serialization: null,
                    args: ['a', 'b'],
                });
                await disconnected(child);
                expect(child.connected).toBe(false);
                expect(await exit).toStrictEqual({ code: 0, signal: null });
            });

            await marked("emits 'close' after a child-side disconnect", async () => {
                const child = forkChild(runtime, ['info']);
                const order: string[] = [];
                child.on('disconnect', () => order.push('disconnect'));
                child.on('exit', () => order.push('exit'));
                await new Promise<void>((resolve) => child.on('close', () => resolve()));
                expect(order.includes('disconnect')).toBe(true);
                expect(order.includes('exit')).toBe(true);
            });

            await marked('round-trips messages in both directions', async () => {
                const child = forkChild(runtime, ['echo']);
                const exit = exited(child);
                child.send('x');
                expect(await nextMessage(child)).toStrictEqual({ echo: 'x' });
                child.send({ n: [1, 2], s: 'ü\n' });
                expect(await nextMessage(child)).toStrictEqual({ echo: { n: [1, 2], s: 'ü\n' } });
                child.send('bye');
                await disconnected(child);
                expect(await exit).toStrictEqual({ code: 0, signal: null });
            });

            await marked("keeps the child alive on a 'disconnect' listener until the parent disconnects", async () => {
                const child = forkChild(runtime, ['wait']);
                const exit = exited(child);
                child.disconnect();
                expect(child.connected).toBe(false);
                // The child's 'disconnect' handler sets exitCode 7: it ran, so it was held.
                expect(await exit).toStrictEqual({ code: 7, signal: null });
            });

            await marked('reports ERR_IPC_CHANNEL_CLOSED for a send after disconnect', async () => {
                const child = forkChild(runtime, ['wait']);
                const exit = exited(child);
                child.disconnect();
                const error = await new Promise<Error | null>((resolve) => {
                    expect(child.send('late', (err: Error | null) => resolve(err))).toBe(false);
                });
                expect((error as { code?: string } | null)?.code).toBe('ERR_IPC_CHANNEL_CLOSED');
                await exit;
            });
        });
    }

    await describe('child_process.fork — options', async () => {
        await it("throws ERR_CHILD_PROCESS_IPC_REQUIRED without an 'ipc' stdio slot", async () => {
            let code: string | undefined;
            try {
                fork(fixture(PARENT), ['info'], { stdio: ['ignore', 'ignore', 'ignore'] });
            } catch (e) {
                code = (e as { code?: string }).code;
            }
            expect(code).toBe('ERR_CHILD_PROCESS_IPC_REQUIRED');
        });
    });

    await on('Gjs', async () => {
        await describe('child_process.fork — GJS limits', async () => {
            await it.failing(
                'throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM for a handle in send()',
                async () => {
                    const child = forkChild('gjs', ['echo']);
                    const exit = exited(child);
                    let code: string | undefined;
                    try {
                        child.send('x', {} as never);
                    } catch (e) {
                        code = (e as { code?: string }).code;
                    }
                    child.send('bye');
                    await exit;
                    expect(code).toBe('ERR_FEATURE_UNAVAILABLE_ON_PLATFORM');
                },
                STREAM_PAIR_REASON,
                { when: missing },
            );
        });
    });
};
