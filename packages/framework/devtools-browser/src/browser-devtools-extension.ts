// browserDevtoolsExtension — exposes the browser's web-debugging surface over
// org.gjsify.Devtools (merged into the generic control plane by installDevtools).
//
// Mirrors @gjsify/storybook's devtools-extension: a `<method>` XML fragment +
// positional handlers + a pause classification per method + extra GetStatus
// keys. Handlers call IFrameBridge directly (it IS the WebKit.WebView). The
// generic devtools methods (Screenshot of the GTK window, ListActions,
// ResizeWindow, PresentWindow, …) stay available — this only adds the
// web-specific surface.

import type { DevtoolsExtension } from '@gjsify/devtools';
import type { IFrameBridge } from '@gjsify/iframe';

import type { BrowserCore } from './browser-core.js';
import type { BrowserWindow } from './browser-window.js';

export interface BrowserDevtoolsExtensionOptions {
    bridge: IFrameBridge;
    core: BrowserCore;
    window: BrowserWindow;
}

/**
 * Build the {@link DevtoolsExtension} for the browser tool. Navigation goes
 * through {@link BrowserCore} (keeping the app history stack + URL bar in sync);
 * inspection/screenshot/eval go straight to the {@link IFrameBridge}.
 */
export function browserDevtoolsExtension(options: BrowserDevtoolsExtensionOptions): DevtoolsExtension {
    const { bridge, core } = options;

    // The page announces its title via postMessage (page-loaded); cache it so
    // GetPageInfo has a title even before WebKit's own <title> is known.
    let lastTitle = '';
    core.onPageLoaded((info) => {
        lastTitle = info.title;
    });

    return {
        methodsXml: [
            '<method name="BrowserNavigate"><arg type="s" direction="in" name="url"/></method>',
            '<method name="BrowserBack"></method>',
            '<method name="BrowserForward"></method>',
            '<method name="BrowserReload"></method>',
            '<method name="BrowserGetPageInfo"><arg type="s" direction="out" name="info_json"/></method>',
            '<method name="BrowserScreenshot"><arg type="s" direction="in" name="region"/><arg type="ay" direction="out" name="png"/></method>',
            '<method name="BrowserSetViewport"><arg type="i" direction="in" name="width"/><arg type="i" direction="in" name="height"/><arg type="i" direction="out" name="w"/><arg type="i" direction="out" name="h"/></method>',
            '<method name="BrowserEvalJs"><arg type="s" direction="in" name="script"/><arg type="s" direction="out" name="result_json"/></method>',
            '<method name="BrowserGetLinks"><arg type="s" direction="out" name="links_json"/></method>',
            '<method name="BrowserFollowLink"><arg type="s" direction="in" name="selector_or_text"/><arg type="s" direction="out" name="result_json"/></method>',
            '<method name="BrowserQueryDom"><arg type="s" direction="in" name="selector"/><arg type="s" direction="out" name="elements_json"/></method>',
            '<method name="BrowserWaitForLoad"><arg type="i" direction="in" name="timeout_ms"/><arg type="b" direction="out" name="ok"/></method>',
            '<method name="BrowserGetConsole"><arg type="s" direction="out" name="logs_json"/></method>',
        ],
        handlers: {
            BrowserNavigate: (url: string): void => {
                core.navigate(url);
            },
            BrowserBack: (): void => {
                core.back();
            },
            BrowserForward: (): void => {
                core.forward();
            },
            BrowserReload: (): void => {
                core.reload();
            },
            BrowserGetPageInfo: (): string =>
                JSON.stringify(
                    {
                        uri: bridge.currentUri,
                        appUrl: core.currentUrl,
                        title: bridge.pageTitle || lastTitle,
                        canGoBack: core.canGoBack,
                        canGoForward: core.canGoForward,
                        lastLoadError: bridge.lastLoadError,
                    },
                    null,
                    2,
                ),
            // WebKit compositor PNG — NOT a GSK widget snapshot (WebKit composites
            // out-of-process, so the generic Screenshot of this widget is blank).
            BrowserScreenshot: async (region: string): Promise<Uint8Array> =>
                bridge.takeScreenshot(region === 'visible' ? 'visible' : 'full'),
            BrowserSetViewport: (width: number, height: number): [number, number] => {
                bridge.setViewportSize(width, height);
                const size = bridge.getViewportSize();
                return [size.width, size.height];
            },
            BrowserEvalJs: async (script: string): Promise<string> =>
                JSON.stringify((await bridge.evaluateJavaScript(script)) ?? null, null, 2),
            BrowserGetLinks: async (): Promise<string> => JSON.stringify(await bridge.getLinks(), null, 2),
            BrowserFollowLink: async (selectorOrText: string): Promise<string> => {
                // Register the navigation wait BEFORE clicking (a fast nav could
                // finish first). A non-navigating click (in-page anchor) makes the
                // wait time out → navigated:false, which is expected, not an error.
                const nav = bridge.waitForNavigation();
                const clicked = await bridge.clickElement(selectorOrText);
                if (!clicked) {
                    return JSON.stringify({ clicked: false, navigated: false }, null, 2);
                }
                let navigated = true;
                try {
                    await nav;
                } catch {
                    navigated = false;
                }
                return JSON.stringify({ clicked: true, navigated, uri: bridge.currentUri }, null, 2);
            },
            BrowserQueryDom: async (selector: string): Promise<string> =>
                JSON.stringify(await bridge.queryDom(selector), null, 2),
            BrowserWaitForLoad: async (timeoutMs: number): Promise<boolean> => {
                try {
                    await bridge.waitForNavigation(timeoutMs > 0 ? timeoutMs : 30000);
                    return true;
                } catch {
                    return false;
                }
            },
            BrowserGetConsole: (): string => JSON.stringify(bridge.getConsoleLogs(), null, 2),
        },
        methodKinds: {
            BrowserNavigate: 'mutating',
            BrowserBack: 'mutating',
            BrowserForward: 'mutating',
            BrowserReload: 'mutating',
            BrowserGetPageInfo: 'read-only',
            BrowserScreenshot: 'read-only',
            BrowserSetViewport: 'mutating',
            // Arbitrary JS execution is state-changing → pause-gated.
            BrowserEvalJs: 'mutating',
            BrowserGetLinks: 'read-only',
            BrowserFollowLink: 'mutating',
            BrowserQueryDom: 'read-only',
            BrowserWaitForLoad: 'read-only',
            BrowserGetConsole: 'read-only',
        },
        contributeStatus: () => ({
            browser: {
                uri: bridge.currentUri,
                title: bridge.pageTitle || lastTitle,
                canGoBack: core.canGoBack,
                canGoForward: core.canGoForward,
                lastLoadError: bridge.lastLoadError,
            },
        }),
    };
}
