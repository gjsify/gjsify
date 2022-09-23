import { describe, it, expect } from '@gjsify/unit';

import { WebGLRenderingContextBase } from './index.js';

export default async () => {
	await describe('true', async () => {
		await it('should be true', async () => {
			const base = new WebGLRenderingContextBase();
			expect(true).toBeTruthy();
		});
	});
}
