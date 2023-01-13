import { describe, it, expect } from '@gjsify/unit';

import { HTMLImageElement } from "@gjsify/html-image-element";

export default async () => {
	await describe('html-image-element', async () => {
		await it('should be defined', async () => {
			expect(!!HTMLImageElement).toBeTruthy()
		});
	});

	await describe('html-image-element', async () => {
		await it('should be able to create a new instance of', async () => {
			const image = new HTMLImageElement();
			expect(!!image).toBeTruthy()
		});
	});
}
