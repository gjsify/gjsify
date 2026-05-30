// `gjsify whoami` command coverage.
//
// Tests the four observable branches of the command by mocking the
// `whoami(registry, npmrc)` helper via a `globalThis.fetch` stub and
// capturing `process.{stdout,stderr,exit}` writes. The handler is invoked
// directly (not via yargs) — the yargs wiring is dumb plumbing and adding
// a subprocess-spawning harness for it would dwarf the actual test value.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whoamiCommand } from './commands/whoami.js';
import type { ArgumentsCamelCase } from 'yargs';

interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
}

interface MockFetchHandle {
    restore(): void;
    requests: CapturedRequest[];
}

function mockFetch(handler: (req: CapturedRequest) => { status: number; body: string }): MockFetchHandle {
    const original = globalThis.fetch;
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const headers: Record<string, string> = {};
        const hdrInit = init?.headers;
        if (hdrInit && typeof hdrInit === 'object' && !Array.isArray(hdrInit)) {
            for (const [k, v] of Object.entries(hdrInit as Record<string, string>)) {
                headers[k.toLowerCase()] = v;
            }
        }
        const captured: CapturedRequest = {
            url,
            method: (init?.method ?? 'GET').toUpperCase(),
            headers,
        };
        requests.push(captured);
        const { status, body } = handler(captured);
        return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return {
        restore: () => {
            globalThis.fetch = original;
        },
        requests,
    };
}

function mockFetchThrows(error: Error): MockFetchHandle {
    const original = globalThis.fetch;
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async () => {
        throw error;
    }) as typeof fetch;
    return {
        restore: () => {
            globalThis.fetch = original;
        },
        requests,
    };
}

interface CapturedIO {
    stdout: string[];
    stderr: string[];
    exitCode: number | null;
    restore(): void;
}

// process.exit() throws an internal sentinel so the handler unwinds at the
// right line; we catch it in the test and surface the exit code.
class ExitSentinel extends Error {
    constructor(public code: number) {
        super(`process.exit(${code})`);
        this.name = 'ExitSentinel';
    }
}

function captureIO(): CapturedIO {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const captured: CapturedIO = {
        stdout,
        stderr,
        exitCode: null,
        restore: () => {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
            process.exit = originalExit;
        },
    };
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const originalExit = process.exit.bind(process);
    process.stdout.write = ((chunk: unknown) => {
        stdout.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
        stderr.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
    }) as typeof process.stderr.write;
    process.exit = ((code?: number) => {
        captured.exitCode = code ?? 0;
        throw new ExitSentinel(code ?? 0);
    }) as typeof process.exit;
    return captured;
}

// `loadNpmrc()` reads ~/.npmrc — we redirect both `$NPM_CONFIG_USERCONFIG`
// and `$HOME` at a throwaway temp dir per test so the production
// `loadNpmrc()` code path runs unchanged. The temp file either contains a
// token (live / dead-token branches) or is empty (no-token-configured
// branch). `HOME` is also redirected so the `homedir() / .npmrc` fallback
// can't accidentally pick up a real ~/.npmrc on the developer's box.

function withTempNpmrc(contents: string): { dir: string; restore(): void } {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-whoami-spec-'));
    const path = join(dir, '.npmrc');
    writeFileSync(path, contents);
    const prevUserConfig = process.env.NPM_CONFIG_USERCONFIG;
    const prevHome = process.env.HOME;
    process.env.NPM_CONFIG_USERCONFIG = path;
    // Also redirect HOME so the homedir() fallback can't accidentally pick
    // up a real ~/.npmrc on the developer's box.
    process.env.HOME = dir;
    return {
        dir,
        restore: () => {
            if (prevUserConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
            else process.env.NPM_CONFIG_USERCONFIG = prevUserConfig;
            if (prevHome === undefined) delete process.env.HOME;
            else process.env.HOME = prevHome;
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                /* best effort */
            }
        },
    };
}

async function runHandler(args: Partial<ArgumentsCamelCase<{ registry?: string; json?: boolean }>>): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
}> {
    const io = captureIO();
    try {
        await whoamiCommand.handler!(args as ArgumentsCamelCase<{ registry?: string; json?: boolean }>);
    } catch (err) {
        if (!(err instanceof ExitSentinel)) {
            io.restore();
            throw err;
        }
    }
    io.restore();
    return {
        exitCode: io.exitCode,
        stdout: io.stdout.join(''),
        stderr: io.stderr.join(''),
    };
}

