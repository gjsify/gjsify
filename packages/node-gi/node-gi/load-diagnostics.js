// SPDX-License-Identifier: MIT
// @gjsify/node-gi/load-diagnostics — what a user is told when the addon FILE is
// present and still will not load. TWO causes reach the same catch and they get
// DIFFERENT answers: the loader could not resolve the specifier, or it resolved
// it and the OS refused the binary. Only the second is about GTK.
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
 * Did the loader fail to RESOLVE the specifier, rather than to load the binary?
 *
 * Two entirely different failures arrive at the same `catch`, and only one of
 * them is about GTK:
 *
 *   • dlopen/LoadLibrary said no — the file was found, and its dependency
 *     closure (or its ABI) is the problem. That is the case the long GTK
 *     explanation below describes.
 *   • `require()` never got as far as the file. The specifier was neither
 *     absolute nor `./`-led, so it was looked up as a MODULE — against this
 *     package's directory and node_modules, never against the process's cwd that
 *     the `existsSync()` one line earlier had just resolved it against.
 *
 * THE INCIDENT (#996 / PR #1239), and why this discriminator exists at all:
 * node-gi.yml hands the GTK bundle builder a repo-relative `--stage`, the builder
 * passed that straight through as `NODE_GI_NATIVE`, and all four darwin bundle
 * legs failed with `Cannot find module 'packages/node-gi/…'` underneath a
 * confident five-line account of the Homebrew dependency closure ending in
 * "Reinstall @gjsify/gtk-runtime-darwin-arm64". Every word of that advice was
 * wrong for the cause, and it is the advice a stranger would have followed. The
 * path bug itself is fixed in `native-paths.js#nativeCandidates()`; this stays
 * because the next relative path to reach a `require()` will not come from there.
 * @param {unknown} err
 * @returns {boolean}
 */
function isResolutionFailure(err) {
    if (!err || typeof err !== 'object') return false;
    const { code, message } = /** @type {{ code?: unknown, message?: unknown }} */ (err);
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') return true;
    // Bun, Deno and the GJS napi shim raise the same condition without Node's
    // code, so the message is a fallback rather than the primary test.
    return typeof message === 'string' && /cannot find module|module not found/i.test(message);
}

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

    // A resolution failure gets no GTK answer. Returning early is what keeps the
    // dependency-closure explanation for the case it actually describes — see
    // isResolutionFailure() for what it cost when the two shared one message.
    if (isResolutionFailure(err)) {
        return [
            `@gjsify/node-gi: the native addon path could not be RESOLVED.`,
            `  addon: ${addonPath}`,
            `  cause: ${reason}`,
            '',
            `This is a module-RESOLUTION failure, NOT a missing GTK dependency: the`,
            `loader never reached the file, so nothing here is evidence about glib,`,
            `gobject, girepository or a runtime bundle. A path that is neither absolute`,
            `nor written with a leading ./ is resolved by require() as a MODULE`,
            `specifier — against @gjsify/node-gi's own directory and node_modules,`,
            `never against the working directory of the process that set it.`,
            '',
            `Pass an ABSOLUTE path:`,
            `  NODE_GI_NATIVE=/absolute/path/to/node_gi.node`,
        ].join('\n');
    }

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
