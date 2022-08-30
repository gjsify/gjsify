import { describe, it, expect } from '@gjsify/unit';

import './index.js';

export default async () => {

	// Credits https://github.com/mysticatea/abort-controller/tree/master/test

	await describe('AbortController', async () => {
		await it('should have a callable constructor', async () => {
			expect(() => {
				new AbortController();
			}).not.toThrow();
		});

		await it('should not be callable', async () => {
			expect(AbortController).toThrow();
		});

		await it('should have 2 properties', async () => {
			const controller = new AbortController();

			const keys = new Set()
			keys.add("signal")
			keys.add("abort")
	
			for (const key in controller) {
				expect(keys.has(key)).toBeTruthy();
				keys.delete(key)
			}
		});
	});
}
