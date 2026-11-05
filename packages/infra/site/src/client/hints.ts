import type { PlatformHints } from './platform.js';

/** The parts of `navigator.userAgentData` this page uses; it is absent outside Chromium. */
interface UserAgentData {
    platform?: string;
    brands?: Array<{ brand: string }>;
    getHighEntropyValues?(hints: string[]): Promise<{ architecture?: string; bitness?: string }>;
}

export async function readHints(): Promise<PlatformHints> {
    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
    const hints: PlatformHints = {
        platform: data?.platform,
        userAgent: navigator.userAgent,
        brands: data?.brands?.map((entry) => entry.brand),
    };
    if (data?.getHighEntropyValues) {
        try {
            const high = await data.getHighEntropyValues(['architecture', 'bitness']);
            hints.architecture = high.architecture;
            hints.bitness = high.bitness;
        } catch {
            // The browser may refuse; `detectVisitorPlatform` then falls back to an assumed architecture.
        }
    }
    return hints;
}
