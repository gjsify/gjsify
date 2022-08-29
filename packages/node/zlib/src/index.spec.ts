import { describe, it, expect } from '@gjsify/unit';

import { deflateRaw, inflateRaw, deflate, inflate, gzip, gunzip } from 'zlib';

export default async () => {

	await describe('zlib.deflateRaw', async () => {
		await it('should be a function', async () => {
			expect(typeof deflateRaw).toBe("function");
		});
	});

	await describe('zlib.inflateRaw', async () => {
		await it('should be a function', async () => {
			expect(typeof inflateRaw).toBe("function");
		});
	});

	await describe('zlib.deflate', async () => {
		await it('should be a function', async () => {
			expect(typeof deflate).toBe("function");
		});
	});

	await describe('zlib.inflate', async () => {
		await it('should be a function', async () => {
			expect(typeof inflate).toBe("function");
		});
	});

	await describe('zlib.gzip', async () => {
		await it('should be a function', async () => {
			expect(typeof gzip).toBe("function");
		});
	});

	await describe('zlib.gunzip', async () => {
		await it('should be a function', async () => {
			expect(typeof gunzip).toBe("function");
		});
	});

}
