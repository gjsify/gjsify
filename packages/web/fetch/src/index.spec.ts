import { describe, it, expect } from '@gjsify/unit';

import fetch from 'node-fetch';

export default async () => {

	await describe('fetch', async () => {
		await it('fetch should be a function', async () => {
			expect(typeof fetch).toBe("function");
		});
	});

}
