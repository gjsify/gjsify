import { describe, expect, it } from '@gjsify/unit';

import { embedAcross } from './pool.js';
import { checkVector, normalize, truncateVector } from './vectors.js';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export default async () => {
    await describe('checkVector', async () => {
        await it('accepts a finite, non-zero vector', async () => {
            checkVector(new Float32Array([0, 1, -2]));
        });

        await it('rejects empty, non-finite and zero vectors', async () => {
            expect(() => checkVector([])).toThrow(/empty/);
            expect(() => checkVector([1, Number.NaN])).toThrow(/non-finite/);
            expect(() => checkVector([Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
            expect(() => checkVector([0, 0, 0])).toThrow(/zero-norm/);
        });
    });

    await describe('normalize', async () => {
        await it('returns a unit-length copy', async () => {
            const input = [3, 4];
            const out = normalize(input);
            expect(out instanceof Float32Array).toBe(true);
            expect(close(out[0], 0.6) && close(out[1], 0.8)).toBe(true);
            expect(input).toStrictEqual([3, 4]);
        });

        await it('refuses what checkVector refuses', async () => {
            expect(() => normalize([0, 0])).toThrow(/zero-norm/);
        });
    });

    await describe('truncateVector', async () => {
        await it('keeps the leading dimensions and renormalises', async () => {
            const out = truncateVector([3, 4, 12], 2);
            expect(out.length).toBe(2);
            expect(close(out[0], 0.6) && close(out[1], 0.8)).toBe(true);
        });

        await it('refuses to grow a vector', async () => {
            expect(() => truncateVector([1, 2], 3)).toThrow(/cannot truncate/);
        });
    });

    await describe('embedAcross', async () => {
        await it('fills every slot, in input order, across contexts', async () => {
            const seen: string[] = [];
            const { vectors, failure } = await embedAcross(['a', 'b'], ['x', 'y', 'z'], async (context, text) => {
                seen.push(context);
                return `${text}!`;
            });
            expect(failure).toBeUndefined();
            expect(vectors).toStrictEqual(['x!', 'y!', 'z!']);
            expect(seen.includes('a') && seen.includes('b')).toBe(true);
        });

        await it('stops after the first failure and settles every worker', async () => {
            let running = 0;
            const { vectors, failure } = await embedAcross([1, 2], ['ok', 'bad', 'later', 'never'], async (_, text) => {
                running++;
                try {
                    await Promise.resolve();
                    if (text === 'bad') throw new Error('boom');
                    return text;
                } finally {
                    running--;
                }
            });
            expect(running).toBe(0);
            expect((failure?.error as Error).message).toBe('boom');
            expect(vectors[0]).toBe('ok');
            expect(vectors[3]).toBeUndefined();
        });
    });
};
