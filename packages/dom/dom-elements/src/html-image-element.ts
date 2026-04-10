// HTMLImageElement for GJS — original implementation using GdkPixbuf
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-image-element/HTMLImageElement.ts

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import GdkPixbuf from '@girs/gdkpixbuf-2.0';
import { Event } from '@gjsify/dom-events';
import { HTMLElement } from './html-element.js';
import * as PropertySymbol from './property-symbol.js';
import { NamespaceURI } from './namespace-uri.js';
import System from 'system';

import type { ImageData } from './types/index.js';

/**
 * HTML Image Element.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement
 */
export class HTMLImageElement extends HTMLElement {
	private _complete = false;
	private _naturalHeight = 0;
	private _naturalWidth = 0;
	protected _pixbuf?: GdkPixbuf.Pixbuf;

	constructor() {
		super();
		this[PropertySymbol.tagName] = 'IMG';
		this[PropertySymbol.localName] = 'img';
		this[PropertySymbol.namespaceURI] = NamespaceURI.html;
	}

	// -- Read-only properties --

	get complete(): boolean {
		return this._complete;
	}

	get naturalHeight(): number {
		return this._naturalHeight;
	}

	get naturalWidth(): number {
		return this._naturalWidth;
	}

	get currentSrc(): string {
		return this.src;
	}

	get x(): number {
		return 0;
	}

	get y(): number {
		return 0;
	}

	// -- Attribute-backed string properties --

	get alt(): string {
		return this.getAttribute('alt') ?? '';
	}

	set alt(value: string) {
		this.setAttribute('alt', value);
	}

	get crossOrigin(): string | null {
		return this.getAttribute('crossorigin');
	}

	set crossOrigin(value: string | null) {
		if (value === null) {
			this.removeAttribute('crossorigin');
		} else {
			this.setAttribute('crossorigin', value);
		}
	}

	get decoding(): string {
		return this.getAttribute('decoding') ?? 'auto';
	}

	set decoding(value: string) {
		this.setAttribute('decoding', value);
	}

	get loading(): string {
		const value = this.getAttribute('loading');
		if (value === 'lazy' || value === 'eager') return value;
		return 'auto';
	}

	set loading(value: string) {
		this.setAttribute('loading', value);
	}

	get referrerPolicy(): string {
		return this.getAttribute('referrerpolicy') ?? '';
	}

	set referrerPolicy(value: string) {
		this.setAttribute('referrerpolicy', value);
	}

	get sizes(): string {
		return this.getAttribute('sizes') ?? '';
	}

	set sizes(value: string) {
		this.setAttribute('sizes', value);
	}

	get src(): string {
		return this.getAttribute('src') ?? '';
	}

	set src(src: string) {
		this.setAttribute('src', src);

		const DEBUG = (globalThis as any).__GJSIFY_DEBUG_IMG === true;

		// Handle data: URIs (e.g. base64 PNG logos from Excalibur's loader)
		if (src.startsWith('data:')) {
			const commaIdx = src.indexOf(',');
			if (commaIdx === -1) {
				this._complete = true;
				this.dispatchEvent(new Event('error'));
				return;
			}
			const meta = src.slice(5, commaIdx); // between 'data:' and ','
			const data = src.slice(commaIdx + 1);
			const isBase64 = meta.includes(';base64');
			try {
				let bytes: Uint8Array;
				if (isBase64) {
					// Use GLib.base64_decode — available in all GJS versions, no global needed
					bytes = GLib.base64_decode(data) as unknown as Uint8Array;
				} else {
					bytes = new TextEncoder().encode(decodeURIComponent(data));
				}
				const gbytes = GLib.Bytes.new(bytes);
				const stream = Gio.MemoryInputStream.new_from_bytes(gbytes);
				this._pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
				this._naturalWidth = this._pixbuf!.get_width();
				this._naturalHeight = this._pixbuf!.get_height();
				this._complete = true;
				if (DEBUG) console.log(`[img] ok data: (${this._naturalWidth}x${this._naturalHeight})`);
				this.dispatchEvent(new Event('load'));
			} catch (_error) {
				if (DEBUG) console.warn(`[img] error data:: ${(_error as any)?.message ?? _error}`);
				this._complete = true;
				this.dispatchEvent(new Event('error'));
			}
			return;
		}

		let filename: string;
		if (src.startsWith('file://')) {
			// GLib.filename_from_uri returns [localPath, hostname]
			filename = GLib.filename_from_uri(src)[0];
		} else if (src.startsWith('http://') || src.startsWith('https://')) {
			// Remote URLs are not supported in GJS — fire error
			this._complete = true;
			this.dispatchEvent(new Event('error'));
			return;
		} else {
			// Relative path — resolve against the directory of the running script
			const dir = GLib.path_get_dirname(System.programInvocationName);
			filename = GLib.build_filenamev([dir, src]);
		}

		try {
			if (DEBUG) console.log(`[img] load ${filename}`);
			this._pixbuf = GdkPixbuf.Pixbuf.new_from_file(filename);
			this._naturalWidth = this._pixbuf.get_width();
			this._naturalHeight = this._pixbuf.get_height();
			this._complete = true;
			if (DEBUG) console.log(`[img] ok ${filename} (${this._naturalWidth}x${this._naturalHeight})`);

			this.dispatchEvent(new Event('load'));
		} catch (_error) {
			if (DEBUG) console.warn(`[img] error ${filename}: ${(_error as any)?.message ?? _error}`);
			this._complete = true;
			this.dispatchEvent(new Event('error'));
		}
	}

