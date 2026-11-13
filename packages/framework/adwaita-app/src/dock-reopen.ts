// A Dock click on a windowless macOS app must activate the GApplication
// (ADR 0141). GTK 4.24.1's application delegate lacks the handler; the optional
// @gjsify/gtk-quartz-native bridge adds it. Absent bridge = old behaviour.
import { type GiImportsView, loadOptionalNativeModule } from '@gjsify/utils/core';

interface GjsifyQuartzModule {
    install_reopen_handler(): boolean;
}

/**
 * Install the Dock-click reopen handler on darwin.
 *
 * @param platform the OS to act on — a parameter so the spec can drive it
 * @param gi the `imports.gi` to load the bridge from — defaults to the host's
 * @returns whether this call installed the handler; `false` off darwin, without
 *   the bridge, or when GTK already implements it
 */
export function installDockReopen(platform: string = process.platform, gi?: GiImportsView): boolean {
    if (platform !== 'darwin') return false;
    const { module } = loadOptionalNativeModule<GjsifyQuartzModule>('GjsifyQuartz', ['install_reopen_handler'], gi);
    if (!module) return false;
    try {
        return module.install_reopen_handler();
    } catch {
        return false;
    }
}
