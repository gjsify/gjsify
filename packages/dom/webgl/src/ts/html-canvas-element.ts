// GTK-backed HTMLCanvasElement for GJS — original implementation using Gtk.GLArea
// Extends the DOM-spec base from @gjsify/dom-elements with GTK.GLArea integration.

import { warnNotImplemented } from '@gjsify/utils';
import { HTMLCanvasElement as BaseHTMLCanvasElement } from '@gjsify/dom-elements';
import Gtk from 'gi://Gtk?version=4.0';
// Circular import is intentional and safe in ESM (classes are only used at runtime, not at link time)
import { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';

export class HTMLCanvasElement extends BaseHTMLCanvasElement {

    _webgl?: OurWebGLRenderingContext;

    constructor(readonly gtkGlArea: Gtk.GLArea) {
        super();
    }

    /** Width from the GTK GLArea allocated size (overrides DOM attr-backed getter). */
    override get width(): number {
        return this.gtkGlArea.get_allocated_width();
    }

    override set width(_width: number) {
        warnNotImplemented('HTMLCanvasElement.set width');
    }

    /** Height from the GTK GLArea allocated size (overrides DOM attr-backed getter). */
    override get height(): number {
        return this.gtkGlArea.get_allocated_height();
    }

    override set height(_height: number) {
        warnNotImplemented('HTMLCanvasElement.set height');
    }

    get clientWidth(): number {
        return this.width;
    }

    get clientHeight(): number {
        return this.height;
    }

    /** Returns the underlying Gtk.GLArea. Used by WebGLRenderingContext for GLSL version detection. */
    getGlArea(): Gtk.GLArea {
        return this.gtkGlArea;
    }

    /**
     * Returns a WebGL rendering context backed by the underlying Gtk.GLArea.
     * Only 'webgl' is supported; other context types return null.
     */
    override getContext(contextId: string, options?: any): any {
        if (contextId === 'webgl') {
            this._webgl ??= new OurWebGLRenderingContext(this as any, options);
            return this._webgl;
        }
        warnNotImplemented(`HTMLCanvasElement.getContext("${contextId}")`);
        return null;
    }
}
