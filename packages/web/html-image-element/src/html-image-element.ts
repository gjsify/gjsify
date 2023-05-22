import '@girs/gdkpixbuf-2.0'
import { notImplemented, warnNotImplemented } from '@gjsify/utils';
import GLib from 'gi://GLib?version=2.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import { Event } from '@gjsify/dom-events';
const System = imports.system;

import type { IHTMLImageElement, ImageData } from './types/index.js';
import type { HTMLElement } from 'happy-dom';

// WORKAROUND TODO: port HTMLElement from happy-dom
export interface HTMLImageElement extends HTMLElement {}

/**
 * HTML Image Element.
 *
 * Reference:
 * https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement.
 */
export class HTMLImageElement implements IHTMLImageElement {
	public readonly tagName: string = 'IMG';
	public readonly complete = false;
	public readonly naturalHeight = 0;
	public readonly naturalWidth = 0;
	public crossOrigin = null;
	public decoding = 'auto';
	public loading = 'auto';
	public readonly x = 0;
	public readonly y = 0;

	public onload: null | ((event: Event) => void) = null;

    protected _pixbuf?: GdkPixbuf.Pixbuf;

	/**
	 * Custom method to get the pixels of `GdkPixbuf.Pixbuf`
	 * @returns 
	 */
	public getImageData(): ImageData | null {
		const data = this._pixbuf?.get_pixels() || null;
		if(!data) {
			return null;
		}
		const imageData: ImageData = {
			colorSpace: 'srgb', // TODO?
			data: new Uint8ClampedArray(data),
			height: this.height,
			width: this.width,
		}
		return imageData;
	}

	/**
	 * Custom method to check if this image is a `GdkPixbuf.Pixbuf`
	 * @returns 
	 */
	public isPixbuf() {
		return !!this._pixbuf;
	}

	/**
	 * Returns alt.
	 *
	 * @returns Alt.
	 */
	public get alt(): string {
		notImplemented('HTMLImageElement.alt');
		return this.getAttributeNS("", 'alt') || '';
	}

	/**
	 * Sets alt.
	 *
	 * @param alt Alt.
	 */
	public set alt(alt: string) {
		notImplemented('HTMLImageElement.alt');
		this.setAttributeNS("", 'alt', alt);
	}

	/**
	 * Returns current src.
	 *
	 * @returns Current src.
	 */
	public get currentSrc(): string {
		return this.src;
	}

	/**
	 * Returns height.
	 *
	 * @returns Height.
	 */
	public get height(): number {
        if(this._pixbuf?.get_height) {
            return this._pixbuf?.get_height();
        }
		// TODO
		// const height = this.getAttributeNS("", 'height');
		// return height !== null ? Number(height) : 0;
		return 0;
	}

	/**
	 * Sets height.
	 *
	 * @param height Height.
	 */
	public set height(height: number) {
		notImplemented('HTMLImageElement.height');
		this.setAttributeNS("", 'height', String(height));
	}

	/**
	 * Returns is map.
	 *
	 * @returns Is map.
	 */
	public get isMap(): boolean {
		notImplemented('HTMLImageElement.isMap');
		return this.getAttributeNS("", 'ismap') !== null;
	}

	/**
	 * Sets is map.
	 *
	 * @param ismap Is map.
	 */
	public set isMap(isMap: boolean) {
		notImplemented('HTMLImageElement.isMap');
		if (!isMap) {
			this.removeAttributeNS("", 'ismap');
		} else {
			this.setAttributeNS("", 'ismap', '');
		}
	}

	/**
	 * Returns referrer policy.
	 *
	 * @returns Referrer policy.
	 */
	public get referrerPolicy(): string {
		notImplemented('HTMLImageElement.referrerPolicy');
		return this.getAttributeNS("", 'referrerpolicy') || '';
	}

	/**
	 * Sets referrer policy.
	 *
	 * @param referrerPolicy Referrer policy.
	 */
	public set referrerPolicy(referrerPolicy: string) {
		notImplemented('HTMLImageElement.referrerPolicy');
		this.setAttributeNS("", 'referrerpolicy', referrerPolicy);
	}

	/**
	 * Returns sizes.
	 *
	 * @returns Sizes.
	 */
	public get sizes(): string {
		notImplemented('HTMLImageElement.sizes');
		return this.getAttributeNS("", 'sizes') || '';
	}

	/**
	 * Sets sizes.
	 *
	 * @param sizes Sizes.
	 */
	public set sizes(sizes: string) {
		notImplemented('HTMLImageElement.sizes');
		this.setAttributeNS("", 'sizes', sizes);
	}

	/**
	 * Returns source.
	 *
	 * @returns Source.
	 */
	public get src(): string {
		warnNotImplemented('HTMLImageElement.src');
		return this.getAttributeNS?.("", 'src') || '';
	}

	/**
	 * Sets source.
	 *
	 * @param src Source.
	 */
	public set src(src: string) {
		// TODO
		// this.setAttributeNS("", 'src', src);

        const dir = GLib.path_get_dirname(System.programInvocationName);
        const filename = GLib.build_filenamev([dir, src]);

        this._pixbuf = GdkPixbuf.Pixbuf.new_from_file(filename);

        const loadEvent = new Event("load");

        if(typeof this.onload === 'function') {
            this.onload(loadEvent);
        }
		// TODO
		if(typeof this.dispatchEvent === 'function') {
        	this.dispatchEvent(loadEvent as any);
		}
	}

	/**
	 * Returns srcset.
	 *
	 * @returns Source.
	 */
	public get srcset(): string {
		notImplemented('HTMLImageElement.srcset');
		return this.getAttributeNS("", 'srcset') || '';
	}

	/**
	 * Sets src set.
	 *
	 * @param srcset Src set.
	 */
	public set srcset(srcset: string) {
		notImplemented('HTMLImageElement.srcset');
		this.setAttributeNS("", 'srcset', srcset);
	}

	/**
	 * Returns use map.
	 *
	 * @returns Use map.
	 */
	public get useMap(): string {
		notImplemented('HTMLImageElement.useMap');
		return this.getAttributeNS("", 'usemap') || '';
	}

	/**
	 * Sets is map.
	 *
	 * @param useMap Is map.
	 */
	public set useMap(useMap: string) {
		notImplemented('HTMLImageElement.useMap');
		this.setAttributeNS("", 'usemap', useMap);
	}

	/**
	 * Returns width.
	 *
	 * @returns Width.
	 */
	public get width(): number {
        if(this._pixbuf?.get_width) {
            return this._pixbuf?.get_width();
        }

		// const width = this.getAttributeNS("", 'width');
		// return width !== null ? Number(width) : 0;
		return 0;
	}

	/**
	 * Sets width.
	 *
	 * @param width Width.
	 */
	public set width(width: number) {
		notImplemented('HTMLImageElement.width');
		this.setAttributeNS("", 'width', String(width));
	}

	/**
	 * The decode() method of the HTMLImageElement interface returns a Promise that resolves when the image is decoded and it is safe to append the image to the DOM.
	 *
	 * @returns Promise.
	 */
	public decode(): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Clones a node.
	 *
	 * @override
	 * @param [_deep=false] "true" to clone deep.
	 * @returns Cloned node.
	 */
	public cloneNode(_deep = false): IHTMLImageElement {
		notImplemented('HTMLImageElement.cloneNode');
		// return <IHTMLImageElement>super.cloneNode(deep);
	}
}