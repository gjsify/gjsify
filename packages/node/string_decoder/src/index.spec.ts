import { describe, it, expect } from '@gjsify/unit';
import { StringDecoder } from 'string_decoder';

export default async () => {
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
	});

	await describe('StringDecoder: utf8 decoding', async () => {
		await it('should decode complete ASCII buffer', async () => {
			const decoder = new StringDecoder('utf8');
			const result = decoder.write(new Uint8Array([72, 101, 108, 108, 111]));
			expect(result).toBe('Hello');
		});

		await it('should handle multi-byte characters split across writes', async () => {
			const decoder = new StringDecoder('utf8');
			// Euro sign (€) is 0xE2 0x82 0xAC in UTF-8
			const result1 = decoder.write(new Uint8Array([0xE2]));
			const result2 = decoder.write(new Uint8Array([0x82, 0xAC]));
			expect(result1 + result2).toBe('€');
		});

		await it('should handle empty buffer', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.write(new Uint8Array(0))).toBe('');
		});

		await it('should flush remaining bytes on end()', async () => {
			const decoder = new StringDecoder('utf8');
			decoder.write(new Uint8Array([72, 105]));
			const result = decoder.end();
			expect(typeof result).toBe('string');
		});
	});

	await describe('StringDecoder: latin1 decoding', async () => {
		await it('should decode latin1 buffer', async () => {
			const decoder = new StringDecoder('latin1');
			const result = decoder.write(new Uint8Array([72, 101, 108, 108, 111]));
			expect(result).toBe('Hello');
		});

		await it('should handle high bytes', async () => {
			const decoder = new StringDecoder('latin1');
			const result = decoder.write(new Uint8Array([0xE9])); // é in latin1
			expect(result).toBe('\u00e9');
		});
	});

	await describe('StringDecoder: hex decoding', async () => {
		await it('should decode buffer as hex', async () => {
			const decoder = new StringDecoder('hex');
			const result = decoder.write(new Uint8Array([0xff, 0x00, 0x0a]));
			expect(result).toBe('ff000a');
		});
	});

	await describe('StringDecoder: ascii decoding', async () => {
		await it('should decode ASCII buffer', async () => {
			const decoder = new StringDecoder('ascii');
			const result = decoder.write(new Uint8Array([72, 101, 108, 108, 111]));
			expect(result).toBe('Hello');
		});
	});

	await describe('StringDecoder: end()', async () => {
		await it('should accept buffer in end()', async () => {
			const decoder = new StringDecoder('utf8');
			const result = decoder.end(new Uint8Array([72, 105]));
			expect(result).toBe('Hi');
		});

		await it('should return empty string with no pending data', async () => {
			const decoder = new StringDecoder('utf8');
			expect(decoder.end()).toBe('');
		});
	});
}
