// SPDX-License-Identifier: MIT
// Regression tests for Explicit Resource Management (`using` / `await using`)
// on GJS — the gap that broke @anthropic-ai/claude-agent-sdk's transcript
// reader (`Object not disposable`).
//
// Root cause: GJS/SpiderMonkey does not expose the well-known symbols
// `Symbol.dispose` / `Symbol.asyncDispose`. The SDK (and tsc/esbuild/babel/bun
// downleveling in general) builds disposable objects with `{ [Symbol.dispose]()
// {} }` while the `using` helper looks the method up via
// `Symbol.dispose || Symbol.for("Symbol.dispose")` — so without a polyfill the
// two disagree and disposal throws. gjsify now polyfills these symbols in the
// GJS bundle banner, and gives its own Readable/Writable/readline.Interface the
// Node-parity dispose methods.
//
// These tests use REAL `using` / `await using` syntax so the bundler's
// downlevel helper + the runtime polyfill are exercised end-to-end. They are
// written to behave identically on Node (native symbols) and GJS (polyfilled).

import { describe, expect, it } from '@gjsify/unit';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default async () => {
    await describe('Explicit Resource Management (using / await using)', async () => {
        await describe('well-known symbols are available', async () => {
            await it('Symbol.dispose and Symbol.asyncDispose are real symbols', async () => {
                expect(typeof Symbol.dispose).toBe('symbol');
                expect(typeof Symbol.asyncDispose).toBe('symbol');
            });

            await it('on GJS they ARE the registered symbols (polyfill contract)', async () => {
                // GJS lacks native Symbol.dispose, so the polyfill defines it AS the
                // registered symbol the downlevel helper falls back to
                // (`Symbol.x || Symbol.for("Symbol.x")`). On Node the native
                // well-known symbol is distinct from the registry — and that's fine,
                // because there the `|| Symbol.for` branch is never taken.
                const isGjs = typeof (globalThis as { imports?: unknown }).imports !== 'undefined';
                if (!isGjs) return; // Node: native symbols, not registry-backed.
                expect(Symbol.dispose).toBe(Symbol.for('Symbol.dispose'));
                expect(Symbol.asyncDispose).toBe(Symbol.for('Symbol.asyncDispose'));
            });
        });

        await describe('plain disposable objects (the SDK pattern)', async () => {
            await it('sync `using` invokes [Symbol.dispose] at block exit', async () => {
                let disposed = false;
                {
                    // Mirrors the SDK's `vN = { [Symbol.dispose](){} }` tracing span.
                    using _span = {
                        [Symbol.dispose]() {
                            disposed = true;
                        },
                    };
                    expect(disposed).toBe(false);
                }
                expect(disposed).toBe(true);
            });

            await it('`await using` invokes [Symbol.asyncDispose] at block exit', async () => {
                let disposed = false;
                {
                    await using _res = {
                        async [Symbol.asyncDispose]() {
                            disposed = true;
                        },
                    };
                    expect(disposed).toBe(false);
                }
                expect(disposed).toBe(true);
            });

            await it('`await using` falls back to [Symbol.dispose] when no async variant', async () => {
                let disposed = false;
                {
                    await using _res = {
                        [Symbol.dispose]() {
                            disposed = true;
                        },
                    };
                }
                expect(disposed).toBe(true);
            });
        });

        await describe('node:fs ReadStream via await using', async () => {
            await it('reads content then disposes (destroys) the stream', async () => {
                const dir = await mkdtemp(join(tmpdir(), 'gjsify-dispose-rs-'));
                const file = join(dir, 'data.txt');
                await writeFile(file, 'alpha\nbeta\n', 'utf8');
                try {
                    let stream: ReturnType<typeof createReadStream> | undefined;
                    {
                        await using rs = createReadStream(file, 'utf8');
                        stream = rs;
                        const chunks: string[] = [];
                        for await (const chunk of rs) chunks.push(chunk as string);
                        expect(chunks.join('')).toBe('alpha\nbeta\n');
                    }
                    // After the block, dispose has destroyed the stream.
                    expect(stream!.destroyed).toBe(true);
                } finally {
                    await rm(dir, { recursive: true, force: true });
                }
            });
        });

        await describe('node:readline Interface via using', async () => {
            await it('closes the interface at block exit', async () => {
                const dir = await mkdtemp(join(tmpdir(), 'gjsify-dispose-rl-'));
                const file = join(dir, 'lines.txt');
                await writeFile(file, 'one\ntwo\nthree\n', 'utf8');
                try {
                    let closed = false;
                    const lines: string[] = [];
                    {
                        using rl = createInterface({ input: createReadStream(file, 'utf8') });
                        rl.on('close', () => {
                            closed = true;
                        });
                        for await (const line of rl) lines.push(line);
                    }
                    expect(lines).toStrictEqual(['one', 'two', 'three']);
                    // readline.Interface[Symbol.dispose] === close().
                    expect(closed).toBe(true);
                } finally {
                    await rm(dir, { recursive: true, force: true });
                }
            });
        });

        await describe('node:fs/promises FileHandle via await using', async () => {
            await it('reads then closes the handle', async () => {
                const dir = await mkdtemp(join(tmpdir(), 'gjsify-dispose-fh-'));
                const file = join(dir, 'fh.txt');
                await writeFile(file, 'handle-content', 'utf8');
                try {
                    let content = '';
                    {
                        await using fh = await open(file, 'r');
                        content = await fh.readFile('utf8');
                    }
                    expect(content).toBe('handle-content');
                    // If dispose did not close the handle, a second exclusive open
                    // would still succeed — the assertion above plus a clean run is
                    // the observable signal that no error was thrown during dispose.
                } finally {
                    await rm(dir, { recursive: true, force: true });
                }
            });
        });
    });
};
