// Ported from refs/happy-dom/packages/happy-dom/test/nodes/html-image-element/HTMLImageElement.test.ts
// Original: MIT license, Copyright (c) David Ortner (capricorn86)

import { describe, it, expect } from '@gjsify/unit';

import { HTMLImageElement, Image } from '@gjsify/html-image-element';

export default async () => {
	await describe('HTMLImageElement', async () => {
		await it('should be defined', async () => {
			expect(!!HTMLImageElement).toBeTruthy();
		});

		await it('should create a new instance', async () => {
			const el = new HTMLImageElement();
			expect(!!el).toBeTruthy();
		});

		await it('should have correct [Symbol.toStringTag]', async () => {
			const el = new HTMLImageElement();
			expect(Object.prototype.toString.call(el)).toBe('[object HTMLImageElement]');
		});

		await it('should have tagName IMG', async () => {
			const el = new HTMLImageElement();
			expect(el.tagName).toBe('IMG');
		});

		// -- Attribute-backed string properties --

		await it('should get/set alt', async () => {
			const el = new HTMLImageElement();
			expect(el.alt).toBe('');
			el.alt = 'An image';
			expect(el.alt).toBe('An image');
		});

		await it('should get/set referrerPolicy', async () => {
			const el = new HTMLImageElement();
			expect(el.referrerPolicy).toBe('');
			el.referrerPolicy = 'no-referrer';
			expect(el.referrerPolicy).toBe('no-referrer');
		});

		await it('should get/set sizes', async () => {
			const el = new HTMLImageElement();
			expect(el.sizes).toBe('');
			el.sizes = '(max-width: 600px) 480px, 800px';
			expect(el.sizes).toBe('(max-width: 600px) 480px, 800px');
		});

		await it('should get/set srcset', async () => {
			const el = new HTMLImageElement();
			expect(el.srcset).toBe('');
			el.srcset = 'image-480w.jpg 480w, image-800w.jpg 800w';
			expect(el.srcset).toBe('image-480w.jpg 480w, image-800w.jpg 800w');
		});

		await it('should get/set useMap', async () => {
			const el = new HTMLImageElement();
			expect(el.useMap).toBe('');
			el.useMap = '#mymap';
			expect(el.useMap).toBe('#mymap');
		});

		await it('should get/set decoding', async () => {
			const el = new HTMLImageElement();
			expect(el.decoding).toBe('auto');
			el.decoding = 'async';
			expect(el.decoding).toBe('async');
		});

		// -- crossOrigin (nullable) --

		await it('should get/set crossOrigin', async () => {
			const el = new HTMLImageElement();
			expect(el.crossOrigin).toBeNull();
			el.crossOrigin = 'anonymous';
			expect(el.crossOrigin).toBe('anonymous');
			el.crossOrigin = null;
			expect(el.crossOrigin).toBeNull();
		});

		// -- Numeric properties --

		await it('should get/set height from attribute', async () => {
			const el = new HTMLImageElement();
			expect(el.height).toBe(0);
			el.height = 100;
			expect(el.height).toBe(100);
		});

		await it('should get/set width from attribute', async () => {
			const el = new HTMLImageElement();
			expect(el.width).toBe(0);
			el.width = 200;
			expect(el.width).toBe(200);
		});

		// -- Boolean property --

		await it('should get/set isMap', async () => {
			const el = new HTMLImageElement();
			expect(el.isMap).toBe(false);
			el.isMap = true;
			expect(el.isMap).toBe(true);
			el.isMap = false;
			expect(el.isMap).toBe(false);
		});

		// -- loading --

		await it('should return auto for invalid loading values', async () => {
			const el = new HTMLImageElement();
			expect(el.loading).toBe('auto');
			el.loading = 'lazy';
			expect(el.loading).toBe('lazy');
			el.loading = 'eager';
			expect(el.loading).toBe('eager');
			el.loading = 'invalid';
			expect(el.loading).toBe('auto');
		});

		// -- Read-only properties --

		await it('should have default read-only values', async () => {
			const el = new HTMLImageElement();
			expect(el.complete).toBe(false);
			expect(el.naturalHeight).toBe(0);
			expect(el.naturalWidth).toBe(0);
			expect(el.x).toBe(0);
			expect(el.y).toBe(0);
		});

		await it('should return src as currentSrc', async () => {
			const el = new HTMLImageElement();
			expect(el.currentSrc).toBe('');
		});

		// -- decode() --

		await it('should resolve decode()', async () => {
			const el = new HTMLImageElement();
			const result = el.decode();
			expect(result instanceof Promise).toBe(true);
			await result;
		});
	});

	await describe('Image', async () => {
		await it('should be defined', async () => {
			expect(!!Image).toBeTruthy();
		});

		await it('should create an instance', async () => {
			const img = new Image();
			expect(!!img).toBeTruthy();
			expect(img instanceof HTMLImageElement).toBe(true);
		});

		await it('should accept width and height', async () => {
			const img = new Image(320, 240);
			expect(img.width).toBe(320);
			expect(img.height).toBe(240);
		});

		await it('should accept null width and height', async () => {
			const img = new Image(null, null);
			expect(img.width).toBe(0);
			expect(img.height).toBe(0);
		});
	});
};
