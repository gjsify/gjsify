// The post-install / post-remove work, and the two very different envelopes it
// travels in.
//
// The BODY is shared — refresh the desktop database, the icon cache and the
// compiled GSettings schemas, because those are system-wide caches our files
// changed. The GUARD is not, and assuming it was is the bug this file exists to
// prevent: dpkg passes `configure` / `remove` as `$1`, rpm passes the NUMBER of
// instances that will remain (1 on install, 0 on final erase). A dpkg-shaped
// `[ "$1" = "configure" ]` inside an rpm scriptlet is never true, so the
// package installs, the scriptlet runs, and nothing happens. Measured by
// reading `rpm -qp --scripts` on the first artifact this packer produced —
// which is exactly the class of defect a rendered-output assertion would have
// waved through.

import type { ShipSettings } from './types.js';

/**
 * The cache refreshes this payload makes necessary, each guarded by the tool's
 * presence and `|| true`.
 *
 * The caches belong to the distribution, not to us: on removal the helper may
 * already be gone, and a maintainer script that fails during a purge leaves a
 * package the user cannot uninstall.
 */
export function cacheRefreshCommands(settings: ShipSettings, prefix: string): string[] {
    const refreshes: Array<{ probe: string; run: string }> = [];
    if (settings.kind === 'app') {
        refreshes.push({
            probe: 'update-desktop-database',
            run: `update-desktop-database -q ${prefix}/share/applications`,
        });
    }
    if (settings.iconFiles.length > 0) {
        refreshes.push({
            probe: 'gtk-update-icon-cache',
            run: `gtk-update-icon-cache -q -t -f ${prefix}/share/icons/hicolor`,
        });
    }
    if (settings.mimeTypes.length > 0) {
        // Without this the document is installed and the type still does not exist: detection runs
        // off the compiled cache in `share/mime/`, not off the packages directory.
        refreshes.push({
            probe: 'update-mime-database',
            run: `update-mime-database ${prefix}/share/mime`,
        });
    }
    if (settings.schemaFiles.length > 0) {
        refreshes.push({
            probe: 'glib-compile-schemas',
            run: `glib-compile-schemas ${prefix}/share/glib-2.0/schemas`,
        });
    }
    return refreshes.map(({ probe, run }) => `if command -v ${probe} >/dev/null 2>&1; then ${run} || true; fi`);
}

/**
 * dpkg maintainer scripts, keyed by their `control.tar` filename.
 *
 * `postrm` guards on `remove` alone: dpkg also calls it for `purge`, `upgrade`
 * and several abort paths, and on an upgrade the incoming package's `postinst`
 * refreshes the caches anyway.
 */
export function renderDebScripts(settings: ShipSettings, prefix: string): Record<string, string> {
    const commands = cacheRefreshCommands(settings, prefix);
    if (commands.length === 0) return {};
    const body = commands.map((line) => `    ${line}`).join('\n');
    return {
        postinst: ['#!/bin/sh', 'set -e', 'if [ "$1" = "configure" ]; then', body, 'fi', ''].join('\n'),
        postrm: ['#!/bin/sh', 'set -e', 'if [ "$1" = "remove" ]; then', body, 'fi', ''].join('\n'),
    };
}

/**
 * rpm scriptlets, for the `POSTIN` / `POSTUN` header tags.
 *
 * No action guard: rpm's `$1` is a COUNT, and both the install and the upgrade
 * case want the refresh. `%postun` runs it unconditionally too — on an upgrade
 * the incoming package's `%post` has already run, so a second refresh is wasted
 * work rather than a wrong result, where guarding on `[ $1 -eq 0 ]` would be
 * one more place to get the convention backwards.
 */
export function renderRpmScriptlets(settings: ShipSettings, prefix: string): { post?: string; postun?: string } {
    const commands = cacheRefreshCommands(settings, prefix);
    if (commands.length === 0) return {};
    const body = `${commands.join('\n')}\n`;
    return { post: body, postun: body };
}
