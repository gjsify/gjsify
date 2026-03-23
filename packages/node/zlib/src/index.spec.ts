import { describe, it, expect } from '@gjsify/unit';

import { deflateRaw, inflateRaw, deflate, inflate, gzip, gunzip } from 'zlib';
import { Buffer } from 'buffer';

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

	// ==================== round-trip tests ====================
	// Uses Web Compression API on Node.js, Gio.ZlibCompressor on GJS.

	await describe('zlib: gzip/gunzip round-trip', async () => {
		await it('should compress and decompress', async () => {
			const input = Buffer.from('Hello, World!');
			const compressed = await new Promise<Buffer>((resolve, reject) => {
				gzip(input, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(compressed.length > 0).toBeTruthy();
			// Gzip output should differ from input
			expect(compressed.length !== input.length || compressed[0] !== input[0]).toBeTruthy();

			const decompressed = await new Promise<Buffer>((resolve, reject) => {
				gunzip(compressed, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(new TextDecoder().decode(decompressed)).toBe('Hello, World!');
		});
	});

	await describe('zlib: deflate/inflate round-trip', async () => {
		await it('should compress and decompress', async () => {
			const input = Buffer.from('Deflate test data');
			const compressed = await new Promise<Buffer>((resolve, reject) => {
				deflate(input, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(compressed.length > 0).toBeTruthy();

			const decompressed = await new Promise<Buffer>((resolve, reject) => {
				inflate(compressed, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(new TextDecoder().decode(decompressed)).toBe('Deflate test data');
		});
	});

	await describe('zlib: deflateRaw/inflateRaw round-trip', async () => {
		await it('should compress and decompress', async () => {
			const input = Buffer.from('Raw deflate data');
			const compressed = await new Promise<Buffer>((resolve, reject) => {
				deflateRaw(input, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(compressed.length > 0).toBeTruthy();

			const decompressed = await new Promise<Buffer>((resolve, reject) => {
				inflateRaw(compressed, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(new TextDecoder().decode(decompressed)).toBe('Raw deflate data');
		});
	});

	await describe('zlib: constants', async () => {
		await it('should export constants', async () => {
			const zlib = await import('zlib');
			expect(typeof zlib.constants).toBe('object');
		});
	});

	await describe('zlib: empty input', async () => {
		await it('should handle empty buffer gzip', async () => {
			const input = Buffer.alloc(0);
			const compressed = await new Promise<Buffer>((resolve, reject) => {
				gzip(input, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			const decompressed = await new Promise<Buffer>((resolve, reject) => {
				gunzip(compressed, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				});
			});
			expect(decompressed.length).toBe(0);
		});
	});
}
