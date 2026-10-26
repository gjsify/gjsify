import { resolve } from 'node:path';

import { loadAppEntries, type RelatedAppsOptions } from './related.js';
import { loadResume, type Resume } from './resume.js';
import type { DeveloperSiteConfig, RelatedApp } from './types.js';

/** Everything a developer site renders that does not come from the blog. */
export interface DeveloperData {
    config: DeveloperSiteConfig;
    /** One résumé per configured language. */
    resumes: Record<string, Resume>;
    /** `developer.apps`, resolved; an app that cannot be had is left out with a warning. */
    apps: RelatedApp[];
}

export interface LoadDeveloperOptions extends Omit<RelatedAppsOptions, 'warn'> {
    root: string;
    warn?: (message: string) => void;
}

export async function loadDeveloperData(
    config: DeveloperSiteConfig,
    options: LoadDeveloperOptions,
): Promise<DeveloperData> {
    const entries = await Promise.all(
        config.languages.map(
            async (lang) => [lang, await loadResume(resolve(options.root, config.developer.resume[lang]!))] as const,
        ),
    );
    const apps = await loadAppEntries(config.developer.apps, {
        offline: options.offline,
        network: options.network,
        warn: options.warn ?? (() => {}),
    });
    return { config, resumes: Object.fromEntries(entries), apps };
}
