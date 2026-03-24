import { describe, it, expect } from '@gjsify/unit';

export default async () => {
	await describe('web-events', async () => {
		await it('should be true', async () => {
			expect(true).toBeTruthy()
		});
	});
}
