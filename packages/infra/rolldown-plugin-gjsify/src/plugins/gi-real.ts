// SPDX-License-Identifier: MIT
// For `--app nativescript`: answer `gi://Ns` with the REAL namespace from `@gjsify/node-gi`
// instead of the widget renderer's subset arm (`gi-renderer.ts`).
//
// WHY. The renderer arm is deliberately sparse (ADR 0034 clause 3): `Gio` and `GLib` there are
// the subset a widget port needs (`Gio.File`, `Gio.Settings`, main-loop sources) and nothing
// else, so non-widget code on real GObject (ADR 0110 — a Gio TLS socket client, `GLib.get_home_dir`)
// reads `undefined` or is refused by name. The arm stays the default, because an app that never
// asked for more must not bundle `@gjsify/node-gi`; this plugin is how an app asks.
//
// ORDER. Composed AHEAD of `giRendererPlugin`, so a listed namespace never reaches it. The emitted
// module imports `@gjsify/node-gi/gi` as an ordinary dependency of the app (ADR 0117: the addon is
// bundled with the APK, never inlined), and evaluates `requireGi` eagerly — an app that lists a
// namespace uses it.

import type { Plugin } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from '../utils/virtual-module-id.js';
import { parseGiSpecifier } from './gjs-gi-node.js';

const GI_REAL_VIRTUAL_PREFIX = `${GJSIFY_VIRTUAL_PREFIX}gi-real:`;

export const GI_REAL_PLUGIN = 'gjsify-gi-real';

export interface GiRealOptions {
    /**
     * Namespaces answered by real GI, as `Ns` or `Ns-Version`. A version here is the default for
     * an import that names none; an import that names one keeps it.
     */
    namespaces: readonly string[];
}

/** The module source for one real namespace. */
export function giRealShimSource(namespace: string, version?: string): string {
    const versionArg = version ? `, ${JSON.stringify(version)}` : '';
    return (
        `import requireGi from '@gjsify/node-gi/gi';\n` +
        `export default requireGi(${JSON.stringify(namespace)}${versionArg});\n`
    );
}

export function giRealPlugin(options: GiRealOptions): Plugin {
    const defaults = new Map<string, string | undefined>();
    for (const entry of options.namespaces) {
        const dash = entry.indexOf('-');
        if (dash === -1) defaults.set(entry, undefined);
        else defaults.set(entry.slice(0, dash), entry.slice(dash + 1));
    }
    return {
        name: GI_REAL_PLUGIN,
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^gi:\/\// },
            handler(source) {
                const parsed = parseGiSpecifier(source);
                if (parsed === null || !defaults.has(parsed.namespace)) return null;
                const version = parsed.version ?? defaults.get(parsed.namespace) ?? '';
                return { id: `${GI_REAL_VIRTUAL_PREFIX}${parsed.namespace}:${version}` };
            },
        },
        load(id) {
            if (!id.startsWith(GI_REAL_VIRTUAL_PREFIX)) return null;
            const [namespace, version] = id.slice(GI_REAL_VIRTUAL_PREFIX.length).split(':');
            return { code: giRealShimSource(namespace, version || undefined), moduleSideEffects: false };
        },
    };
}
