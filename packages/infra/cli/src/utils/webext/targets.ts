// The build targets of `gjsify webext` (ADR 0077 § 2): `<browser>-mv<2|3>`.
//
// The vocabulary is mirrored by the `webext` conformance rule in
// `@gjsify/manifest-conformance` (plain `.mjs`, no import from here), so a
// target added on one side and not the other is refused by the rule before a
// build ever sees it.

export type WebextBrowser = 'chrome' | 'edge' | 'firefox' | 'opera' | 'safari';

export interface WebextTarget {
    /** As spelled in `gjsify.webext.targets` and the output directory name. */
    readonly id: string;
    readonly browser: WebextBrowser;
    readonly manifestVersion: 2 | 3;
}

export const WEBEXT_BROWSERS: readonly WebextBrowser[] = ['chrome', 'edge', 'firefox', 'opera', 'safari'];

/** What a project gets when it declares no `targets`. */
export const DEFAULT_WEBEXT_TARGETS: readonly string[] = ['chrome-mv3', 'firefox-mv3'];

/**
 * Why a browser takes no Manifest V2 folder, absent where it still does. Chrome
 * and Edge removed MV2 in the browser, so the folder would build, zip, and then
 * be refused on load. Opera still LOADS an MV2 extension but its store is
 * MV3-only (Opera, 2025-09), so the folder is refused a step later instead. The
 * outcome is the same either way, which is why the sentence is per browser and
 * not one claim the three do not all support.
 */
const MV2_UNSUPPORTED: ReadonlyMap<WebextBrowser, string> = new Map([
    ['chrome', 'chrome has removed Manifest V2'],
    ['edge', 'edge has removed Manifest V2'],
    ['opera', "opera's extension store accepts Manifest V3 only"],
]);

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
    const why = manifestVersion === 2 ? MV2_UNSUPPORTED.get(browser) : undefined;
    if (why !== undefined) {
        throw new Error(`gjsify webext: target "${id}" does not exist any more: ${why}. Use ${browser}-mv3.`);
    }
    return { id, browser, manifestVersion };
}

/** Whether `web-ext run` launches this target through its Firefox or its Chromium driver. */
export function webExtRunTarget(target: WebextTarget): 'firefox-desktop' | 'chromium' | null {
    if (target.browser === 'firefox') return 'firefox-desktop';
    // By ENGINE, not by brand: the chromium driver's only browser-specific input is the
    // binary, and `--browser-binary` already carries it — the claim branded Chrome and
    // Edge already make. Refusing opera here would be a claim about the operator's
    // binary, which is not what this switch is about.
    if (target.browser === 'chrome' || target.browser === 'edge' || target.browser === 'opera') return 'chromium';
    return null;
}
