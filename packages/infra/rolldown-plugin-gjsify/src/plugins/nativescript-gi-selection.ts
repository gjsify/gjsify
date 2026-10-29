// SPDX-License-Identifier: MIT
// The ADR 0117 § 2 gate on the VITE path: every GI namespace the emitted bundle loads
// has to be one the APK was told to carry.
//
// WHY A SECOND PLACE AT ALL. `gjsify build --app nativescript` already checks this in
// `actions/build.ts`, but a NativeScript app is not built that way: the NS CLI drives
// Vite, so `defineNativescriptConfig` is the only thing in the loop. Without this the
// key is accepted by the config loader and acted on by nothing — the exact shape this
// repo keeps paying for, and on Android it is not advice: a `.deb` that under-declares
// its typelibs can still be fixed by installing a package, while an APK carries its
// whole GI stack or does without it.
//
// SAME ORACLE, SAME PLANNER, deliberately: {@link planGiSelection} over
// {@link scanGiNamespaces} of the emitted chunks, so the two paths cannot disagree
// about what a given config means. `generateBundle` rather than a `resolveId`
// observer, and that was MEASURED, not preferred:
//
//   with `giRenderer: true` (what every NS app here uses) the renderer plugin answers
//   `gi://Gtk` and `gi://Adw` with `@gjsify/adwaita-nativescript`'s namespaces, so those
//   specifiers are in the module graph of a build that needs NO Gtk typelib at all.
//   Feeding them to the planner would demand `giNamespaces: ["Gtk", "Adw"]`, which the
//   pinned sysroot cannot satisfy (no `cairo-1.0` / `freetype2-2.0` / `fontconfig-2.0`
//   typelib), i.e. it would refuse a build that works today.
//
// The emitted file is what gets installed, and it carries only what survived the
// renderer. That is the honest input.
//
// The scan is a LOWER BOUND, so only one direction is fatal — the asymmetry
// `gi-selection.ts` carries in full.

import type { Plugin } from 'rolldown';

import { scanGiNamespaces } from '../utils/gi-namespaces.js';
import { assertGiNamespaceEntries, planGiSelection } from '../utils/gi-selection.js';

export const NATIVESCRIPT_GI_SELECTION_PLUGIN = 'gjsify-nativescript-gi-selection';

export interface NativescriptGiSelectionOptions {
    /** `giNamespaces` as the app declares it, `Ns` or `Ns-Version`. */
    declared: readonly string[];
}

/**
 * Refuse a NativeScript bundle that imports a GI namespace the APK was not told to
 * carry, and warn about one it was told to carry and does not appear to import.
 */
export function nativescriptGiSelectionPlugin(options: NativescriptGiSelectionOptions): Plugin {
    // Checked when the plugin is composed, not when the bundle is written: a typo
    // should fail before a full NativeScript build, and this is the Vite path's only
    // reader of the key.
    assertGiNamespaceEntries(options.declared, `${NATIVESCRIPT_GI_SELECTION_PLUGIN}: giNamespaces`);

    return {
        name: NATIVESCRIPT_GI_SELECTION_PLUGIN,
        generateBundle(_outputOptions, bundle) {
            // Namespace → the chunk it was first read from, so a refusal names a file
            // somebody can open. `planGiSelection` is pure and knows neither.
            const origin = new Map<string, string>();
            for (const [fileName, item] of Object.entries(bundle)) {
                if ((item as { type?: string }).type !== 'chunk') continue;
                const code = (item as { code?: string }).code;
                if (typeof code !== 'string' || code.length === 0) continue;
                for (const namespace of scanGiNamespaces(code)) {
                    if (!origin.has(namespace)) origin.set(namespace, fileName);
                }
            }

            let selection;
            try {
                selection = planGiSelection({ declared: [...options.declared], scanned: [...origin.keys()] });
            } catch (error) {
                const files = [...new Set(origin.values())].sort().join(', ');
                throw new Error(
                    `${NATIVESCRIPT_GI_SELECTION_PLUGIN}: ${(error as Error).message} (read from ${files})`,
                );
            }
            for (const namespace of selection.unscanned) {
                this.warn(
                    `${NATIVESCRIPT_GI_SELECTION_PLUGIN}: giNamespaces declares ${namespace}, which the bundle ` +
                        'does not appear to import. The APK carries it anyway — drop it if nothing needs it, ' +
                        'since every selected namespace costs APK size.',
                );
            }
        },
    };
}
