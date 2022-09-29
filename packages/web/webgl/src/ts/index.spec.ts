import { describe, it, expect } from '@gjsify/unit';

import { WebGLRenderingContext } from './index.js';

export default async () => {
	await describe('true', async () => {
		await it('should be true', async () => {
			const ctx = new WebGLRenderingContext();
			expect(ctx).toBeDefined();
		});
	});
}
