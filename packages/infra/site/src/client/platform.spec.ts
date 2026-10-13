import { describe, expect, it } from '@gjsify/unit';

import {
    detectArch,
    detectBrowser,
    detectOs,
    detectVisitorPlatform,
    inGroup,
    recommendTarget,
    type TargetChoice,
} from './platform.js';

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const SAFARI_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const CHROME_ANDROID =
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const SAFARI_IPAD =
    'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const CHROME_LINUX =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';

const target = (os: TargetChoice['os'], arch: TargetChoice['arch'], recommended = false): TargetChoice => ({
    os,
    arch,
    recommended,
});

const TARGETS: TargetChoice[] = [
    target('linux', 'noarch', true),
    target('linux', 'x86_64'),
    target('darwin', 'arm64', true),
    target('darwin', 'x86_64'),
    target('win32', 'x86_64', true),
    target('web', 'noarch', true),
];

const EXTENSIONS: TargetChoice[] = [
    { ...target('firefox', 'noarch'), available: false },
    target('firefox', 'noarch', true),
    { ...target('chromium', 'noarch'), available: false },
    target('chromium', 'noarch', true),
];

export default async () => {
    await describe('platform detection', async () => {
        await it('takes the OS from the platform hint, or the user agent', async () => {
            expect(detectOs({ platform: 'Windows' })).toBe('win32');
            expect(detectOs({ platform: 'macOS' })).toBe('darwin');
            expect(detectOs({ platform: 'Linux' })).toBe('linux');
            expect(detectOs({ platform: 'Chrome OS' })).toBe('linux');
            expect(detectOs({ userAgent: FIREFOX_LINUX })).toBe('linux');
            expect(detectOs({ userAgent: SAFARI_MAC })).toBe('darwin');
            expect(detectOs({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('win32');
            expect(detectOs({})).toBeUndefined();
        });

        await it('lets Android win over the Linux its user agent also claims', async () => {
            expect(detectOs({ userAgent: CHROME_ANDROID })).toBe('android');
            expect(detectOs({ platform: 'Android', userAgent: CHROME_ANDROID })).toBe('android');
        });

        await it('gives iOS and iPadOS the browser build, the only one that runs there', async () => {
            expect(detectOs({ userAgent: SAFARI_IPAD })).toBe('web');
            expect(detectOs({ platform: 'iOS' })).toBe('web');
        });

        await it('trusts the architecture only when it is reported', async () => {
            expect(detectArch({ architecture: 'arm', bitness: '64' })).toBe('arm64');
            expect(detectArch({ architecture: 'x86', bitness: '64' })).toBe('x86_64');
            expect(detectArch({ architecture: 'x86', bitness: '32' })).toBeUndefined();
            expect(detectArch({ architecture: 'ppc', bitness: '64' })).toBeUndefined();
            expect(detectArch({ userAgent: FIREFOX_LINUX })).toBe('x86_64');
            expect(detectArch({ userAgent: 'Mozilla/5.0 (Macintosh; ARM64 Mac OS X)' })).toBe('arm64');
            expect(detectArch({ userAgent: SAFARI_MAC })).toBeUndefined();
        });

        await it('assumes Safari on a Mac is Apple silicon', async () => {
            const platform = detectVisitorPlatform({ userAgent: SAFARI_MAC });
            expect(platform).toStrictEqual({ os: 'darwin', arch: 'arm64', browser: undefined, archAssumed: true });
            expect(recommendTarget(TARGETS, platform)?.arch).toBe('arm64');
        });

        await it('lets a reported architecture beat the assumption', async () => {
            const platform = detectVisitorPlatform({ platform: 'macOS', architecture: 'x86', bitness: '64' });
            expect(platform).toStrictEqual({ os: 'darwin', arch: 'x86_64', browser: undefined, archAssumed: false });
            expect(recommendTarget(TARGETS, platform)).toStrictEqual(target('darwin', 'x86_64'));
        });

        await it('prefers its own OS, then a fitting architecture', async () => {
            expect(recommendTarget(TARGETS, detectVisitorPlatform({ userAgent: FIREFOX_LINUX }))).toStrictEqual(
                target('linux', 'noarch', true),
            );
            expect(recommendTarget(TARGETS, detectVisitorPlatform({ platform: 'Windows' }))).toStrictEqual(
                target('win32', 'x86_64', true),
            );
            expect(recommendTarget(TARGETS, detectVisitorPlatform({ userAgent: SAFARI_IPAD }))).toStrictEqual(
                target('web', 'noarch', true),
            );
        });

        await it("leaves the server's choice alone with no target for this OS, or no OS at all", async () => {
            expect(recommendTarget(TARGETS, detectVisitorPlatform({ userAgent: CHROME_ANDROID }))).toBeUndefined();
            expect(recommendTarget(TARGETS, detectVisitorPlatform({}))).toBeUndefined();
        });

        await it('falls back to the OS recommendation for an architecture nobody ships', async () => {
            const only = [target('win32', 'arm64'), target('win32', 'x86_64', true)];
            expect(
                recommendTarget(only, { os: 'win32', arch: undefined, browser: undefined, archAssumed: true }),
            ).toStrictEqual(target('win32', 'x86_64', true));
        });

        await it('knows Firefox, a Chromium family member, or nothing', async () => {
            expect(detectBrowser({ userAgent: FIREFOX_LINUX })).toBe('firefox');
            expect(detectBrowser({ userAgent: CHROME_LINUX })).toBe('chromium');
            expect(detectBrowser({ userAgent: EDGE_WINDOWS })).toBe('chromium');
            expect(detectBrowser({ userAgent: '', brands: ['Not A;Brand', 'Chromium', 'Brave'] })).toBe('chromium');
            expect(detectBrowser({ userAgent: SAFARI_MAC })).toBeUndefined();
            expect(detectBrowser({})).toBeUndefined();
        });

        await it('matches a list of extensions by browser, never by OS, skipping what is unavailable', async () => {
            expect(recommendTarget(EXTENSIONS, detectVisitorPlatform({ userAgent: FIREFOX_LINUX }))).toBe(
                EXTENSIONS[1],
            );
            expect(recommendTarget(EXTENSIONS, detectVisitorPlatform({ userAgent: EDGE_WINDOWS }))).toBe(EXTENSIONS[3]);
            expect(recommendTarget(EXTENSIONS, detectVisitorPlatform({ userAgent: SAFARI_MAC }))).toBeUndefined();
        });

        await it('acts on a picked tab as if the visitor used that browser or OS', async () => {
            const safari = detectVisitorPlatform({ userAgent: SAFARI_MAC });
            expect(recommendTarget(EXTENSIONS, inGroup(safari, 'firefox'))).toBe(EXTENSIONS[1]);
            expect(recommendTarget(TARGETS, inGroup(safari, 'win32'))).toBe(TARGETS[4]);
        });
    });
};
