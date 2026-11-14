// A Dock click on a windowless macOS app must activate the GApplication
// (ADR 0141). GTK 4.24.1's application delegate lacks the handler; the optional
// @gjsify/gtk-quartz-native bridge adds it. Absent bridge = old behaviour.
import { type GiImportsView, loadOptionalNativeModule } from '@gjsify/utils/core';

interface GjsifyQuartzModule {
    install_reopen_handler(): boolean;
}

/** How a Node host hands out a CommonJS module — `createRequire(import.meta.url)`. */
export type NodeRequire = (id: string) => unknown;

/**
 * An `imports.gi` look-alike for a Node host (ADR 0141 § Node hosts), or `undefined`
 * when there is no node-gi to ask.
 *
 * `imports.gi` exists on GJS only; on Node the namespaces come from
 * `@gjsify/node-gi/gi`, which the bundler keeps external and which therefore
 * resolves from the bundle's own location — the same lookup the `gi://` shims
 * make. Resolved eagerly and inside a `try`, like the `&optional` node shim
 * (ADR 0087): an absent typelib must read as "no bridge", not throw.
 *
 * @param require the module loader to reach node-gi through; a parameter so the
 *   spec can drive it without a node-gi
 */
export function nodeHostGi(require?: NodeRequire): GiImportsView | undefined {
    try {
        const load =
            require ??
            (
                process.getBuiltinModule?.('node:module') as { createRequire(url: string): NodeRequire } | undefined
            )?.createRequire(import.meta.url);
        const requireGi = (load?.('@gjsify/node-gi/gi') as { requireGi?: (ns: string, v?: string) => unknown })
            ?.requireGi;
        if (typeof requireGi !== 'function') return undefined;
        return { GjsifyQuartz: requireGi('GjsifyQuartz', '1.0') } as unknown as GiImportsView;
    } catch {
        return undefined;
    }
}

/**
 * Install the Dock-click reopen handler on darwin.
 *
 * @param platform the OS to act on — a parameter so the spec can drive it
 * @param gi the `imports.gi` to load the bridge from — defaults to the host's:
 *   GJS's `imports.gi`, or node-gi on a Node host
 * @returns whether this call installed the handler; `false` off darwin, without
 *   the bridge, or when GTK already implements it
 */
export function installDockReopen(platform: string = process.platform, gi?: GiImportsView): boolean {
    if (platform !== 'darwin') return false;
    const host = gi ?? (globalThis as { imports?: { gi?: GiImportsView } }).imports?.gi ?? nodeHostGi();
    if (!host) return false;
    const { module } = loadOptionalNativeModule<GjsifyQuartzModule>('GjsifyQuartz', ['install_reopen_handler'], host);
    if (!module) return false;
    try {
        return module.install_reopen_handler();
    } catch {
        return false;
    }
}
