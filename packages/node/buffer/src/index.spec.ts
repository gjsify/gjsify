import { describe, it, expect } from '@gjsify/unit';
import { Buffer } from 'node:buffer';

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

	// =========================================================================
	// New tests below — ported from refs/node/test/parallel/test-buffer-*.js
	// and refs/node-test/parallel/test-buffer-*.js
	// Original: MIT license, Node.js contributors
	// =========================================================================

	await describe('Buffer.from with various string encodings', async () => {
		await it('should create buffer from latin1 string', async () => {
			const buf = Buffer.from('\xe4\xf6\xfc', 'latin1');
			expect(buf.length).toBe(3);
			expect(buf[0]).toBe(0xe4);
			expect(buf[1]).toBe(0xf6);
			expect(buf[2]).toBe(0xfc);
		});

		await it('should create buffer from binary string (alias for latin1)', async () => {
			const buf = Buffer.from('\xe4\xf6\xfc', 'binary');
			expect(buf.length).toBe(3);
			expect(buf[0]).toBe(0xe4);
			expect(buf[1]).toBe(0xf6);
			expect(buf[2]).toBe(0xfc);
		});

		await it('should create buffer from ascii string', async () => {
			const buf = Buffer.from('hello', 'ascii');
			expect(buf.length).toBe(5);
			expect(buf.toString('ascii')).toBe('hello');
		});

		await it('should create buffer from utf16le string', async () => {
			const buf = Buffer.from('AB', 'utf16le');
			expect(buf.length).toBe(4);
			// 'A' = 0x41, 'B' = 0x42 in LE: [0x41, 0x00, 0x42, 0x00]
			expect(buf[0]).toBe(0x41);
			expect(buf[1]).toBe(0x00);
			expect(buf[2]).toBe(0x42);
			expect(buf[3]).toBe(0x00);
		});

		await it('should create buffer from empty string', async () => {
			const buf = Buffer.from('');
			expect(buf.length).toBe(0);
		});

		await it('should create buffer from base64url string', async () => {
			// base64url uses - and _ instead of + and /
			const buf = Buffer.from('SGVsbG8', 'base64url');
			expect(buf.toString()).toBe('Hello');
		});
	});

	await describe('Buffer.from Uint8Array', async () => {
		await it('should create buffer from Uint8Array', async () => {
			const u8 = new Uint8Array([1, 2, 3, 4]);
			const buf = Buffer.from(u8);
			expect(buf.length).toBe(4);
			expect(buf[0]).toBe(1);
			expect(buf[1]).toBe(2);
			expect(buf[2]).toBe(3);
			expect(buf[3]).toBe(4);
		});

		await it('should not share memory with source Uint8Array', async () => {
			const u8 = new Uint8Array([10, 20, 30]);
			const buf = Buffer.from(u8);
			u8[0] = 99;
			expect(buf[0]).toBe(10); // should not have changed
		});
	});

	await describe('Buffer.from ArrayBuffer with offset and length', async () => {
		await it('should create buffer from ArrayBuffer with byteOffset', async () => {
			const ab = new ArrayBuffer(8);
			const view = new Uint8Array(ab);
			for (let i = 0; i < 8; i++) view[i] = i + 1;
			const buf = Buffer.from(ab, 2, 4);
			expect(buf.length).toBe(4);
			expect(buf[0]).toBe(3);
			expect(buf[1]).toBe(4);
			expect(buf[2]).toBe(5);
			expect(buf[3]).toBe(6);
		});

		await it('should share memory with source ArrayBuffer', async () => {
			const ab = new ArrayBuffer(4);
			const view = new Uint8Array(ab);
			view[0] = 1; view[1] = 2; view[2] = 3; view[3] = 4;
			const buf = Buffer.from(ab);
			view[0] = 99;
			expect(buf[0]).toBe(99); // shares memory
		});
	});

	await describe('Buffer.allocUnsafe various sizes', async () => {
		await it('should return correct size for larger allocations', async () => {
			const buf = Buffer.allocUnsafe(256);
			expect(buf.length).toBe(256);
		});

		await it('should throw on non-number size', async () => {
			expect(() => {
				// @ts-expect-error
				Buffer.allocUnsafe('5');
			}).toThrow(TypeError);
		});
	});

	await describe('Buffer.alloc with fill parameter', async () => {
		await it('should fill with byte value 0xff', async () => {
			const buf = Buffer.alloc(4, 0xff);
			expect(buf[0]).toBe(255);
			expect(buf[1]).toBe(255);
			expect(buf[2]).toBe(255);
			expect(buf[3]).toBe(255);
		});

		await it('should fill with multi-character string repeating', async () => {
			const buf = Buffer.alloc(6, 'ab');
			expect(buf.toString()).toBe('ababab');
		});

		await it('should fill with Buffer repeating', async () => {
			const fill = Buffer.from([0xaa, 0xbb]);
			const buf = Buffer.alloc(5, fill);
			expect(buf[0]).toBe(0xaa);
			expect(buf[1]).toBe(0xbb);
			expect(buf[2]).toBe(0xaa);
			expect(buf[3]).toBe(0xbb);
			expect(buf[4]).toBe(0xaa);
		});
	});

	await describe('Buffer.compare static method edge cases', async () => {
		await it('should return 0 for two empty buffers', async () => {
			expect(Buffer.compare(Buffer.alloc(0), Buffer.alloc(0))).toBe(0);
		});

		await it('should compare buffers of different lengths', async () => {
			const a = Buffer.from('abc');
			const b = Buffer.from('abcd');
			expect(Buffer.compare(a, b) < 0).toBeTruthy();
			expect(Buffer.compare(b, a) > 0).toBeTruthy();
		});

		await it('should return -1 or 1 not just negative/positive', async () => {
			const a = Buffer.from([1]);
			const b = Buffer.from([2]);
			expect(Buffer.compare(a, b)).toBe(-1);
			expect(Buffer.compare(b, a)).toBe(1);
		});
	});

	await describe('Buffer.concat additional edge cases', async () => {
		await it('should handle three buffers', async () => {
			const a = Buffer.from('hello');
			const b = Buffer.from(' ');
			const c = Buffer.from('world');
			const result = Buffer.concat([a, b, c]);
			expect(result.toString()).toBe('hello world');
			expect(result.length).toBe(11);
		});

		await it('should truncate with smaller totalLength', async () => {
			const a = Buffer.from('hello');
			const b = Buffer.from('world');
			const result = Buffer.concat([a, b], 5);
			expect(result.toString()).toBe('hello');
		});

		await it('should zero-pad with larger totalLength', async () => {
			const a = Buffer.from([1, 2]);
			const result = Buffer.concat([a], 5);
			expect(result.length).toBe(5);
			expect(result[0]).toBe(1);
			expect(result[1]).toBe(2);
			expect(result[2]).toBe(0);
			expect(result[3]).toBe(0);
			expect(result[4]).toBe(0);
		});
	});

	await describe('Buffer.isBuffer additional checks', async () => {
		await it('should return false for null and undefined', async () => {
			expect(Buffer.isBuffer(null)).toBeFalsy();
			expect(Buffer.isBuffer(undefined)).toBeFalsy();
		});

		await it('should return false for numbers and strings', async () => {
			expect(Buffer.isBuffer(42)).toBeFalsy();
			expect(Buffer.isBuffer('hello')).toBeFalsy();
		});

		await it('should return true for Buffer.alloc result', async () => {
			expect(Buffer.isBuffer(Buffer.alloc(0))).toBeTruthy();
		});

		await it('should return true for Buffer.allocUnsafe result', async () => {
			expect(Buffer.isBuffer(Buffer.allocUnsafe(5))).toBeTruthy();
		});
	});

	await describe('Buffer.isEncoding additional checks', async () => {
		await it('should return true for base64url', async () => {
			expect(Buffer.isEncoding('base64url')).toBeTruthy();
		});

		await it('should return false for empty string', async () => {
			expect(Buffer.isEncoding('')).toBeFalsy();
		});

		await it('should return false for non-string values', async () => {
			expect(Buffer.isEncoding(null as any)).toBeFalsy();
			expect(Buffer.isEncoding(undefined as any)).toBeFalsy();
			expect(Buffer.isEncoding(42 as any)).toBeFalsy();
		});
	});

	await describe('Buffer.byteLength with different encodings', async () => {
		await it('should return correct byte length for hex encoding', async () => {
			expect(Buffer.byteLength('deadbeef', 'hex')).toBe(4);
			expect(Buffer.byteLength('ff', 'hex')).toBe(1);
			expect(Buffer.byteLength('', 'hex')).toBe(0);
		});

		await it('should return correct byte length for utf16le', async () => {
			expect(Buffer.byteLength('hello', 'utf16le')).toBe(10);
		});

		await it('should return correct byte length for Buffer argument', async () => {
			const buf = Buffer.from('hello');
			expect(Buffer.byteLength(buf)).toBe(5);
		});

		await it('should return correct byte length for ArrayBuffer argument', async () => {
			const ab = new ArrayBuffer(16);
			expect(Buffer.byteLength(ab)).toBe(16);
		});
	});

	await describe('Buffer.fill instance method', async () => {
		await it('should fill entire buffer with a byte value', async () => {
			const buf = Buffer.alloc(4);
			buf.fill(0xab);
			expect(buf[0]).toBe(0xab);
			expect(buf[1]).toBe(0xab);
			expect(buf[2]).toBe(0xab);
			expect(buf[3]).toBe(0xab);
		});

		await it('should fill with string', async () => {
			const buf = Buffer.alloc(5);
			buf.fill('x');
			expect(buf.toString()).toBe('xxxxx');
		});

		await it('should fill partial range with offset and end', async () => {
			const buf = Buffer.alloc(6, 0);
			buf.fill(0xff, 2, 4);
			expect(buf[0]).toBe(0);
			expect(buf[1]).toBe(0);
			expect(buf[2]).toBe(0xff);
			expect(buf[3]).toBe(0xff);
			expect(buf[4]).toBe(0);
			expect(buf[5]).toBe(0);
		});

		await it('should return the buffer for chaining', async () => {
			const buf = Buffer.alloc(3);
			const result = buf.fill(1);
			expect(result[0]).toBe(1);
		});
	});

	await describe('Buffer.indexOf additional cases', async () => {
		await it('should find string with byteOffset', async () => {
			const buf = Buffer.from('abcabc');
			expect(buf.indexOf('abc', 1)).toBe(3);
		});

		await it('should find Buffer value', async () => {
			const buf = Buffer.from('hello world');
			const search = Buffer.from('world');
			expect(buf.indexOf(search)).toBe(6);
		});

		await it('should return -1 for byte not in buffer', async () => {
			const buf = Buffer.from([1, 2, 3]);
			expect(buf.indexOf(4)).toBe(-1);
		});
	});

	await describe('Buffer.includes additional cases', async () => {
		await it('should return true for byte value', async () => {
			const buf = Buffer.from([1, 2, 3, 4, 5]);
			expect(buf.includes(3)).toBeTruthy();
		});

		await it('should return false for byte value not in buffer', async () => {
			const buf = Buffer.from([1, 2, 3]);
			expect(buf.includes(99)).toBeFalsy();
		});

		await it('should respect byteOffset parameter', async () => {
			const buf = Buffer.from('abcabc');
			expect(buf.includes('abc', 1)).toBeTruthy();
			expect(buf.includes('abc', 4)).toBeFalsy();
		});
	});

	await describe('Buffer.lastIndexOf', async () => {
		await it('should find last occurrence of a byte', async () => {
			const buf = Buffer.from([1, 2, 3, 1, 2, 3]);
			expect(buf.lastIndexOf(1)).toBe(3);
		});

		await it('should find last occurrence of a string', async () => {
			const buf = Buffer.from('abcabc');
			expect(buf.lastIndexOf('abc')).toBe(3);
		});

		await it('should return -1 if not found', async () => {
			const buf = Buffer.from('hello');
			expect(buf.lastIndexOf('xyz')).toBe(-1);
		});

		await it('should respect byteOffset', async () => {
			const buf = Buffer.from('abcabc');
			expect(buf.lastIndexOf('abc', 2)).toBe(0);
		});
	});

	await describe('Buffer.slice and Buffer.subarray', async () => {
		await it('slice should share memory with original buffer', async () => {
			const buf = Buffer.from([1, 2, 3, 4, 5]);
			const sliced = buf.slice(1, 4);
			expect(sliced.length).toBe(3);
			expect(sliced[0]).toBe(2);
			expect(sliced[1]).toBe(3);
			expect(sliced[2]).toBe(4);
			sliced[0] = 99;
			expect(buf[1]).toBe(99); // shared memory
		});

		await it('subarray should share memory with original buffer', async () => {
			const buf = Buffer.from([10, 20, 30, 40, 50]);
			const sub = buf.subarray(2, 4);
			expect(sub.length).toBe(2);
			expect(sub[0]).toBe(30);
			expect(sub[1]).toBe(40);
			sub[0] = 99;
			expect(buf[2]).toBe(99); // shared memory
		});

		await it('slice with negative indices', async () => {
			const buf = Buffer.from([1, 2, 3, 4, 5]);
			const sliced = buf.slice(-2);
			expect(sliced.length).toBe(2);
			expect(sliced[0]).toBe(4);
			expect(sliced[1]).toBe(5);
		});

		await it('subarray with no arguments returns full view', async () => {
			const buf = Buffer.from([1, 2, 3]);
			const sub = buf.subarray();
			expect(sub.length).toBe(3);
			expect(sub[0]).toBe(1);
		});
	});

	await describe('Buffer.copy additional cases', async () => {
		await it('should copy partial source', async () => {
			const src = Buffer.from([1, 2, 3, 4, 5]);
			const dst = Buffer.alloc(3);
			src.copy(dst, 0, 1, 4);
			expect(dst[0]).toBe(2);
			expect(dst[1]).toBe(3);
			expect(dst[2]).toBe(4);
		});

		await it('should return number of bytes copied', async () => {
			const src = Buffer.from([1, 2, 3]);
			const dst = Buffer.alloc(5);
			const copied = src.copy(dst);
			expect(copied).toBe(3);
		});

		await it('should not overwrite beyond target', async () => {
			const src = Buffer.from([1, 2, 3, 4, 5]);
			const dst = Buffer.alloc(3);
			const copied = src.copy(dst);
			expect(copied).toBe(3);
			expect(dst[0]).toBe(1);
			expect(dst[1]).toBe(2);
			expect(dst[2]).toBe(3);
		});
	});

	await describe('Buffer.write with encoding', async () => {
		await it('should write utf8 string', async () => {
			const buf = Buffer.alloc(10);
			const bytesWritten = buf.write('hello');
			expect(bytesWritten).toBe(5);
			expect(buf.toString('utf8', 0, 5)).toBe('hello');
		});

		await it('should write hex string', async () => {
			const buf = Buffer.alloc(4);
			buf.write('deadbeef', 0, 4, 'hex');
			expect(buf[0]).toBe(0xde);
			expect(buf[1]).toBe(0xad);
			expect(buf[2]).toBe(0xbe);
			expect(buf[3]).toBe(0xef);
		});

		await it('should write at offset', async () => {
			const buf = Buffer.alloc(10);
			buf.write('AB', 3);
			expect(buf[3]).toBe(65); // 'A'
			expect(buf[4]).toBe(66); // 'B'
		});

		await it('should truncate if string exceeds remaining space', async () => {
			const buf = Buffer.alloc(3);
			const written = buf.write('hello');
			expect(written).toBe(3);
			expect(buf.toString('utf8', 0, 3)).toBe('hel');
		});
	});

	await describe('Buffer.toString with encoding', async () => {
		await it('should decode as ascii', async () => {
			const buf = Buffer.from([72, 101, 108, 108, 111]);
			expect(buf.toString('ascii')).toBe('Hello');
		});

		await it('should decode as latin1', async () => {
			const buf = Buffer.from([0xe4, 0xf6, 0xfc]);
			expect(buf.toString('latin1')).toBe('\xe4\xf6\xfc');
		});

		await it('should decode as utf16le', async () => {
			const buf = Buffer.from([0x41, 0x00, 0x42, 0x00]);
			expect(buf.toString('utf16le')).toBe('AB');
		});

		await it('should decode substring with start and end', async () => {
			const buf = Buffer.from('hello world');
			expect(buf.toString('utf8', 6, 11)).toBe('world');
		});

		await it('should decode as base64url', async () => {
			const buf = Buffer.from('Hello');
			const result = buf.toString('base64url');
			// base64url should not contain + / or =
			expect(result.indexOf('+')).toBe(-1);
			expect(result.indexOf('/')).toBe(-1);
			expect(result.indexOf('=')).toBe(-1);
		});
	});

	await describe('Buffer.readInt8 and Buffer.writeInt8', async () => {
		await it('should read positive int8', async () => {
			const buf = Buffer.from([0x7f]);
			expect(buf.readInt8(0)).toBe(127);
		});

		await it('should read negative int8', async () => {
			const buf = Buffer.from([0x80]);
			expect(buf.readInt8(0)).toBe(-128);
		});

		await it('should read -1 from 0xff', async () => {
			const buf = Buffer.from([0xff]);
			expect(buf.readInt8(0)).toBe(-1);
		});

		await it('should write positive int8', async () => {
			const buf = Buffer.alloc(1);
			buf.writeInt8(127, 0);
			expect(buf[0]).toBe(0x7f);
		});

		await it('should write negative int8', async () => {
			const buf = Buffer.alloc(1);
			buf.writeInt8(-128, 0);
			expect(buf[0]).toBe(0x80);
		});

		await it('writeInt8 should return offset + 1', async () => {
			const buf = Buffer.alloc(2);
			expect(buf.writeInt8(0, 0)).toBe(1);
		});
	});

	await describe('Buffer.writeUInt8 and readUInt8 round-trip', async () => {
		await it('should round-trip values 0-255', async () => {
			const buf = Buffer.alloc(1);
			for (const val of [0, 1, 127, 128, 255]) {
				buf.writeUInt8(val, 0);
				expect(buf.readUInt8(0)).toBe(val);
			}
		});

		await it('writeUInt8 should return offset + 1', async () => {
			const buf = Buffer.alloc(2);
			expect(buf.writeUInt8(42, 0)).toBe(1);
			expect(buf.writeUInt8(43, 1)).toBe(2);
		});
	});

	await describe('Buffer.readUInt16BE/LE and writeUInt16BE/LE round-trip', async () => {
		await it('should round-trip UInt16BE', async () => {
			const buf = Buffer.alloc(2);
			buf.writeUInt16BE(0x1234, 0);
			expect(buf.readUInt16BE(0)).toBe(0x1234);
		});

		await it('should round-trip UInt16LE', async () => {
			const buf = Buffer.alloc(2);
			buf.writeUInt16LE(0x1234, 0);
			expect(buf.readUInt16LE(0)).toBe(0x1234);
		});

		await it('should correctly byte-order UInt16BE', async () => {
			const buf = Buffer.alloc(2);
			buf.writeUInt16BE(0xABCD, 0);
			expect(buf[0]).toBe(0xAB);
			expect(buf[1]).toBe(0xCD);
		});

		await it('should correctly byte-order UInt16LE', async () => {
			const buf = Buffer.alloc(2);
			buf.writeUInt16LE(0xABCD, 0);
			expect(buf[0]).toBe(0xCD);
			expect(buf[1]).toBe(0xAB);
		});
	});

	await describe('Buffer.swap16', async () => {
		await it('should swap bytes in 16-bit groups', async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
			buf.swap16();
			expect(buf[0]).toBe(0x02);
			expect(buf[1]).toBe(0x01);
			expect(buf[2]).toBe(0x04);
			expect(buf[3]).toBe(0x03);
		});

		await it('should throw if buffer length is not a multiple of 2', async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03]);
			expect(() => buf.swap16()).toThrow(RangeError);
		});

		await it('should return this for chaining', async () => {
			const buf = Buffer.from([0x01, 0x02]);
			const result = buf.swap16();
			expect(result[0]).toBe(0x02);
		});
	});

	await describe('Buffer.swap32', async () => {
		await it('should swap bytes in 32-bit groups', async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
			buf.swap32();
			expect(buf[0]).toBe(0x04);
			expect(buf[1]).toBe(0x03);
			expect(buf[2]).toBe(0x02);
			expect(buf[3]).toBe(0x01);
		});

		await it('should throw if buffer length is not a multiple of 4', async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03]);
			expect(() => buf.swap32()).toThrow(RangeError);
		});
	});

	await describe('Buffer.swap64', async () => {
		await it('should swap bytes in 64-bit groups', async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
			buf.swap64();
			expect(buf[0]).toBe(0x08);
			expect(buf[1]).toBe(0x07);
			expect(buf[2]).toBe(0x06);
			expect(buf[3]).toBe(0x05);
			expect(buf[4]).toBe(0x04);
			expect(buf[5]).toBe(0x03);
			expect(buf[6]).toBe(0x02);
			expect(buf[7]).toBe(0x01);
		});

		await it('should throw if buffer length is not a multiple of 8', async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
			expect(() => buf.swap64()).toThrow(RangeError);
		});
	});

	await describe('Buffer.equals additional cases', async () => {
		await it('should return true for two empty buffers', async () => {
			expect(Buffer.alloc(0).equals(Buffer.alloc(0))).toBeTruthy();
		});

		await it('should return false for buffers of different length', async () => {
			expect(Buffer.from('abc').equals(Buffer.from('ab'))).toBeFalsy();
		});

		await it('should return true for buffers from same data', async () => {
			const data = [0, 1, 127, 128, 255];
			expect(Buffer.from(data).equals(Buffer.from(data))).toBeTruthy();
		});
	});

	await describe('Buffer instance compare method', async () => {
		await it('should compare to another buffer', async () => {
			const a = Buffer.from('abc');
			const b = Buffer.from('abc');
			expect(a.compare(b)).toBe(0);
		});

		await it('should compare with target range', async () => {
			const a = Buffer.from('bc');
			const b = Buffer.from('abcd');
			// compare a against b[1..3] which is 'bc'
			expect(a.compare(b, 1, 3)).toBe(0);
		});

		await it('should compare with source range', async () => {
			const a = Buffer.from('abcd');
			const b = Buffer.from('bc');
			// compare a[1..3] against b which is 'bc'
			expect(a.compare(b, 0, 2, 1, 3)).toBe(0);
		});
	});

	await describe('Buffer.toJSON additional', async () => {
		await it('should serialize empty buffer', async () => {
			const json = JSON.parse(JSON.stringify(Buffer.alloc(0)));
			expect(json.type).toBe('Buffer');
			expect(json.data.length).toBe(0);
		});

		await it('should serialize single byte buffer', async () => {
			const json = JSON.parse(JSON.stringify(Buffer.from([42])));
			expect(json.data.length).toBe(1);
			expect(json.data[0]).toBe(42);
		});
	});

	await describe('Buffer.readInt32BE/LE', async () => {
		await it('should read positive int32', async () => {
			const buf = Buffer.alloc(4);
			buf.writeInt32BE(12345, 0);
			expect(buf.readInt32BE(0)).toBe(12345);
		});

		await it('should read negative int32', async () => {
			const buf = Buffer.alloc(4);
			buf.writeInt32BE(-1, 0);
			expect(buf.readInt32BE(0)).toBe(-1);
		});

		await it('should round-trip Int32LE', async () => {
			const buf = Buffer.alloc(4);
			buf.writeInt32LE(-123456, 0);
			expect(buf.readInt32LE(0)).toBe(-123456);
		});
	});

	await describe('Buffer.readFloatBE/LE', async () => {
		await it('should round-trip float BE', async () => {
			const buf = Buffer.alloc(4);
			buf.writeFloatBE(3.14, 0);
			const result = buf.readFloatBE(0);
			// Float has limited precision
			expect(Math.abs(result - 3.14) < 0.001).toBeTruthy();
		});

		await it('should round-trip float LE', async () => {
			const buf = Buffer.alloc(4);
			buf.writeFloatLE(2.718, 0);
			const result = buf.readFloatLE(0);
			expect(Math.abs(result - 2.718) < 0.001).toBeTruthy();
		});
	});

	await describe('Buffer.readDoubleBE/LE', async () => {
		await it('should round-trip double BE', async () => {
			const buf = Buffer.alloc(8);
			buf.writeDoubleBE(Math.PI, 0);
			expect(buf.readDoubleBE(0)).toBe(Math.PI);
		});

		await it('should round-trip double LE', async () => {
			const buf = Buffer.alloc(8);
			buf.writeDoubleLE(Math.E, 0);
			expect(buf.readDoubleLE(0)).toBe(Math.E);
		});
	});

	await describe('Buffer offset out of range', async () => {
		await it('readUInt8 should throw on out-of-range offset', async () => {
			const buf = Buffer.alloc(1);
			expect(() => buf.readUInt8(1)).toThrow(RangeError);
		});

		await it('readUInt16BE should throw on out-of-range offset', async () => {
			const buf = Buffer.alloc(1);
			expect(() => buf.readUInt16BE(0)).toThrow(RangeError);
		});

		await it('readUInt32BE should throw on out-of-range offset', async () => {
			const buf = Buffer.alloc(2);
			expect(() => buf.readUInt32BE(0)).toThrow(RangeError);
		});
	});

	await describe('Buffer.poolSize', async () => {
		await it('should have default poolSize of 8192', async () => {
			expect(Buffer.poolSize).toBe(8192);
		});
	});
}
