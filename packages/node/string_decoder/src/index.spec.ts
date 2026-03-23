import { describe, it, expect } from '@gjsify/unit';
import { StringDecoder } from 'string_decoder';
import { Buffer } from 'buffer';

// Ported from refs/node/test/parallel/test-string-decoder.js
// and test-string-decoder-end.js
// Original: MIT license, Node.js contributors

// Helper: test that decoding input with given encoding produces expected output.
// Tests all possible write sequences (byte-at-a-time, all-at-once, and various splits).
function testDecode(encoding: string, input: Buffer, expected: string): boolean {
	// Write all at once
	let decoder = new StringDecoder(encoding);
	let result = decoder.write(input) + decoder.end();
	if (result !== expected) return false;

	// Write one byte at a time
	decoder = new StringDecoder(encoding);
	result = '';
	for (let i = 0; i < input.length; i++) {
		result += decoder.write(input.subarray(i, i + 1));
	}
	result += decoder.end();
	if (result !== expected) return false;

	return true;
}

// Helper: test end() behavior — write incomplete, end(), write next, end()
function testEnd(encoding: string, incomplete: Buffer, next: Buffer, expected: string): boolean {
	const decoder = new StringDecoder(encoding);
	let res = '';
	res += decoder.write(incomplete);
	res += decoder.end();
	res += decoder.write(next);
	res += decoder.end();
	return res === expected;
}

