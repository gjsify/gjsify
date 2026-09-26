// The build targets of `gjsify webext` (ADR 0077 § 2): `<browser>-mv<2|3>`.
//
// The vocabulary is mirrored by the `webext` conformance rule in
// `@gjsify/manifest-conformance` (plain `.mjs`, no import from here), so a
// target added on one side and not the other is refused by the rule before a
// build ever sees it.

export type WebextBrowser = 'chrome' | 'edge' | 'firefox' | 'safari';

export interface WebextTarget {
    /** As spelled in `gjsify.webext.targets` and the output directory name. */
    readonly id: string;
    readonly browser: WebextBrowser;
    readonly manifestVersion: 2 | 3;
}

export const WEBEXT_BROWSERS: readonly WebextBrowser[] = ['chrome', 'edge', 'firefox', 'safari'];

/** What a project gets when it declares no `targets`. */
export const DEFAULT_WEBEXT_TARGETS: readonly string[] = ['chrome-mv3', 'firefox-mv3'];

/**
 * Chromium-based browsers no longer load Manifest V2 at all, so a `chrome-mv2`
 * folder would build, zip, and then be rejected by the browser and the store.
 */
const MV2_REMOVED: ReadonlySet<WebextBrowser> = new Set(['chrome', 'edge']);

export function parseWebextTarget(id: string): WebextTarget {
    const match = /^([a-z]+)-mv([23])$/.exec(id);
    const browser = match?.[1] as WebextBrowser | undefined;
    if (!match || browser === undefined || !WEBEXT_BROWSERS.includes(browser)) {
        throw new Error(
            `gjsify webext: unknown target "${id}". A target is <browser>-mv<2|3> with browser one of ` +
                `${WEBEXT_BROWSERS.join(', ')} (e.g. chrome-mv3, firefox-mv2).`,
        );
    }
    const manifestVersion = match[2] === '2' ? 2 : 3;
    if (manifestVersion === 2 && MV2_REMOVED.has(browser)) {
        throw new Error(
            `gjsify webext: target "${id}" does not exist any more: ${browser} has removed Manifest V2. ` +
                `Use ${browser}-mv3.`,
        );
    }
    return { id, browser, manifestVersion };
}

/** Whether `web-ext run` launches this target through its Firefox or its Chromium driver. */
export function webExtRunTarget(target: WebextTarget): 'firefox-desktop' | 'chromium' | null {
    if (target.browser === 'firefox') return 'firefox-desktop';
    if (target.browser === 'chrome' || target.browser === 'edge') return 'chromium';
    return null;
}
