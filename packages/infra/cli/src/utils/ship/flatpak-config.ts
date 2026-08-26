// The deprecation window on the `gjsify.flatpak` build keys (ADR 0024 § 8).
//
// § 8 names the cost of the migration and does not let it be skipped:
// "`gjsify.flatpak` is a published config contract, so the keys move with a
// deprecation window in which both spellings resolve and the old one warns."
// This file is that window.
//
// WHAT MOVED and what did not — the table is `docs/ship-formats.md`, and the
// short form is: the six BUILD keys moved and warn from the old spelling; the
// `AppMetadata` half is a designed ALIAS and is NOT deprecated (both blocks
// describe the same app, and warning on it would print for every project that
// has a `gjsify.flatpak` block at all); and the TOOLCHAIN keys are untouched
// because `gjsify flatpak <sub>` has not moved, so deprecating them would warn
// on commands with nowhere else to read from.
//
// WHY A NAMED VERSION, IN ONE PLACE. The precedent is
// `utils/normalize-bundler-options.ts`, the `esbuild` → `bundler` shim, and it
// also carries the precedent's DEFECT: its warning text names 0.5.0, the tree is
// far past it, and its header now has to say "removing the shim means fixing
// that string too". So the version here is a constant the message reads, and the
// spec asserts the message names it.

import type { ConfigDataFlatpak, ConfigDataShip } from '../../types/config-data.js';
import {
    DEFAULT_CLI_FINISH_ARGS,
    DEFAULT_GUI_FINISH_ARGS,
    deriveAppendPath,
    resolveRuntime,
} from '../flatpak-runtime.js';
import type { ShipFlatpakSettings } from './types.js';

/**
 * The release that stops reading `gjsify.flatpak` for the keys below.
 *
 * A major, not the next minor: the block is in published releases and in
 * downstream `package.json`s that this repository does not control, and a
 * window measured in weeks is a window nobody notices before it closes.
 */
export const LEGACY_FLATPAK_KEYS_REMOVED_IN = '1.0.0';

/** The keys whose new home is `gjsify.ship.flatpak`, in the order the warning lists them. */
export const MIGRATED_FLATPAK_KEYS = [
    'runtime',
    'runtimeVersion',
    'sdkExtensions',
    'appendPath',
    'finishArgs',
    'cleanup',
] as const;

export type MigratedFlatpakKey = (typeof MIGRATED_FLATPAK_KEYS)[number];

/** The branch a `ship` Flatpak is exported under when the project names none. */
export const DEFAULT_SHIP_FLATPAK_BRANCH = 'stable';

export interface ShipFlatpakInput {
    ship: ConfigDataShip;
    flatpak: ConfigDataFlatpak;
    /** Decides the finish-args default: a GUI app needs a display, a CLI does not. */
    kind: 'app' | 'cli';
}

export interface ResolvedShipFlatpak {
    settings: ShipFlatpakSettings;
    warnings: string[];
}

/**
 * Resolve the Flatpak half of `gjsify.ship`, reading the legacy block where the
 * new one is silent.
 *
 * Per-KEY fallback, not whole-block: a project migrating one key at a time must
 * not lose the five it has not moved yet. That is also what makes the warning
 * actionable — it names the keys still coming from the old block, so the reader
 * knows what to edit rather than being told a block is deprecated.
 */
export function resolveShipFlatpakSettings(input: ShipFlatpakInput): ResolvedShipFlatpak {
    const shipFlatpak = input.ship.flatpak ?? {};
    const legacy = input.flatpak;
    const fromLegacy: MigratedFlatpakKey[] = [];

    /** `gjsify.ship.flatpak.<key>` when set, else `gjsify.flatpak.<key>`, noting which. */
    function pick<K extends MigratedFlatpakKey>(key: K): ConfigDataFlatpak[K] {
        const preferred = shipFlatpak[key];
        if (preferred !== undefined) return preferred;
        const inherited = legacy[key];
        if (inherited !== undefined) fromLegacy.push(key);
        return inherited;
    }

    // Resolved in `pick` order so `fromLegacy` reads in the order
    // `MIGRATED_FLATPAK_KEYS` declares — a warning whose key order depends on
    // evaluation order is a warning whose text is not testable.
    const runtime = pick('runtime');
    const runtimeVersion = pick('runtimeVersion');
    const sdkExtensions = pick('sdkExtensions');
    const appendPath = pick('appendPath');
    const finishArgs = pick('finishArgs');
    const cleanup = pick('cleanup');

    const resolved = resolveRuntime({ runtime, runtimeVersion }, {});
    const extensions = sdkExtensions ?? [];

    const settings: ShipFlatpakSettings = {
        runtime: resolved.runtimeId,
        runtimeVersion: resolved.runtimeVersion,
        sdk: resolved.sdk,
        branch: shipFlatpak.branch ?? DEFAULT_SHIP_FLATPAK_BRANCH,
        sdkExtensions: [...extensions],
        // Derived from the extensions when nothing was declared, and only then:
        // an extension whose `/usr/lib/sdk/<x>/bin` is not on PATH inside the
        // sandbox is an extension the build cannot use, which looks like the
        // extension not being installed.
        appendPath: appendPath ?? (extensions.length > 0 ? deriveAppendPath(extensions) : []),
        finishArgs: finishArgs ?? (input.kind === 'cli' ? DEFAULT_CLI_FINISH_ARGS : DEFAULT_GUI_FINISH_ARGS),
        cleanup: cleanup ?? [],
    };

    return { settings, warnings: fromLegacy.length === 0 ? [] : [deprecationWarning(fromLegacy)] };
}

/** One line, naming every key still read from the old block and where each goes. */
function deprecationWarning(keys: readonly MigratedFlatpakKey[]): string {
    const list = keys.map((key) => `gjsify.flatpak.${key}`).join(', ');
    const moved = keys.map((key) => `gjsify.ship.flatpak.${key}`).join(', ');
    return (
        `DEPRECATION: ${list} ${keys.length > 1 ? 'are' : 'is'} read by \`gjsify ship\` for compatibility and ` +
        `will be removed in ${LEGACY_FLATPAK_KEYS_REMOVED_IN}. Move ${keys.length > 1 ? 'them' : 'it'} to ` +
        `${moved} — both spellings resolve until then, and \`gjsify.ship.flatpak\` wins where both are set. ` +
        'The app METADATA in `gjsify.flatpak` (name, summary, developer, categories, licence) is NOT ' +
        'deprecated: both blocks describe the same application and either may carry it (ADR 0024 § 8).'
    );
}
