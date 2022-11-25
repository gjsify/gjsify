import { describe, it, expect } from '@gjsify/unit';
import '@gjsify/deno_runtime/global';

export default async () => {

	await describe('Deno.errors.PermissionDenied', async () => {
		await it('should be a working constructor', async () => {
			expect(() => {
				new Deno.errors.PermissionDenied();
			}).not?.toThrow();
		});

	});
}