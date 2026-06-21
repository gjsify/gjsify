// Shared interfaces for @gjsify/iframe

/** Options passed to IFrameBridge constructor */
export interface IFrameBridgeOptions {
    /** Enable developer extras (Web Inspector). Default: true */
    enableDeveloperExtras?: boolean;
    /** Enable JavaScript execution in the WebView. Default: true */
    enableJavascript?: boolean;
}

/** Data structure for messages crossing the GJS/WebView boundary */
export interface IFrameMessageData {
    data: unknown;
    targetOrigin: string;
    origin: string;
}

/** Callback for when the IFrameBridge is ready */
export type IFrameReadyCallback = (iframe: globalThis.HTMLIFrameElement) => void;

/** Detail of the most recent failed load (a network / main-resource failure
 *  surfaced by WebKit's `load-failed` signal, distinct from an HTTP error
 *  page which still loads and reports `FINISHED`). */
export interface LoadErrorInfo {
    /** The URI that failed to load. */
    uri: string;
    /** Human-readable failure message from WebKit / GLib. */
    message: string;
}

/** Callback invoked when a load fails. */
export type LoadErrorCallback = (info: LoadErrorInfo) => void;
