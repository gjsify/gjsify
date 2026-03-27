// Shared interfaces for @gjsify/iframe

/** Options passed to IFrameWidget constructor */
export interface IFrameWidgetOptions {
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

/** Callback for when the IFrameWidget is ready */
export type IFrameReadyCallback = (iframe: globalThis.HTMLIFrameElement) => void;
