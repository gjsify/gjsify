// @gjsify/adwaita-app — env-driven dev hooks.
// The `BH_APP_*` / `ER_APP_*` pattern both studio apps grew independently:
// point the app at a start view/file and toggle a debug log from the
// environment. Pure logic (no @girs): unit-tested on Node + GJS.

/** Resolved dev-hook values. */
export interface AppDevHooks {
    /** `${PREFIX}_VIEW` — open straight to this view id on startup. */
    view?: string;
    /** `${PREFIX}_FILE` — auto-load this file/document on startup. */
    file?: string;
    /** `${PREFIX}_DEBUG` — emit verbose load logging. */
    debug: boolean;
}

/** Options for {@link readAppDevHooks}. */
export interface ReadAppDevHooksOptions {
    /** Env-var prefix without a trailing underscore, e.g. `BH_APP` or `ER_APP`. */
    prefix: string;
    /** Env map to read from. Defaults to `globalThis.process?.env`. */
    env?: Record<string, string | undefined>;
}

/** An env value counts as false when unset, empty, `0`, `false`, or `no`. */
function isTruthy(value: string | undefined): boolean {
    if (value == null || value === '') return false;
    const normalized = value.toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'no';
}

/**
 * Read the `${prefix}_VIEW` / `${prefix}_FILE` / `${prefix}_DEBUG` dev hooks.
 * Empty-string values are treated as unset.
 */
export function readAppDevHooks(options: ReadAppDevHooksOptions): AppDevHooks {
    const env = options.env ?? globalThis.process?.env ?? {};
    const prefix = options.prefix;
    return {
        view: env[`${prefix}_VIEW`] || undefined,
        file: env[`${prefix}_FILE`] || undefined,
        debug: isTruthy(env[`${prefix}_DEBUG`]),
    };
}
