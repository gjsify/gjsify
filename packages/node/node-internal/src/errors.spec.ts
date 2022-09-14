

import { describe, it, expect } from '@gjsify/unit';

import {
	NodeRangeError,
	NodeSyntaxError,
	NodeTypeError,
	NodeURIError,
} from "./errors.js";

export default async () => {
	// https://github.com/denoland/deno_std/blob/main/node/internal/errors_test.ts
	await describe('NodeSyntaxError', async () => {
		await it('should be the correct string representation', async () => {
			expect(String(new NodeSyntaxError("CODE", "MESSAGE"))).toBe("SyntaxError [CODE]: MESSAGE");
		});
	});

	await describe('NodeRangeError', async () => {
		await it('should be the correct string representation', async () => {
			expect(String(new NodeRangeError("CODE", "MESSAGE"))).toBe("RangeError [CODE]: MESSAGE");
		});
	});

	await describe('NodeTypeError', async () => {
		await it('should be the correct string representation', async () => {
			expect(String(new NodeTypeError("CODE", "MESSAGE"))).toBe("TypeError [CODE]: MESSAGE");
		});
	});

	await describe('NodeURIError', async () => {
		await it('should be the correct string representation', async () => {
			expect(String(new NodeURIError("CODE", "MESSAGE"))).toBe("URIError [CODE]: MESSAGE");
		});
	});
}
