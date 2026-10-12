// `Gio.Settings` on a real Gio as a conformance SUBJECT — ADR 0105 stage 3, the `Gio.Settings`
// half. `@gjsify/app-settings/conformance`'s `SETTINGS_VECTORS` (ADR 0099 § 5) were written against
// real `Gio.Settings` under GJS; this builds the subject that runs them against the SAME class
// reached through node-gi, on Node and — with the schema compiled ahead of time — on a device.
//
// The user's dconf is never touched: the subject pins `GSETTINGS_BACKEND=memory`, the backend the
// GJS oracle uses, and points `GSETTINGS_SCHEMA_DIR` at a directory of the caller's choosing. Both
// are read ONCE, when GIO creates its default backend and schema source, so the subject has to be
// built before the first `Gio.Settings` of the process — the same ordering rule as the oracle's.
//
// WHY `requireGi` IS A PARAMETER: `engine.ts`'s header.

import type { RequireGi } from './engine.js';

/** The shape `SETTINGS_VECTORS` drive; structural, so this package needs no dependency on the vectors. */
export interface RealGioSettingsSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Settings: new (props: { schema_id: string; path?: string }) => {
        readonly schema_id: string;
        readonly path: string;
        [method: string]: any;
    };
    /** Forgets everything written, so a vector starts from the defaults. */
    reset(): void;
}

interface RealGLib {
    setenv(name: string, value: string, overwrite: boolean): boolean;
}

/** As much of a real `Gio.Settings` class as the subject uses. */
interface RealSettingsClass {
    new (props: { schema_id: string; path?: string }): RealGioSettingsSubject['Settings']['prototype'] & {
        list_keys(): string[];
        reset(key: string): void;
    };
}

export interface RealGioSettingsOptions {
    /** A directory holding the compiled `gschemas.compiled` of the schema under test. */
    readonly schemaDir: string;
    /** The schema id `reset` clears; the vectors' own schema. */
    readonly schemaId: string;
}

/**
 * The subject for `SETTINGS_VECTORS` over real Gio. `isOracle` is `true`: this is real `Gio.Settings`,
 * so the subset-only refusals are skipped exactly as on the GJS leg.
 */
export function createRealGioSettingsSubject(
    requireGi: RequireGi,
    { schemaDir, schemaId }: RealGioSettingsOptions,
): RealGioSettingsSubject {
    const GLib = requireGi('GLib', '2.0') as RealGLib;
    GLib.setenv('GSETTINGS_SCHEMA_DIR', schemaDir, true);
    GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
    const Gio = requireGi('Gio', '2.0') as {
        Settings: RealSettingsClass;
        SettingsSchemaSource: {
            new_from_directory(
                dir: string,
                parent: null,
                trusted: boolean,
            ): { lookup(id: string, recursive: boolean): unknown };
        };
    };
    // The schema comes from an explicit source rather than GSETTINGS_SCHEMA_DIR: GIO builds its
    // default source once, and on Android that has happened (and found nothing) before the suite
    // runs, so the variable is no longer read. An id the source lacks falls through, so the
    // unknown-schema row still meets the real refusal.
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDir, null, false);
    const Settings = new Proxy(Gio.Settings, {
        construct(target, args) {
            const { schema_id, ...rest } = (args[0] ?? {}) as { schema_id?: string };
            const schema = schema_id === undefined ? null : source.lookup(schema_id, false);
            return Reflect.construct(target, schema ? [{ ...rest, settings_schema: schema }] : args);
        },
    });
    return {
        name: 'node-gi (real Gio.Settings, memory backend)',
        isOracle: true,
        Settings: Settings as unknown as RealGioSettingsSubject['Settings'],
        reset: () => {
            const settings = new Settings({ schema_id: schemaId });
            for (const key of settings.list_keys()) settings.reset(key);
        },
    };
}
