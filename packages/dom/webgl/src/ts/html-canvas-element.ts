import { warnNotImplemented, notImplemented } from '@gjsify/utils'
import Gtk from 'gi://Gtk?version=4.0';
import { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';

// TODO this fakes the implementation of HTMLCanvasElement, create a new package for a real implementation based on https://github.com/capricorn86/happy-dom/tree/master/packages/happy-dom/src/nodes/html-element
export interface GjsifyHTMLCanvasElement extends HTMLCanvasElement {}

export class GjsifyHTMLCanvasElement implements HTMLCanvasElement {

    _webgl?: WebGLRenderingContext & GjsifyWebGLRenderingContext

    _getGlArea() {
        return this.gtkGlArea;
    }

    constructor(protected readonly gtkGlArea: Gtk.GLArea) {

    }

    /** Gets the height of a canvas element on a document. */
    get height() {
        return this.gtkGlArea.get_allocated_height()
        // return this.gtkGlArea.get_height()
    }

    get clientHeight() {
        return this.height;
    }
    
    /** Sets the height of a canvas element on a document. */
    set height(_height: number) {
        warnNotImplemented('GjsifyHTMLCanvasElement.set_height');
    }

    /** Gets the width of a canvas element on a document. */
    get width() {
        return this.gtkGlArea.get_allocated_width()
        // return this.gtkGlArea.get_width()
    }

    /** Sets the width of a canvas element on a document. */
    set width(_width: number) {
        warnNotImplemented('GjsifyHTMLCanvasElement.set_width');
    }

    get clientWidth() {
        return this.width;
    }

    captureStream(_frameRequestRate?: number): MediaStream {
        notImplemented('HTMLCanvasElement.captureStream');
        return new MediaStream();
    }

    /**
     * Returns an object that provides methods and properties for drawing and manipulating images and graphics on a canvas element in a document. A context object includes information about colors, line widths, fonts, and other graphic parameters that can be drawn on a canvas.
     * @param contextId The identifier (ID) of the type of canvas to create. Internet Explorer 9 and Internet Explorer 10 support only a 2-D context using canvas.getContext("2d"); IE11 Preview also supports 3-D or WebGL context using canvas.getContext("experimental-webgl");
     */
    getContext(contextId: "2d", options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
    getContext(contextId: "bitmaprenderer", options?: ImageBitmapRenderingContextSettings): ImageBitmapRenderingContext | null;
    getContext(contextId: "webgl", options?: WebGLContextAttributes): WebGLRenderingContext & GjsifyWebGLRenderingContext | null;
    getContext(contextId: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
    getContext(contextId: string, options?: any): RenderingContext | null {
        switch (contextId) {
            case "webgl":
                if(this._webgl) {
                    return this._webgl;
                }
                this._webgl = new GjsifyWebGLRenderingContext(this, options) as WebGLRenderingContext & GjsifyWebGLRenderingContext;
                return this._webgl;
            default:
                warnNotImplemented(`GjsifyHTMLCanvasElement.getContext("${contextId}")`);
        }
        return null;
    }

    toBlob(_callback: BlobCallback, _type?: string, _quality?: any): void {
        notImplemented('HTMLCanvasElement.toBlob');
    }
    /**
     * Returns the content of the current canvas as an image that you can use as a source for another canvas or an HTML element.
     * @param _type The standard MIME type for the image format to return. If you do not specify this parameter, the default value is a PNG format image.
     */
    toDataURL(_type?: string, _quality?: any): string {
        notImplemented('HTMLCanvasElement.toDataURL');
        return '';
    }
    addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLCanvasElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(_type: string, _listener: EventListenerOrEventListenerObject, _options?: boolean | AddEventListenerOptions): void {
        notImplemented('HTMLCanvasElement.addEventListener');
    }
    removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLCanvasElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
    removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject, _options?: boolean | EventListenerOptions): void {
        notImplemented('HTMLCanvasElement.removeEventListener');
    }
}

export { GjsifyHTMLCanvasElement as HTMLCanvasElement }