export default async () => {
	// ==================== constructor ====================

	await describe('StringDecoder: constructor', async () => {
		await it('should create a utf8 decoder by default', async () => {
			const decoder = new StringDecoder();
			expect(decoder.encoding).toBe('utf8');
		});

		await it('should accept encoding parameter', async () => {
			const decoder = new StringDecoder('utf-8');
			expect(decoder.encoding).toBe('utf8');
		});

		await it('should accept latin1 encoding', async () => {
			const decoder = new StringDecoder('latin1');
			expect(decoder.encoding).toBe('latin1');
		});

		await it('should accept hex encoding', async () => {
			const decoder = new StringDecoder('hex');
			expect(decoder.encoding).toBe('hex');
		});

		await it('should accept base64 encoding', async () => {
			const decoder = new StringDecoder('base64');
			expect(decoder.encoding).toBe('base64');
		});

		await it('should accept utf16le encoding', async () => {
			const decoder = new StringDecoder('utf16le');
			expect(decoder.encoding).toBe('utf16le');
		});

		await it('should accept ucs2 encoding (alias for utf16le)', async () => {
			const decoder = new StringDecoder('ucs2');
			expect(decoder.encoding).toBe('utf16le');
		});
	});

	// ==================== UTF-8 basic ====================

	await describe('StringDecoder: utf8 basic', async () => {
		await it('should decode ASCII ($)', async () => {
			expect(testDecode('utf-8', Buffer.from('$', 'utf-8'), '$')).toBeTruthy();
		});

		await it('should decode 2-byte char (¢)', async () => {
			expect(testDecode('utf-8', Buffer.from('¢', 'utf-8'), '¢')).toBeTruthy();
		});

		await it('should decode 3-byte char (€)', async () => {
			expect(testDecode('utf-8', Buffer.from('€', 'utf-8'), '€')).toBeTruthy();
		});

		await it('should decode 4-byte char (𤭢)', async () => {
			expect(testDecode('utf-8', Buffer.from('𤭢', 'utf-8'), '𤭢')).toBeTruthy();
		});

		await it('should decode mixed ascii and non-ascii', async () => {
			// U+02E4 -> CB A4, U+0064 -> 64, U+12E4 -> E1 8B A4, U+0030 -> 30, U+3045 -> E3 81 85
			const buf = Buffer.from([0xCB, 0xA4, 0x64, 0xE1, 0x8B, 0xA4, 0x30, 0xE3, 0x81, 0x85]);
			expect(testDecode('utf-8', buf, '\u02e4\u0064\u12e4\u0030\u3045')).toBeTruthy();
		});

		await it('should decode complete ASCII buffer', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(new Uint8Array([72, 101, 108, 108, 111]))).toBe('Hello');
		});

		await it('should handle multi-byte characters split across writes', async () => {
			const decoder = new StringDecoder('utf8');
			const result1 = decoder.write(new Uint8Array([0xE2]));
			const result2 = decoder.write(new Uint8Array([0x82, 0xAC]));
			expect(result1 + result2).toBe('€');
		});

		await it('should handle empty buffer', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(new Uint8Array(0))).toBe('');
		});
	});

	// ==================== UTF-8 invalid sequences ====================

	await describe('StringDecoder: utf8 invalid sequences', async () => {
		await it('should handle C9B5A941 → \\u0275\\ufffdA', async () => {
			expect(testDecode('utf-8', Buffer.from('C9B5A941', 'hex'), '\u0275\ufffdA')).toBeTruthy();
		});

		await it('should handle lone E2 → \\ufffd', async () => {
			expect(testDecode('utf-8', Buffer.from('E2', 'hex'), '\ufffd')).toBeTruthy();
		});

		await it('should handle E241 → \\ufffdA', async () => {
			expect(testDecode('utf-8', Buffer.from('E241', 'hex'), '\ufffdA')).toBeTruthy();
		});

		await it('should handle CCCCB8 → \\ufffd\\u0338', async () => {
			expect(testDecode('utf-8', Buffer.from('CCCCB8', 'hex'), '\ufffd\u0338')).toBeTruthy();
		});

		await it('should handle F0B841 → \\ufffdA', async () => {
			expect(testDecode('utf-8', Buffer.from('F0B841', 'hex'), '\ufffdA')).toBeTruthy();
		});

		await it('should handle F1CCB8 → \\ufffd\\u0338', async () => {
			expect(testDecode('utf-8', Buffer.from('F1CCB8', 'hex'), '\ufffd\u0338')).toBeTruthy();
		});

		await it('should handle F0FB00 → \\ufffd\\ufffd\\0', async () => {
			expect(testDecode('utf-8', Buffer.from('F0FB00', 'hex'), '\ufffd\ufffd\0')).toBeTruthy();
		});

		await it('should handle CCE2B8B8 → \\ufffd\\u2e38', async () => {
			expect(testDecode('utf-8', Buffer.from('CCE2B8B8', 'hex'), '\ufffd\u2e38')).toBeTruthy();
		});

		await it('should handle E2B8CCB8 → \\ufffd\\u0338', async () => {
			expect(testDecode('utf-8', Buffer.from('E2B8CCB8', 'hex'), '\ufffd\u0338')).toBeTruthy();
		});

		await it('should handle E2FBCC01 → \\ufffd\\ufffd\\ufffd\\u0001', async () => {
			expect(testDecode('utf-8', Buffer.from('E2FBCC01', 'hex'), '\ufffd\ufffd\ufffd\u0001')).toBeTruthy();
		});

		await it('should handle CCB8CDB9 → \\u0338\\u0379', async () => {
			expect(testDecode('utf-8', Buffer.from('CCB8CDB9', 'hex'), '\u0338\u0379')).toBeTruthy();
		});

		await it('should handle CESU-8 of U+1D40D as 6 replacement chars', async () => {
			expect(testDecode('utf-8', Buffer.from('EDA0B5EDB08D', 'hex'),
				'\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd')).toBeTruthy();
		});
	});

	// ==================== UTF-8 streaming edge cases ====================

	await describe('StringDecoder: utf8 streaming', async () => {
		await it('should buffer incomplete E1 and output replacement on end()', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(Buffer.from('E1', 'hex'))).toBe('');
			expect(decoder.end()).toBe('\ufffd');
		});

		await it('should handle E18B incomplete → replacement on end()', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(Buffer.from('E18B', 'hex'))).toBe('');
			expect(decoder.end()).toBe('\ufffd');
		});

		await it('should pass through replacement char directly', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(Buffer.from('\ufffd'))).toBe('\ufffd');
			expect(decoder.end()).toBe('');
		});

		await it('should pass through multiple replacement chars', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(Buffer.from('\ufffd\ufffd\ufffd'))).toBe('\ufffd\ufffd\ufffd');
			expect(decoder.end()).toBe('');
		});

		await it('should handle EFBFBDE2 → replacement + incomplete', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(Buffer.from('EFBFBDE2', 'hex'))).toBe('\ufffd');
			expect(decoder.end()).toBe('\ufffd');
		});

		await it('should handle F1 then 41F2 sequence', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(Buffer.from('F1', 'hex'))).toBe('');
			expect(decoder.write(Buffer.from('41F2', 'hex'))).toBe('\ufffdA');
			expect(decoder.end()).toBe('\ufffd');
		});
	});

	// ==================== UTF-16LE ====================

	await describe('StringDecoder: utf16le', async () => {
		await it('should decode UCS-2 text', async () => {
			expect(testDecode('ucs2', Buffer.from('ababc', 'ucs2'), 'ababc')).toBeTruthy();
		});

		await it('should decode UTF-16LE surrogate pair (thumbs up)', async () => {
			expect(testDecode('utf16le', Buffer.from('3DD84DDC', 'hex'), '\ud83d\udc4d')).toBeTruthy();
		});

		await it('should handle surrogate pair split across 3 writes', async () => {
			const decoder = new StringDecoder('utf16le');
			expect(decoder.write(Buffer.from('3DD8', 'hex'))).toBe('');
			expect(decoder.write(Buffer.from('4D', 'hex'))).toBe('');
			expect(decoder.write(Buffer.from('DC', 'hex'))).toBe('\ud83d\udc4d');
			expect(decoder.end()).toBe('');
		});

		await it('should output high surrogate on end() when incomplete', async () => {
			const decoder = new StringDecoder('utf16le');
			expect(decoder.write(Buffer.from('3DD8', 'hex'))).toBe('');
			expect(decoder.end()).toBe('\ud83d');
		});

		await it('should output high surrogate on end() with 3 bytes', async () => {
			const decoder = new StringDecoder('utf16le');
			expect(decoder.write(Buffer.from('3DD8', 'hex'))).toBe('');
			expect(decoder.write(Buffer.from('4D', 'hex'))).toBe('');
			expect(decoder.end()).toBe('\ud83d');
		});

		await it('should handle 3-byte buffer as char + leftover', async () => {
			const decoder = new StringDecoder('utf16le');
			expect(decoder.write(Buffer.from('3DD84D', 'hex'))).toBe('\ud83d');
			expect(decoder.end()).toBe('');
		});
	});

	// ==================== latin1 ====================

	await describe('StringDecoder: latin1', async () => {
		await it('should decode latin1 buffer', async () => {
			const decoder = new StringDecoder('latin1');
			expect(decoder.write(new Uint8Array([72, 101, 108, 108, 111]))).toBe('Hello');
		});

		await it('should handle high bytes (é)', async () => {
			const decoder = new StringDecoder('latin1');
			expect(decoder.write(new Uint8Array([0xE9]))).toBe('\u00e9');
		});
	});

	// ==================== hex ====================

	await describe('StringDecoder: hex', async () => {
		await it('should decode buffer as hex', async () => {
			const decoder = new StringDecoder('hex');
			expect(decoder.write(new Uint8Array([0xff, 0x00, 0x0a]))).toBe('ff000a');
		});
	});

	// ==================== ascii ====================

	await describe('StringDecoder: ascii', async () => {
		await it('should decode ASCII buffer', async () => {
			const decoder = new StringDecoder('ascii');
			expect(decoder.write(new Uint8Array([72, 101, 108, 108, 111]))).toBe('Hello');
		});
	});

	// ==================== base64 ====================

	await describe('StringDecoder: base64', async () => {
		await it('should encode single byte on end()', async () => {
			const decoder = new StringDecoder('base64');
			expect(decoder.write(Buffer.of(0x61))).toBe('');
			expect(decoder.end()).toBe('YQ==');
		});

		await it('should encode two bytes on end()', async () => {
			const decoder = new StringDecoder('base64');
			expect(decoder.write(Buffer.of(0x61, 0x61))).toBe('');
			expect(decoder.end()).toBe('YWE=');
		});

		await it('should encode three bytes immediately', async () => {
			const decoder = new StringDecoder('base64');
			expect(decoder.write(Buffer.of(0x61, 0x61, 0x61))).toBe('YWFh');
			expect(decoder.end()).toBe('');
		});

		await it('should handle 3+1 byte split', async () => {
			const decoder = new StringDecoder('base64');
			expect(decoder.write(Buffer.of(0x61, 0x61, 0x61))).toBe('YWFh');
			expect(decoder.write(Buffer.of(0x61))).toBe('');
			expect(decoder.end()).toBe('YQ==');
		});
	});

	// ==================== end() behavior ====================

	await describe('StringDecoder: end()', async () => {
		await it('should accept buffer in end()', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.end(new Uint8Array([72, 105]))).toBe('Hi');
		});

		await it('should return empty string with no pending data', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.end()).toBe('');
		});

		// UTF-8 end tests
		await it('utf8: E2 then 61 → \\ufffd a', async () => {
			expect(testEnd('utf8', Buffer.of(0xE2), Buffer.of(0x61), '\uFFFDa')).toBeTruthy();
		});

		await it('utf8: E2 then 82 → \\ufffd\\ufffd', async () => {
			expect(testEnd('utf8', Buffer.of(0xE2), Buffer.of(0x82), '\uFFFD\uFFFD')).toBeTruthy();
		});

		await it('utf8: E2 then E2 → \\ufffd\\ufffd', async () => {
			expect(testEnd('utf8', Buffer.of(0xE2), Buffer.of(0xE2), '\uFFFD\uFFFD')).toBeTruthy();
		});

		await it('utf8: E2,82 then 61 → \\ufffd a', async () => {
			expect(testEnd('utf8', Buffer.of(0xE2, 0x82), Buffer.of(0x61), '\uFFFDa')).toBeTruthy();
		});

		await it('utf8: E2,82,AC then 61 → €a', async () => {
			expect(testEnd('utf8', Buffer.of(0xE2, 0x82, 0xAC), Buffer.of(0x61), '€a')).toBeTruthy();
		});

		// UTF-16LE end tests
		await it('utf16le: 3D then 61,00 → a', async () => {
			expect(testEnd('utf16le', Buffer.of(0x3D), Buffer.of(0x61, 0x00), 'a')).toBeTruthy();
		});

		await it('utf16le: 3D,D8 then empty → \\uD83D', async () => {
			expect(testEnd('utf16le', Buffer.of(0x3D, 0xD8), Buffer.of(), '\uD83D')).toBeTruthy();
		});

		await it('utf16le: 3D,D8 then 61,00 → \\uD83D a', async () => {
			expect(testEnd('utf16le', Buffer.of(0x3D, 0xD8), Buffer.of(0x61, 0x00), '\uD83Da')).toBeTruthy();
		});

		await it('utf16le: 3D,D8 then 4D,DC → \\uD83D\\uDC4D', async () => {
			expect(testEnd('utf16le', Buffer.of(0x3D, 0xD8), Buffer.of(0x4D, 0xDC), '\uD83D\uDC4D')).toBeTruthy();
		});

		await it('utf16le: 3D,D8,4D,DC then 61,00 → 👍a', async () => {
			expect(testEnd('utf16le', Buffer.of(0x3D, 0xD8, 0x4D, 0xDC), Buffer.of(0x61, 0x00), '👍a')).toBeTruthy();
		});

		// Base64 end tests
		await it('base64: 61 then empty → YQ==', async () => {
			expect(testEnd('base64', Buffer.of(0x61), Buffer.of(), 'YQ==')).toBeTruthy();
		});

		await it('base64: 61 then 61 → YQ==YQ==', async () => {
			expect(testEnd('base64', Buffer.of(0x61), Buffer.of(0x61), 'YQ==YQ==')).toBeTruthy();
		});

		await it('base64: 61,61 then empty → YWE=', async () => {
			expect(testEnd('base64', Buffer.of(0x61, 0x61), Buffer.of(), 'YWE=')).toBeTruthy();
		});

		await it('base64: 61,61,61 then empty → YWFh', async () => {
			expect(testEnd('base64', Buffer.of(0x61, 0x61, 0x61), Buffer.of(), 'YWFh')).toBeTruthy();
		});

		await it('base64: 61,61,61 then 61 → YWFhYQ==', async () => {
			expect(testEnd('base64', Buffer.of(0x61, 0x61, 0x61), Buffer.of(0x61), 'YWFhYQ==')).toBeTruthy();
		});
	});

	// ==================== byte-at-a-time fuzz ====================

	await describe('StringDecoder: byte-at-a-time consistency', async () => {
		const encodings = ['hex', 'utf8', 'utf16le', 'latin1', 'ascii'];
		const testStrings = ['Hello', 'asdf'];

		for (const encoding of encodings) {
			for (const str of testStrings) {
				await it(`${encoding}: byte-at-a-time matches toString for "${str}"`, async () => {
					const buf = Buffer.from(str);
					const expected = buf.toString(encoding as BufferEncoding);

					// Write one byte at a time
					const decoder = new StringDecoder(encoding);
					let result = '';
					for (let i = 0; i < buf.length; i++) {
						result += decoder.write(buf.subarray(i, i + 1));
					}
					result += decoder.end();
					expect(result).toBe(expected);

					// Write all at once
					const decoder2 = new StringDecoder(encoding);
					const result2 = decoder2.write(buf) + decoder2.end();
					expect(result2).toBe(expected);
				});
			}
		}
	});
};