export default async () => {
    await describe('whoami — live token (branch 1)', async () => {
        await it('prints "Logged in as: <name>" + Registry, exits 0', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_LIVE\n');
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ username: 'jumplink' }) }));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org' });
                expect(out.exitCode).toBeNull();
                expect(out.stdout.includes('Logged in as: jumplink')).toBe(true);
                expect(out.stdout.includes('Registry:')).toBe(true);
                expect(out.stdout.includes('https://registry.npmjs.org')).toBe(true);
                expect(out.stderr).toBe('');
                expect(stub.requests.length).toBe(1);
                expect(stub.requests[0]!.url).toBe('https://registry.npmjs.org/-/whoami');
                expect(stub.requests[0]!.headers['authorization']).toBe('Bearer npm_LIVE');
            } finally {
                stub.restore();
                env.restore();
            }
        });

        await it('emits JSON {username, registry} with --json', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_LIVE\n');
            const stub = mockFetch(() => ({ status: 200, body: JSON.stringify({ username: 'jumplink' }) }));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org', json: true });
                expect(out.exitCode).toBeNull();
                const parsed = JSON.parse(out.stdout) as { username: string; registry: string };
                expect(parsed.username).toBe('jumplink');
                expect(parsed.registry).toBe('https://registry.npmjs.org');
                expect(out.stderr).toBe('');
            } finally {
                stub.restore();
                env.restore();
            }
        });
    });

    await describe('whoami — dead/revoked token (branch 2)', async () => {
        await it('prints "appears dead or revoked" hint, exits 1', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_DEAD\n');
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org' });
                expect(out.exitCode).toBe(1);
                expect(out.stderr.includes('token appears dead or revoked')).toBe(true);
                expect(out.stderr.includes('empty whoami response')).toBe(true);
                expect(out.stderr.includes('npm login')).toBe(true);
                expect(out.stderr.includes('AGENTS.md')).toBe(true);
                expect(out.stderr.includes('first-publish + Trusted Publisher')).toBe(true);
                expect(out.stdout).toBe('');
            } finally {
                stub.restore();
                env.restore();
            }
        });

        await it('emits JSON {error: "dead-token", registry} with --json', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_DEAD\n');
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org', json: true });
                expect(out.exitCode).toBe(1);
                const parsed = JSON.parse(out.stdout) as { error: string; registry: string };
                expect(parsed.error).toBe('dead-token');
                expect(parsed.registry).toBe('https://registry.npmjs.org');
                expect(out.stderr).toBe('');
            } finally {
                stub.restore();
                env.restore();
            }
        });
    });

    await describe('whoami — no token configured (branch 3)', async () => {
        await it('prints "no npm token configured" hint, exits 1, never calls fetch', async () => {
            const env = withTempNpmrc('# no token here\nregistry=https://registry.npmjs.org/\n');
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                const out = await runHandler({});
                expect(out.exitCode).toBe(1);
                expect(out.stderr.includes('no npm token configured')).toBe(true);
                expect(out.stderr.includes('npm login')).toBe(true);
                expect(out.stdout).toBe('');
                expect(stub.requests.length).toBe(0);
            } finally {
                stub.restore();
                env.restore();
            }
        });

        await it('emits JSON {error: "no-token-configured", registry} with --json', async () => {
            const env = withTempNpmrc('# no token here\n');
            const stub = mockFetch(() => ({ status: 200, body: '{}' }));
            try {
                const out = await runHandler({ json: true });
                expect(out.exitCode).toBe(1);
                const parsed = JSON.parse(out.stdout) as { error: string; registry: string };
                expect(parsed.error).toBe('no-token-configured');
                expect(typeof parsed.registry).toBe('string');
                expect(stub.requests.length).toBe(0);
            } finally {
                stub.restore();
                env.restore();
            }
        });
    });

    await describe('whoami — network error (branch 4)', async () => {
        await it('prints the underlying error + registry, exits 1', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_LIVE\n');
            const stub = mockFetchThrows(new TypeError('fetch failed: ECONNREFUSED'));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org' });
                expect(out.exitCode).toBe(1);
                expect(out.stderr.includes('fetch failed')).toBe(true);
                expect(out.stderr.includes('Registry: https://registry.npmjs.org')).toBe(true);
                expect(out.stdout).toBe('');
            } finally {
                stub.restore();
                env.restore();
            }
        });

        await it('emits JSON {error: "<message>", registry} with --json', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_LIVE\n');
            const stub = mockFetchThrows(new TypeError('fetch failed: ECONNREFUSED'));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org', json: true });
                expect(out.exitCode).toBe(1);
                const parsed = JSON.parse(out.stdout) as { error: string; registry: string };
                expect(parsed.error.includes('fetch failed')).toBe(true);
                expect(parsed.registry).toBe('https://registry.npmjs.org');
                expect(out.stderr).toBe('');
            } finally {
                stub.restore();
                env.restore();
            }
        });

        await it('treats non-2xx response as error (registry rejects token)', async () => {
            const env = withTempNpmrc('//registry.npmjs.org/:_authToken=npm_LIVE\n');
            const stub = mockFetch(() => ({ status: 401, body: 'Unauthorized' }));
            try {
                const out = await runHandler({ registry: 'https://registry.npmjs.org' });
                expect(out.exitCode).toBe(1);
                expect(out.stderr.includes('401') || out.stderr.includes('Unauthorized')).toBe(true);
            } finally {
                stub.restore();
                env.restore();
            }
        });
    });
};
