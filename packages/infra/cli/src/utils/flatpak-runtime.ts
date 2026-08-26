// Which runtime a Flatpak is built against, and what the finished app may do.
//
// Lifted out of `commands/flatpak/` when `gjsify ship --target flatpak` became
// the second caller (ADR 0024 § 8). Same move, same reason, as
// `utils/app-metadata.ts`: these are facts about the APP, not about whichever
// command happens to render them, and the second copy is the one that drifts —
// a `DEFAULT_GNOME_RUNTIME_VERSION` bumped in one place and not the other
// produces a `ship` Flatpak and a `flatpak init` Flatpak targeting different
// GNOME releases from the same `package.json`.

/**
 * Default GNOME-Platform runtime version. Bumped per release window.
 * GNOME 50 = April 2026 stable; tracked in
 * https://docs.flathub.org/docs/for-app-authors/requirements.
 */
export const DEFAULT_GNOME_RUNTIME_VERSION = '50';

/** Default Freedesktop-Platform runtime version (LTS-ish). */
export const DEFAULT_FREEDESKTOP_RUNTIME_VERSION = '24.08';

/** Permissive GUI defaults for GTK4 + Adwaita apps. */
export const DEFAULT_GUI_FINISH_ARGS = ['--device=dri', '--share=ipc', '--socket=fallback-x11', '--socket=wayland'];

/** Lean defaults for headless CLI tools — no display, no GPU. */
export const DEFAULT_CLI_FINISH_ARGS: string[] = [];

/**
 * The runtime keys, structurally — not `ConfigDataFlatpak`.
 *
 * Two config blocks answer this question now (`gjsify.flatpak` and
 * `gjsify.ship.flatpak`, § the deprecation window in `utils/ship/flatpak-config.ts`),
 * and a resolver typed to one of them would have to be duplicated for the other.
 */
export interface RuntimeSelection {
    runtime?: string;
    runtimeVersion?: string;
}

export interface ResolvedRuntime {
    runtime: 'gnome' | 'freedesktop';
    runtimeId: string;
    sdk: string;
    runtimeVersion: string;
}

/**
 * Pick the runtime + sdk + version triple from config + CLI overrides.
 * `--runtime` and `--runtime-version` flags win over config values.
 */
export function resolveRuntime(config: RuntimeSelection | undefined, overrides: RuntimeSelection): ResolvedRuntime {
    const runtime = (overrides.runtime ?? config?.runtime ?? 'gnome') as 'gnome' | 'freedesktop';
    if (runtime !== 'gnome' && runtime !== 'freedesktop') {
        throw new Error(`gjsify flatpak: unknown runtime "${runtime}" (expected "gnome" or "freedesktop")`);
    }
    const runtimeVersion =
        overrides.runtimeVersion ??
        config?.runtimeVersion ??
        (runtime === 'gnome' ? DEFAULT_GNOME_RUNTIME_VERSION : DEFAULT_FREEDESKTOP_RUNTIME_VERSION);

    if (runtime === 'gnome') {
        return { runtime, runtimeId: 'org.gnome.Platform', sdk: 'org.gnome.Sdk', runtimeVersion };
    }
    return { runtime, runtimeId: 'org.freedesktop.Platform', sdk: 'org.freedesktop.Sdk', runtimeVersion };
}

/**
 * `append-path` for the build sandbox, derived from the declared SDK extensions.
 *
 * `/app/bin` is appended last so a build command finds the app's own binaries
 * without knowing where they landed.
 */
export function deriveAppendPath(sdkExtensions: readonly string[]): string[] {
    const out: string[] = [];
    for (const ext of sdkExtensions) {
        const m = /^org\.freedesktop\.Sdk\.Extension\.([A-Za-z0-9-]+)$/.exec(ext);
        if (m) out.push(`/usr/lib/sdk/${m[1]}/bin`);
    }
    out.push('/app/bin');
    return out;
}
