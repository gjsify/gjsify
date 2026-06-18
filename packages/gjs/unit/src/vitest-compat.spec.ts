import { describe, it, expect, vi } from '@gjsify/unit';

// Coverage for the vitest-compatibility surface: toMatchObject, vi.fn/.mock.calls,
// vi.stubGlobal/unstubAllGlobals, vi.stubEnv/unstubAllEnvs, and the
// rejects/resolves async chains.
export default async () => {
    await describe('toBeNaN + expect(value, message)', async () => {
        await it('toBeNaN passes only for NaN', async () => {
            expect(Number.NaN).toBeNaN();
            expect(Number.parseInt('nope', 10)).toBeNaN();
            expect(1).not.toBeNaN();
        });
        await it('accepts an optional message argument (vitest form)', async () => {
            expect(1 + 1, 'arithmetic still works').toBe(2);
        });
    });

    await describe('toMatchObject', async () => {
        await it('matches a partial object (extra actual keys ignored)', async () => {
            expect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, c: 3 });
        });
        await it('matches nested objects partially', async () => {
            expect({ x: { y: 1, z: 2 }, w: 9 }).toMatchObject({ x: { y: 1 } });
        });
        await it('matches arrays element-wise (same length)', async () => {
            expect([{ id: 1 }, { id: 2 }]).toMatchObject([{ id: 1 }, { id: 2 }]);
        });
        await it('fails when a value differs', async () => {
            expect(() => expect({ a: 1 }).toMatchObject({ a: 2 })).toThrow();
        });
        await it('fails when a key is missing', async () => {
            expect(() => expect({ a: 1 }).toMatchObject({ b: 1 })).toThrow();
        });
        await it('supports .not', async () => {
            expect({ a: 1 }).not.toMatchObject({ a: 2 });
        });
    });

    await describe('vi.fn + .mock.calls', async () => {
        await it('calls the impl and records arguments', async () => {
            const fn = vi.fn((a: number, b: number) => a + b);
            expect(fn(2, 3)).toBe(5);
            expect(fn(10, 1)).toBe(11);
            expect(fn.mock.calls.length).toBe(2);
            expect(fn.mock.calls[0][0]).toBe(2);
            expect(fn.mock.calls[1][1]).toBe(1);
        });
        await it('works without an implementation', async () => {
            const fn = vi.fn();
            expect(fn('x')).toBeUndefined();
            expect(fn.mock.calls[0][0]).toBe('x');
        });
    });

    await describe('toHaveBeenCalled / Times / With', async () => {
        await it('tracks call count and arguments', async () => {
            const fn = vi.fn((a: number) => a * 2);
            expect(fn).not.toHaveBeenCalled();
            fn(3);
            fn(5);
            expect(fn).toHaveBeenCalled();
            expect(fn).toHaveBeenCalledTimes(2);
            expect(fn).toHaveBeenCalledWith(3);
            expect(fn).toHaveBeenCalledWith(5);
            expect(fn).not.toHaveBeenCalledWith(99);
        });
    });

    await describe('vi.stubGlobal / unstubAllGlobals', async () => {
        await it('stubs then restores a previously-absent global', async () => {
            const g = globalThis as Record<string, unknown>;
            expect('__unitStubProbe__' in g).toBe(false);
            vi.stubGlobal('__unitStubProbe__', 42);
            expect(g['__unitStubProbe__']).toBe(42);
            vi.unstubAllGlobals();
            expect('__unitStubProbe__' in g).toBe(false);
        });
    });

    await describe('vi.stubEnv / unstubAllEnvs', async () => {
        await it('stubs then restores an env var (where process.env exists)', async () => {
            const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
            if (!env) return;
            vi.stubEnv('__UNIT_ENV_PROBE__', 'x');
            expect(env['__UNIT_ENV_PROBE__']).toBe('x');
            vi.unstubAllEnvs();
            expect(env['__UNIT_ENV_PROBE__']).toBeUndefined();
        });
    });

    await describe('rejects / resolves', async () => {
        await it('rejects.toThrow matches the rejection message', async () => {
            await expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
        });
        await it('resolves.toResolve passes for a resolving promise', async () => {
            await expect(Promise.resolve(1)).resolves.toResolve();
        });
    });
};
