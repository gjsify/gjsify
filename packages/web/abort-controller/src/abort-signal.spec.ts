import { describe, it, expect } from '@gjsify/unit';

import { AbortSignal as GjsifyAbortSignal } from '@gjsify/abort-controller';

// Use build in AbortSignal on Node.js tests and the custom implementation on Gjs
export const AbortSignal = globalThis.AbortSignal || GjsifyAbortSignal;

export default async () => {

	// Credits https://github.com/mysticatea/abort-controller/tree/master/test

	await describe("AbortSignal", async () => {
		await it("should not be callable", async () => {
			expect(() => {
				(AbortSignal as any)()
			}).toThrow(TypeError);
		});
	
		await it("should throw a TypeError when it's constructed directly", async () => {
			expect(() => {
				new AbortSignal()
			}).toThrow(TypeError);
		});
	})
}
