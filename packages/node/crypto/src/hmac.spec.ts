import { describe, it, expect } from '@gjsify/unit';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Ported from refs/node/test/parallel/test-crypto-hmac.js
// Original: MIT license, Node.js contributors

export default async () => {
	await describe('crypto.createHmac', async () => {
		await it('should create hmac with sha256', async () => {
			const hmac = createHmac('sha256', 'secret').update('hello').digest('hex');
			expect(typeof hmac).toBe('string');
			expect(hmac.length).toBe(64); // sha256 hex = 64 chars
		});

		await it('should create hmac with sha1', async () => {
			const hmac = createHmac('sha1', 'secret').update('hello').digest('hex');
			expect(typeof hmac).toBe('string');
			expect(hmac.length).toBe(40); // sha1 hex = 40 chars
		});

		await it('should create hmac with md5', async () => {
			const hmac = createHmac('md5', 'secret').update('hello').digest('hex');
			expect(typeof hmac).toBe('string');
			expect(hmac.length).toBe(32); // md5 hex = 32 chars
		});

		await it('should support Buffer key', async () => {
			const key = Buffer.from('secret');
			const hmac = createHmac('sha256', key).update('hello').digest('hex');
			const hmac2 = createHmac('sha256', 'secret').update('hello').digest('hex');
			expect(hmac).toBe(hmac2);
		});

		await it('should support multiple update calls', async () => {
			const hmac1 = createHmac('sha256', 'key')
				.update('hello')
				.update(' ')
				.update('world')
				.digest('hex');
			const hmac2 = createHmac('sha256', 'key')
				.update('hello world')
				.digest('hex');
			expect(hmac1).toBe(hmac2);
		});

		await it('should support base64 encoding', async () => {
			const hmac = createHmac('sha256', 'secret').update('test').digest('base64');
			expect(typeof hmac).toBe('string');
			expect(hmac.length).toBeGreaterThan(0);
		});

		await it('should return Buffer when no encoding', async () => {
			const hmac = createHmac('sha256', 'secret').update('test').digest();
			expect(hmac.length).toBe(32); // sha256 = 32 bytes
		});

		// RFC 2202 test vector
		await it('should match HMAC-SHA256 test vector', async () => {
			const hmac = createHmac('sha256', 'key').update('The quick brown fox jumps over the lazy dog').digest('hex');
			expect(hmac).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
		});
	});
};