	get srcset(): string {
		return this.getAttribute('srcset') ?? '';
	}

	set srcset(value: string) {
		this.setAttribute('srcset', value);
	}

	get useMap(): string {
		return this.getAttribute('usemap') ?? '';
	}

	set useMap(value: string) {
		this.setAttribute('usemap', value);
	}

	// -- Attribute-backed numeric properties --

	get height(): number {
		if (this._pixbuf) {
			return this._pixbuf.get_height();
		}
		const attr = this.getAttribute('height');
		return attr !== null ? Number(attr) : 0;
	}

	set height(value: number) {
		this.setAttribute('height', String(value));
	}

	get width(): number {
		if (this._pixbuf) {
			return this._pixbuf.get_width();
		}
		const attr = this.getAttribute('width');
		return attr !== null ? Number(attr) : 0;
	}

	set width(value: number) {
		this.setAttribute('width', String(value));
	}

	// -- Attribute-backed boolean property --

	get isMap(): boolean {
		return this.hasAttribute('ismap');
	}

	set isMap(value: boolean) {
		if (value) {
			this.setAttribute('ismap', '');
		} else {
			this.removeAttribute('ismap');
		}
	}

	// -- Methods --

	/**
	 * Decode the image. Returns a promise that resolves when the image is decoded.
	 */
	decode(): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Clone this node.
	 */
	cloneNode(deep = false): HTMLImageElement {
		return super.cloneNode(deep) as HTMLImageElement;
	}

	// -- GJS-specific extensions --

	/**
	 * Get the pixels of the loaded GdkPixbuf as ImageData.
	 * Always returns RGBA (4 channels) — matches standard browser ImageData behaviour
	 * and what WebGL expects for texSubImage2D with format=RGBA.
	 * JPEG and other non-alpha formats are promoted to RGBA via add_alpha().
	 */
	getImageData(): ImageData | null {
		if (!this._pixbuf) return null;
		// add_alpha() is a no-op when the pixbuf already has alpha; for RGB-only
		// pixbufs (e.g. JPEG) it appends a fully opaque alpha channel.
		const rgba = this._pixbuf.get_has_alpha()
			? this._pixbuf
			: (this._pixbuf.add_alpha(false, 0, 0, 0) ?? this._pixbuf);
		return {
			colorSpace: 'srgb',
			data: new Uint8ClampedArray(rgba.get_pixels()),
			height: rgba.get_height(),
			width: rgba.get_width(),
		};
	}

	/**
	 * Check if this image is backed by a GdkPixbuf.
	 */
	isPixbuf(): boolean {
		return !!this._pixbuf;
	}

	get [Symbol.toStringTag](): string {
		return 'HTMLImageElement';
	}
}
