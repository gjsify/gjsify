import { describe, it, expect } from '@gjsify/unit';
import { existsTty } from './tty.js';

export default async () => {
	await describe('existsTty', async () => {
		await it('should return true', async () => {
			expect(existsTty()).toBeTruthy();
		});
	});
}
