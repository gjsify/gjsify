// THE ORACLE: the GLIB_LANGUAGE_VECTORS run against real `gi://GLib`, fed as `LANGUAGE=a:b:c`. A vector
// that fails here is a wrong vector; fix the vector. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveGLibLanguageVectors, type GLibLanguageLike } from './conformance/glib-language.js';

interface GLibEnvLike extends GLibLanguageLike {
    getenv(name: string): string | null;
    setenv(name: string, value: string, overwrite: boolean): boolean;
    unsetenv(name: string): void;
}

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibEnvLike;
        await driveGLibLanguageVectors(
            {
                name: 'GJS (real GLib)',
                isOracle: true,
                GLib,
                withLocales: (locales, read) => {
                    const before = GLib.getenv('LANGUAGE');
                    GLib.setenv('LANGUAGE', locales.join(':'), true);
                    try {
                        return read();
                    } finally {
                        if (before === null) GLib.unsetenv('LANGUAGE');
                        else GLib.setenv('LANGUAGE', before, true);
                    }
                },
            },
            { describe, it, expect },
        );
    });
};
