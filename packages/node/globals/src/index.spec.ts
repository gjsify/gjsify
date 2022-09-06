import { describe, it, expect } from '@gjsify/unit';

export default async () => {
	await describe('true', async () => {
		await it('should be true', async () => {
			expect(true).toBeTruthy();
		});
	});
}
