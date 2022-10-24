import { warnNotImplemented } from '@gjsify/utils'
import Gtk from '@gjsify/types/Gtk-4.0';
import { GjsifyWebGLRenderingContext } from './webgl-rendering-context';

export class GjsifyHTMLCanvasElement /*TODO implements HTMLCanvasElement*/ {

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

    /** Sets the height of a canvas element on a document. */
    set height(height: number) {
        warnNotImplemented('GjsifyHTMLCanvasElement.set_height');
    }

    /** Gets the width of a canvas element on a document. */
    get width() {
        return this.gtkGlArea.get_allocated_width()
        // return this.gtkGlArea.get_width()
    }

    /** Sets the width of a canvas element on a document. */
    set width(width: number) {
        warnNotImplemented('GjsifyHTMLCanvasElement.set_width');
    }

    captureStream(frameRequestRate?: number): MediaStream {
        return {} as any; // TODO
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
    toBlob(callback: BlobCallback, type?: string, quality?: any): void {

    }
    /**
     * Returns the content of the current canvas as an image that you can use as a source for another canvas or an HTML element.
     * @param type The standard MIME type for the image format to return. If you do not specify this parameter, the default value is a PNG format image.
     */
    toDataURL(type?: string, quality?: any): string {
        return '';
    }
    addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLCanvasElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {

    }
    removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLCanvasElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {

    }
}

export { GjsifyHTMLCanvasElement as HTMLCanvasElement }