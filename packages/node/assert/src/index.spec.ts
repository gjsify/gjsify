import { describe, it, expect } from '@gjsify/unit';
import { equal } from 'assert';

export default async () => {
	await describe('assert.equal', async () => {
		await it('should do nothing if both values are qual', async () => {
			expect(() => {
				equal(true, true);
			}).not.toThrow();
		});

		await it('should throw both values are not qual', async () => {
			expect(() => {
				equal(true, false);
			}).toThrow();
		});
	});
}
