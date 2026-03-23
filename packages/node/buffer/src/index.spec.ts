import { describe, it, expect } from '@gjsify/unit';
import { Buffer } from 'buffer';

// Ported from Deno (https://github.com/denoland/deno_std/blob/main/node/buffer_test.ts)
// and refs/node/test/parallel/test-buffer-*.js
// Original: MIT license, Deno authors / Node.js contributors

export default async () => {

	await describe('alloc fails if size is not a number', async () => {
		const invalidSizes = [{}, "1", "foo", []];

		await it('should throw on non-number size', async () => {
			for (const size of invalidSizes) {
				expect(() => {
					// deno-lint-ignore ban-ts-comment
					// @ts-expect-error
					Buffer.alloc(size);
				}).toThrow(TypeError);
			}
		});
	});


	await describe('alloc allocates a buffer with the expected size', async () => {
		const buffer: Buffer = Buffer.alloc(1);
		await it('Buffer size should be 1', async () => {
			expect(buffer.length).toBe(1);
		});
		await it('Content should be filled with 0', async () => {
			expect(buffer[0]).toBe(0);
		});
	});

	await describe('alloc(0) creates an empty buffer', async () => {
		const buffer: Buffer = Buffer.alloc(0);
		await it('Buffer size should be 0', async () => {
			expect(buffer.length).toBe(0);
		});
	});

	await describe('allocUnsafe allocates a buffer with the expected size', async () => {
		const buffer: Buffer = Buffer.allocUnsafe(1);
		await it('Buffer size should be 1', async () => {
			expect(buffer.length).toBe(1);
		});
	});

	await describe('allocUnsafe(0) creates an empty buffer', async () => {
		const buffer: Buffer = Buffer.allocUnsafe(0);
		await it('Buffer size should be 0', async () => {
			expect(buffer.length).toBe(0);
		});
	});

	await describe('alloc filled correctly with integer', async () => {
		const buffer: Buffer = Buffer.alloc(3, 5);
		await it('Should be equal to `Buffer.from([5, 5, 5])`', async () => {
			expect(buffer).toEqualArray(Buffer.from([5, 5, 5]));
		});
	});

	await describe('alloc filled correctly with single character', async () => {
		await it('Should be equal to `Buffer.from([97, 97, 97, 97, 97])`', async () => {
			expect(Buffer.alloc(5, "a")).toEqualArray(Buffer.from([97, 97, 97, 97, 97]));
		});
	});

	await describe('alloc filled correctly with base64 string', async () => {
		await it('Should be equal to `Buffer.from([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100])`', async () => {
			expect(Buffer.alloc(11, "aGVsbG8gd29ybGQ=", "base64")).toEqualArray(Buffer.from([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]));
		});
	});

	await describe('alloc filled correctly with hex string', async () => {
		await it('Should be equal to `Buffer.from([100, 101, 110, 111])`', async () => {
			expect(Buffer.alloc(4, "64656e6f", "hex")).toEqualArray(Buffer.from([100, 101, 110, 111]));
		});
	});

	await describe('alloc filled correctly with hex string smaller than alloc size', async () => {
		await it('Should be equal to `denodenodenod`', async () => {
			expect(Buffer.alloc(13, "64656e6f", "hex").toString()).toEqual("denodenodenod");
		});
	});

	await describe('alloc filled correctly with Uint8Array smaller than alloc size', async () => {
		await it('Should be equal to `Buffer.from([100, 101, 100, 101, 100, 101, 100])`', async () => {
			expect(Buffer.alloc(7, new Uint8Array([100, 101]) as any)).toEqualArray(Buffer.from([100, 101, 100, 101, 100, 101, 100]));
		});
		await it('Should be equal to `Buffer.from([100, 101, 100, 101, 100, 101])`', async () => {
			expect(Buffer.alloc(6, new Uint8Array([100, 101]) as any)).toEqualArray(Buffer.from([100, 101, 100, 101, 100, 101]));
		});
	});

	await describe('alloc filled correctly with Uint8Array bigger than alloc size', async () => {
		await it('Should be equal to `Buffer.from([100])`', async () => {
			expect(Buffer.alloc(1, new Uint8Array([100, 101]) as any)).toEqualArray(Buffer.from([100]));
		});
	});

	await describe('alloc filled correctly with Buffer', async () => {
		await it('Should be equal to `Buffer.from([100, 101, 100, 101, 100, 101])`', async () => {
			expect(Buffer.alloc(6, Buffer.from([100, 101]))).toEqualArray(Buffer.from([100, 101, 100, 101, 100, 101]));
		});

		await it('Should be equal to `Buffer.from([100, 101, 100, 101, 100, 101, 100])`', async () => {
			expect(Buffer.alloc(7, Buffer.from([100, 101]))).toEqualArray(Buffer.from([100, 101, 100, 101, 100, 101, 100]));
		});
	});

	// tests from:
	// https://github.com/nodejs/node/blob/56dbe466fdbc598baea3bfce289bf52b97b8b8f7/test/parallel/test-buffer-bytelength.js#L70
	await describe('Buffer.byteLength()', async () => {
		await it('Byte length is the expected for strings`', async () => {
			// Special case: zero length string
			expect(Buffer.byteLength("", "ascii")).toBe(0);
			expect(Buffer.byteLength("", "HeX" as any)).toBe(0);

			// utf8
			expect(Buffer.byteLength("∑éllö wørl∂!", "utf-8")).toBe(19);
			expect(Buffer.byteLength("κλμνξο", "utf8")).toBe(12);
			expect(Buffer.byteLength("挵挶挷挸挹", "utf-8")).toBe(15);
			expect(Buffer.byteLength("𠝹𠱓𠱸", "UTF8" as any)).toBe(12);
			// Without an encoding, utf8 should be assumed
			expect(Buffer.byteLength("hey there")).toBe(9);
			expect(Buffer.byteLength("𠱸挶νξ#xx :)")).toBe(17);
			expect(Buffer.byteLength("hello world", "" as any)).toBe(11);
			// It should also be assumed with unrecognized encoding
			expect(Buffer.byteLength("hello world", "abc" as any)).toBe(11);
			expect(Buffer.byteLength("ßœ∑≈", "unkn0wn enc0ding" as any)).toBe(10);

			// base64
			expect(Buffer.byteLength("aGVsbG8gd29ybGQ=", "base64")).toBe(11);
			expect(Buffer.byteLength("aGVsbG8gd29ybGQ=", "BASE64" as any)).toBe(11);
			expect(Buffer.byteLength("bm9kZS5qcyByb2NrcyE=", "base64")).toBe(14);
			expect(Buffer.byteLength("aGkk", "base64")).toBe(3);
			expect(
				Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw==", "base64")).toBe(25);
			// special padding
			expect(Buffer.byteLength("aaa=", "base64")).toBe(2);
			expect(Buffer.byteLength("aaaa==", "base64")).toBe(3);

			expect(Buffer.byteLength("Il était tué")).toBe(14);
			expect(Buffer.byteLength("Il était tué", "utf8")).toBe(14);

			["ascii", "latin1", "binary"]
				.reduce((es: string[], e: string) => es.concat(e, e.toUpperCase()), [])
				.forEach((encoding: BufferEncoding) => {
					expect(Buffer.byteLength("Il était tué", encoding)).toBe(12);
				});

			["ucs2", "ucs-2", "utf16le", "utf-16le"]
				.reduce((es: string[], e: string) => es.concat(e, e.toUpperCase()), [])
				.forEach((encoding: BufferEncoding) => {
					expect(Buffer.byteLength("Il était tué", encoding)).toBe(24);
				});
		});
	});

	await describe('Byte length is the expected one for non-strings', async () => {
		await it('Byte length differs on buffers', async () => {
			expect(
				Buffer.byteLength(Buffer.alloc(0))
			).toBe(
				Buffer.alloc(0).byteLength
			)
		});
	});

	await describe('Two Buffers are concatenated', async () => {
		await it('The buffers should be equal', async () => {
			const data1 = [1, 2, 3];
			const data2 = [4, 5, 6];

			const buffer1 = Buffer.from(data1);
			const buffer2 = Buffer.from(data2);

			const resultBuffer = Buffer.concat([buffer1, buffer2]);
			const expectedBuffer = Buffer.from([...data1, ...data2]);
			expect(resultBuffer).toEqualArray(expectedBuffer);
		});
	});

	// Ported from refs/node/test/parallel/test-buffer-*.js

	await describe('Buffer.concat edge cases', async () => {
		await it('single buffer concat', async () => {
			const buffer1 = Buffer.alloc(1);
			const result = Buffer.concat([buffer1]);
			expect(result.length).toBe(1);
		});

		await it('empty concat returns empty buffer', async () => {
			const result = Buffer.concat([]);
			expect(result.length).toBe(0);
		});

		await it('respects totalLength parameter', async () => {
			const buffer1 = Buffer.alloc(2);
			const buffer2 = Buffer.alloc(2);
			expect(Buffer.concat([buffer1, buffer2], 10).length).toBe(10);
			expect(Buffer.concat([buffer1, buffer2], 3).length).toBe(3);
		});
	});

	// Ported from commented-out Deno tests and refs/node/test/parallel/test-buffer-*.js

	await describe('Buffer.readUInt8', async () => {
		await it('should read 8-bit unsigned integers', async () => {
			const buffer = Buffer.from([0xff, 0x2a, 0x2a, 0x2a]);
			expect(buffer.readUInt8(0)).toBe(255);
			expect(buffer.readUInt8(1)).toBe(42);
			expect(buffer.readUInt8(2)).toBe(42);
			expect(buffer.readUInt8(3)).toBe(42);
		});
	});

	await describe('Buffer.readUInt16BE/LE', async () => {
		await it('should read 16-bit unsigned integers', async () => {
			const buffer = Buffer.from([0x00, 0x2a, 0x42, 0x3f]);
			expect(buffer.readUInt16BE(0)).toBe(0x002a);
			expect(buffer.readUInt16BE(1)).toBe(0x2a42);
			expect(buffer.readUInt16BE(2)).toBe(0x423f);
			expect(buffer.readUInt16LE(0)).toBe(0x2a00);
			expect(buffer.readUInt16LE(1)).toBe(0x422a);
			expect(buffer.readUInt16LE(2)).toBe(0x3f42);
		});
	});

	await describe('Buffer.readUInt32BE/LE', async () => {
		await it('should read 32-bit unsigned integers', async () => {
			const buffer = Buffer.from([0x32, 0x65, 0x42, 0x56, 0x23, 0xff]);
			expect(buffer.readUInt32BE(0)).toBe(0x32654256);
			expect(buffer.readUInt32BE(1)).toBe(0x65425623);
			expect(buffer.readUInt32BE(2)).toBe(0x425623ff);
			expect(buffer.readUInt32LE(0)).toBe(0x56426532);
			expect(buffer.readUInt32LE(1)).toBe(0x23564265);
			expect(buffer.readUInt32LE(2)).toBe(0xff235642);
		});
	});

	await describe('Buffer.from string', async () => {
		await it('should create buffer from utf8 string', async () => {
			const buffer = Buffer.from('test');
			expect(buffer.length).toBe(4);
			expect(buffer.toString()).toBe('test');
		});

		await it('should create buffer from hex string', async () => {
			const buffer = Buffer.from('7468697320697320612074c3a97374', 'hex');
			expect(buffer.length).toBe(15);
			expect(buffer.toString()).toBe('this is a tést');
		});

		await it('should create buffer from base64 string', async () => {
			const buffer = Buffer.from('dGhpcyBpcyBhIHTDqXN0', 'base64');
			expect(buffer.length).toBe(15);
			expect(buffer.toString()).toBe('this is a tést');
		});

		await it('should create buffer from another buffer', async () => {
			const buffer = Buffer.from(Buffer.from('test'));
			expect(buffer.length).toBe(4);
			expect(buffer.toString()).toBe('test');
		});

		await it('should create buffer from array', async () => {
			const buffer = Buffer.from([65, 66, 67]);
			expect(buffer.toString()).toBe('ABC');
		});

		await it('should create buffer from ArrayBuffer', async () => {
			const ab = new ArrayBuffer(4);
			const view = new Uint8Array(ab);
			view[0] = 65; view[1] = 66; view[2] = 67; view[3] = 68;
			const buffer = Buffer.from(ab);
			expect(buffer.toString()).toBe('ABCD');
		});
	});

	await describe('Buffer.toString encodings', async () => {
		await it('should convert to hex', async () => {
			const buffer = Buffer.from('deno land');
			expect(buffer.toString('hex')).toBe('64656e6f206c616e64');
		});

		await it('should convert to base64', async () => {
			const buffer = Buffer.from('deno land');
			expect(buffer.toString('base64')).toBe('ZGVubyBsYW5k');
		});

		await it('should round-trip hex', async () => {
			const hex = '64656e6f206c616e64';
			expect(Buffer.from(hex, 'hex').toString('hex')).toBe(hex);
		});

		await it('should round-trip base64', async () => {
			const b64 = 'dGhpcyBpcyBhIHTDqXN0';
			expect(Buffer.from(b64, 'base64').toString('base64')).toBe(b64);
		});
	});

	await describe('Buffer.isBuffer', async () => {
		await it('should return true for buffers', async () => {
			expect(Buffer.isBuffer(Buffer.from('test'))).toBeTruthy();
		});

		await it('should return false for non-buffers', async () => {
			expect(Buffer.isBuffer({ test: 3 })).toBeFalsy();
			expect(Buffer.isBuffer(new Uint8Array())).toBeFalsy();
		});
	});

	await describe('Buffer.isEncoding', async () => {
		await it('should return true for valid encodings', async () => {
			const valid = ['hex', 'utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'base64', 'ucs2', 'utf16le'];
			for (const enc of valid) {
				expect(Buffer.isEncoding(enc)).toBeTruthy();
			}
		});

		await it('should return false for invalid encodings', async () => {
			expect(Buffer.isEncoding('utf9')).toBeFalsy();
			expect(Buffer.isEncoding('Unicode-FTW')).toBeFalsy();
		});
	});

	await describe('Buffer.toJSON', async () => {
		await it('should serialize to JSON', async () => {
			const json = JSON.stringify(Buffer.from('deno'));
			const parsed = JSON.parse(json);
			expect(parsed.type).toBe('Buffer');
			expect(parsed.data.length).toBe(4);
			expect(parsed.data[0]).toBe(100);
			expect(parsed.data[1]).toBe(101);
			expect(parsed.data[2]).toBe(110);
			expect(parsed.data[3]).toBe(111);
		});
	});

	await describe('Buffer.copy', async () => {
		await it('should copy data between buffers', async () => {
			const buffer1 = Buffer.from([1, 2, 3]);
			const buffer2 = Buffer.alloc(8);
			buffer1.copy(buffer2, 5);
			expect(buffer2[5]).toBe(1);
			expect(buffer2[6]).toBe(2);
			expect(buffer2[7]).toBe(3);
		});
	});

	await describe('Buffer.compare', async () => {
		await it('should return 0 for equal buffers', async () => {
			const a = Buffer.from('abc');
			const b = Buffer.from('abc');
			expect(Buffer.compare(a, b)).toBe(0);
		});

		await it('should return negative for a < b', async () => {
			const a = Buffer.from('abc');
			const b = Buffer.from('abd');
			expect(Buffer.compare(a, b) < 0).toBeTruthy();
		});

		await it('should return positive for a > b', async () => {
			const a = Buffer.from('abd');
			const b = Buffer.from('abc');
			expect(Buffer.compare(a, b) > 0).toBeTruthy();
		});
	});

	await describe('Buffer.equals', async () => {
		await it('should return true for equal buffers', async () => {
			expect(Buffer.from('abc').equals(Buffer.from('abc'))).toBeTruthy();
		});

		await it('should return false for different buffers', async () => {
			expect(Buffer.from('abc').equals(Buffer.from('abd'))).toBeFalsy();
		});
	});

	await describe('Buffer.slice', async () => {
		await it('should return a view (not copy)', async () => {
			const buf = Buffer.from('ceno');
			const slice = buf.slice();
			slice[0]++;
			expect(slice.toString()).toBe('deno');
		});
	});

	await describe('Buffer.indexOf', async () => {
		await it('should find byte value', async () => {
			const buf = Buffer.from('hello world');
			expect(buf.indexOf(111)).toBe(4); // 'o'
		});

		await it('should find string', async () => {
			const buf = Buffer.from('hello world');
			expect(buf.indexOf('world')).toBe(6);
		});

		await it('should return -1 if not found', async () => {
			const buf = Buffer.from('hello');
			expect(buf.indexOf('xyz')).toBe(-1);
		});
	});

	await describe('Buffer.includes', async () => {
		await it('should return true if value found', async () => {
			expect(Buffer.from('hello world').includes('world')).toBeTruthy();
		});

		await it('should return false if value not found', async () => {
			expect(Buffer.from('hello').includes('xyz')).toBeFalsy();
		});
	});
}
