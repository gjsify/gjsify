// SPDX-License-Identifier: MIT
// @gjsify/node-gi/load-diagnostics — what a user is told when the addon FILE is
// present and still will not load.
//
// A MODULE OF ITS OWN, and that is the point: `index.js` loads the native addon
// at evaluation time, so anything living there can only be imported by a process
// that already succeeded at the thing being diagnosed. The message has to be
// reachable — and testable — without a working addon.
//
// Pure over its inputs (platform, decided GTK source, target are parameters), so
// the Windows and macOS wording is assertable from a Linux host. Neither has ever
// been printed by a job in this repository.
import { hostTarget } from './native-paths.js';
import { gtkSource } from './gtk-runtime.js';

/**
 * Turn a failed addon load into something the reader can act on.
 *
 * PURE over its inputs (platform + the decided GTK source are parameters) so all
 * three platforms' wording is assertable from any host — the Windows message in
 * particular is the one no CI job on this project has ever printed.
 *
 * @param {string} addonPath the .node that failed to load
 * @param {unknown} err the original loader error
 * @param {object} [ctx]
 * @param {NodeJS.Platform | string} [ctx.platform]
 * @param {'bundle' | 'system' | 'none'} [ctx.source] which GTK the policy picked
 * @param {string} [ctx.target] the `<os>-<arch>` tag
 * @returns {string}
 */
export function describeAddonLoadFailure(addonPath, err, ctx = {}) {
    const platform = ctx.platform ?? process.platform;
    const source = ctx.source ?? gtkSource();
    const target = ctx.target ?? hostTarget();
    const reason = err instanceof Error ? err.message : String(err);

    const lines = [
        `@gjsify/node-gi: the native addon exists but could not be loaded.`,
        `  addon: ${addonPath}`,
        `  cause: ${reason}`,
        '',
    ];

    if (platform === 'win32' || platform === 'darwin') {
        const libs = platform === 'win32' ? 'DLLs' : 'dylibs';
        lines.push(
            `The file is present, so this is almost always its GTK/GObject-Introspection`,
            `dependency closure (glib, gobject, gio, girepository, …) not being found —`,
            `not the addon itself. GTK source selected for this process: ${source}.`,
            '',
        );
        if (source !== 'bundle') {
            lines.push(
                `Install the batteries-included runtime, which ships those ${libs}:`,
                `  npm install @gjsify/gtk-runtime-${target}`,
                `or point GJSIFY_GTK_RUNTIME at an existing bundle directory.`,
                '',
            );
        } else {
            lines.push(
                `A bundle WAS selected, so it is likely incomplete for this target.`,
                `Reinstall @gjsify/gtk-runtime-${target}, or set GJSIFY_GTK_PREFER=system`,
                `to use the host's own GTK instead.`,
                '',
            );
        }
        if (platform === 'win32') {
            lines.push(
                `Also required on Windows and easy to miss: the Visual C++ redistributable`,
                `(vcruntime140.dll / vcruntime140_1.dll / msvcp140.dll). \`gjsify system-check\``,
                `reports whether it is present.`,
            );
        }
    } else {
        lines.push(
            `Install your distribution's GTK4 + GObject-Introspection runtime`,
            `(e.g. \`dnf install gtk4 gobject-introspection\`). \`gjsify system-check\``,
            `lists what is missing.`,
        );
    }

    return lines.join('\n');
}
