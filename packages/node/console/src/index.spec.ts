import { describe, it, expect } from '@gjsify/unit';
import console from "console"

export default async () => {
	await describe('Default import', async () => {
		await it('should be an object', async () => {
			expect(console instanceof Object).toBeTruthy();
		});
	});
}
