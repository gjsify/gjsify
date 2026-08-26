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
// A WINDOW HAS TWO SIDES, and the first cut only built one. The six build keys
// are read by `gjsify flatpak init` and `flatpak ci` as well, and those
// commands have NOT moved — so a project that did what this file's warning told
// it to do, and moved them, silently lost them there: `flatpak init` fell back
// to its own defaults and wrote a manifest against a different
// `org.gnome.Platform` version with different finish-args, committed, at exit 0.
// That is why {@link pickFlatpakBuildKeys} is exported and BOTH command groups
// go through it. "Both spellings resolve" is now true of every reader of these
// keys, which is what makes the advice safe to follow.
//
// WHY A NAMED VERSION, IN ONE PLACE. The precedent is
// `utils/normalize-bundler-options.ts`, the `esbuild` → `bundler` shim, and it
// also carries the precedent's DEFECT: its warning text names 0.5.0, the tree is
// far past it, and its header now has to say "removing the shim means fixing
// that string too". So the version here is a constant the message reads, and the
// spec asserts the message names it.

import type { ConfigDataFlatpak, ConfigDataShip, ShipFlatpakOptions } from '../../types/config-data.js';
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

/** The six keys as a reader sees them, before any default is applied. */
export type MigratedFlatpakValues = { [K in MigratedFlatpakKey]: ConfigDataFlatpak[K] };

export interface PickedFlatpakBuildKeys {
    values: MigratedFlatpakValues;
    /** Keys that came from `gjsify.flatpak`, in {@link MIGRATED_FLATPAK_KEYS} order. */
    fromLegacy: MigratedFlatpakKey[];
}

/**
 * `gjsify.ship.flatpak.<key>` when set, else `gjsify.flatpak.<key>` — per KEY,
 * noting which side answered.
 *
 * Per-key and not per-block: a project migrating one key at a time must not
 * lose the five it has not moved yet. That is also what makes the warning
 * actionable — it names the keys still coming from the old block, so the reader
 * knows what to edit rather than being told a block is deprecated.
 *
 * A LOOP over {@link MIGRATED_FLATPAK_KEYS}, not six hand-written picks. Written
 * out, the list was the one unbound copy of this vocabulary: a key added to it
 * with no `pick` call behind it compiled fine, went missing from the window, and
 * the only test that mentioned the constant compared it to a literal copy of
 * itself. Reading the keys off the constant is what makes "this list IS the
 * window" true rather than asserted.
 *
 * NO default is applied here. The defaults differ per reader — `ship` derives
 * `finishArgs` from `kind`, `flatpak init` also merges `--sdk-extension` flags —
 * and a default applied here would be a third answer neither of them chose.
 */
export function pickFlatpakBuildKeys(
    preferred: ShipFlatpakOptions | undefined,
    legacy: ConfigDataFlatpak,
): PickedFlatpakBuildKeys {
    const ship = preferred ?? {};
    // Assembled through an index signature because the value type varies per
    // key; the cast is on the finished object, where every key is present.
    const values: Record<string, unknown> = {};
    const fromLegacy: MigratedFlatpakKey[] = [];
    for (const key of MIGRATED_FLATPAK_KEYS) {
        const own = ship[key];
        if (own !== undefined) {
            values[key] = own;
            continue;
        }
        const inherited = legacy[key];
        if (inherited !== undefined) fromLegacy.push(key);
        values[key] = inherited;
    }
    return { values: values as MigratedFlatpakValues, fromLegacy };
}

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
 * new one is silent, and applying `ship`'s own defaults.
 *
 * The per-key fallback itself is {@link pickFlatpakBuildKeys}, shared with
 * `gjsify flatpak init`/`ci`; what is `ship`-specific and stays here is the
 * defaulting — `branch`, the `kind`-dependent finish-args, the derived
 * `appendPath` — plus the warning, which only `ship` prints because only `ship`
 * has somewhere else to point at.
 */
export function resolveShipFlatpakSettings(input: ShipFlatpakInput): ResolvedShipFlatpak {
    const shipFlatpak = input.ship.flatpak ?? {};
    const { values, fromLegacy } = pickFlatpakBuildKeys(shipFlatpak, input.flatpak);

    const resolved = resolveRuntime(values, {});
    const extensions = values.sdkExtensions ?? [];
    const { appendPath, finishArgs, cleanup } = values;

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
