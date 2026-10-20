// The GLib timers door of adwaita-web, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `glib-timers.gjs.spec.ts`). The door is the namespace module itself, so a member
// that stops being exported fails here.

import {
    GLIB_LANGUAGE_TAG_VECTORS,
    GLIB_PATH_VECTORS,
    GLIB_TIMER_VECTORS,
    GLIB_UNICHAR_VECTORS,
    GLIB_URI_VECTORS,
    GLIB_VARIANT_VECTORS,
    driveGLibLanguageTagVectors,
    driveGLibPathVectors,
    driveGLibTimerVectors,
    driveGLibUnicharVectors,
    driveGLibUriVectors,
    driveGLibVariantVectors,
    type GLibLanguageLike,
    type GLibPathsLike,
    type GLibTimersLike,
    type GLibUnicharLike,
    type GLibUriLike,
    type GLibVariantLike,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as GLib from './namespace/glib.js';

export const GLibTest = async () => {
    await driveGLibTimerVectors(
        {
            name: 'adwaita-web',
            isOracle: false,
            GLib: GLib as unknown as GLibTimersLike,
            settle: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
            quiet: async (body) => {
                const original = console.error;
                console.error = () => {};
                try {
                    await body();
                } finally {
                    console.error = original;
                }
            },
        },
        { describe, it, expect },
    );
    await driveGLibPathVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibPathsLike },
        { describe, it, expect },
        GLIB_PATH_VECTORS,
    );
    await driveGLibUriVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibUriLike },
        { describe, it, expect },
        GLIB_URI_VECTORS,
    );
    await driveGLibVariantVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibVariantLike },
        { describe, it, expect },
        GLIB_VARIANT_VECTORS,
    );
    await driveGLibUnicharVectors(
        { name: 'adwaita-web', isOracle: false, GLib: GLib as unknown as GLibUnicharLike },
        { describe, it, expect },
        GLIB_UNICHAR_VECTORS,
    );
    await driveGLibLanguageTagVectors(
        {
            name: 'adwaita-web',
            isOracle: false,
            GLib: GLib as unknown as GLibLanguageLike,
            withTags: (tags, read) => {
                const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
                Object.defineProperty(globalThis, 'navigator', {
                    value: { languages: tags, language: tags[0] },
                    configurable: true,
                });
                try {
                    return read();
                } finally {
                    if (original) Object.defineProperty(globalThis, 'navigator', original);
                    else delete (globalThis as { navigator?: unknown }).navigator;
                }
            },
        },
        { describe, it, expect },
        GLIB_LANGUAGE_TAG_VECTORS,
    );
    await describe('adwaita-web: GLib door', async () => {
        await it('answers the host-bound path questions with the root and no data dirs', () => {
            expect(GLib.get_current_dir()).toBe('/');
            expect(GLib.get_system_data_dirs().length).toBe(0);
        });
        await it('answers C alone where the host names no language', () => {
            const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
            Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
            try {
                expect(GLib.get_language_names().join(',')).toBe('C');
            } finally {
                if (original) Object.defineProperty(globalThis, 'navigator', original);
            }
        });
        await it('falls back to navigator.language when languages is empty', () => {
            const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
            Object.defineProperty(globalThis, 'navigator', {
                value: { languages: [], language: 'fr-CA' },
                configurable: true,
            });
            try {
                expect(GLib.get_language_names().join(',')).toBe('fr_CA,fr,C');
            } finally {
                if (original) Object.defineProperty(globalThis, 'navigator', original);
            }
        });
        await it('has a vector row for every vector', () => {
            expect(GLIB_TIMER_VECTORS.length > 0 && GLIB_PATH_VECTORS.length > 0).toBe(true);
        });
    });
};
