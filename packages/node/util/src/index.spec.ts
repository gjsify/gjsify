import { describe, it, expect } from '@gjsify/unit';
import * as util from 'util';

export default async () => {
	// See packages/deno/deno_std/original/node/util_test.ts
	await describe('[util] format', async () => {
		await it('should be a function', async () => {
			expect(util.format("%o", [10, 11])).toBe("[ 10, 11, [length]: 2 ]");
		});
	});
}
