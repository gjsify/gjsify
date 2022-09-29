import { describe, it, expect } from '@gjsify/unit';

import { WebGLRenderingContext, HTMLCanvasElement } from './index.js';
import Gtk from '@gjsify/types/Gtk-4.0';

export default async () => {
	await describe('true', async () => {
		await it('should be true', async () => {
			const glArea = new Gtk.GLArea();
			const canvas = new HTMLCanvasElement(glArea);
			const ctx = new WebGLRenderingContext(canvas);
			expect(ctx).toBeDefined();
		});
	});
}
