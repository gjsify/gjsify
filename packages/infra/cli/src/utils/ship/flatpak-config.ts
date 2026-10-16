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

/**
 * The scalable icon directory a `kind: 'app'` Flatpak drops before
 * `appstreamcli compose` reads the tree.
 *
 * THE OTHER HALF OF `LAYOUTS.linux.icon`, and the half that cannot live in the
 * layout: the stage is one payload for four Linux formats (ADR 0024 § 2) and the
 * `.deb`, the `.rpm` and the AppImage all WANT the SVG — it is the icon GTK
 * prefers, and `selectAppDirIcon` ranks it above every raster. Only the Flatpak
 * has a build step that reads the theme, so only the Flatpak removes it, and it
 * does so inside the sandbox rather than in the tree `ship` staged.
 *
 * WHY IT IS REMOVED AT ALL. `flatpak-builder` runs `appstreamcli compose` on the
 * HOST to produce `/app/share/app-info`; AppStream 1.1.3 decodes icons through
 * gdk-pixbuf, which reads SVG only through a loader module Fedora 44 no longer
 * ships (`LAYOUTS.linux.icon` carries the measurement). Three probes: with the
 * SVG present compose fails whether or not rasters are there, because it PREFERS
 * the scalable icon and does not fall back; with the SVG gone and the rasters
 * present it succeeds and emits 64×64 and 128×128 into the catalogue. So the
 * rasters are necessary and this is what makes them sufficient.
 *
 * UNCONDITIONAL, not host-detected, and that is the point. `org.flatpak.Builder`
 * on Flathub bundles a gdk-pixbuf that CAN read SVG, so probing the host would
 * make the same source produce a different `.flatpak` depending on where it was
 * built — the one property ADR 0024 § A2 asks a pack to keep. One tree, every
 * host, at the cost of a scalable icon inside a sandbox whose only reader
 * (`Icon=<appId>` in the exported desktop entry) resolves the 256 px raster.
 *
 * THE UPSTREAM FIX IS NOT OURS: `libappstream-compose.so.0` already links
 * `librsvg-2.so.2` and uses it for fonts alone, so AppStream could render the
 * icon without gdk-pixbuf at all. Reported as an `Upstream (AppStream, file by
 * hand)` issue rather than filed there (root AGENTS.md).
 */
export const SCALABLE_ICONS_CLEANUP = '/share/icons/hicolor/scalable';

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
        // APPENDED to what the project declared, not defaulted to — the one entry
        // here that is not the author's choice. A project with its own `cleanup`
        // list would otherwise lose the entry that keeps its own Flatpak buildable
        // (see {@link SCALABLE_ICONS_CLEANUP}), and `??` cannot express "ours as
        // well as theirs". Deduplicated so a project that already wrote the glob —
        // the workaround this replaces — gets one, and in ITS position.
        cleanup: [...new Set([...(cleanup ?? []), ...(input.kind === 'app' ? [SCALABLE_ICONS_CLEANUP] : [])])],
    };

    return { settings, warnings: fromLegacy.length === 0 ? [] : [deprecationWarning(fromLegacy)] };
}

/**
 * Refuse a Flatpak ship that would silently drop the project's own modules.
 *
 * `gjsify.flatpak.modules` / `extraModules` are read by `gjsify flatpak init`
 * only; `ship` renders exactly one module, the staged payload (ADR 0024 § 2),
 * and the keys' absence from {@link ShipFlatpakOptions} is deliberate. The
 * defect was the silence: a project that moved to `ship` kept the keys, got a
 * manifest without its `extra-data` module and exit 0, and found out when the
 * app started without the binary the module downloads. A key `ship` does not
 * read must not be one it ignores quietly, so the run stops BEFORE the build.
 *
 * Called only when `flatpak` is among the formats being made: the same keys
 * still drive `gjsify flatpak init`, and a `ship --target deb` has nothing to
 * drop them from.
 */
export function assertNoDroppedFlatpakModules(flatpak: ConfigDataFlatpak): void {
    const dropped = (['modules', 'extraModules'] as const).filter((key) => (flatpak[key]?.length ?? 0) > 0);
    if (dropped.length === 0) return;
    const list = dropped.map((key) => `gjsify.flatpak.${key}`).join(' and ');
    throw new Error(
        `gjsify ship: ${list} ${dropped.length > 1 ? 'are' : 'is'} set, but the \`flatpak\` target renders ` +
            'ONE module, the staged payload, and would drop ' +
            `${dropped.length > 1 ? 'them' : 'it'} (ADR 0024 § 2). Build this Flatpak with ` +
            '`gjsify flatpak init` + `gjsify flatpak build`, which honour the key, or leave `flatpak` out of ' +
            '`--target` / `gjsify.ship.targets`.',
    );
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
