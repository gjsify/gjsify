import { describe, it, expect } from '@gjsify/unit';

export default async () => {

	await describe('Deno.errors.PermissionDenied', async () => {
		await it('should be have a working constructor', async () => {
			expect(() => {
				new Deno.errors.PermissionDenied();
			}).not?.toThrow();
		});

	});
}