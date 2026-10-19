// `Gio.Settings` as observable behaviour — ADR 0099 § 5. The SAME vectors run on real
// `gi://Gio` with `GSETTINGS_BACKEND=memory` (the ORACLE: a vector that fails there is wrong,
// never a port bug) and on each subset. Refusal vectors are subset-only.

import type { Schema } from '../settings.js';

export interface SettingsLike {
    readonly schema_id: string;
    readonly path: string;
    [method: string]: any;
}

export interface SettingsClassLike {
    new (props: { schema_id: string; path?: string }): SettingsLike;
}

/** `GLib.Variant` as far as the vectors build one for `set_value` (ADR 0118 § 3). */
export interface VariantClassLike {
    new (type: string, value: unknown): { get_type_string(): string; deepUnpack(): unknown };
}

export interface SettingsSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Settings: SettingsClassLike;
    readonly Variant: VariantClassLike;
    /** Forgets everything written, so a vector starts from the defaults. */
    reset(): void;
}

/**
 * Learn6502's ten keys (`eu.jumplink.Learn6502.gschema.xml`, `support-prompt-years` is its `ai`),
 * plus `u`, `d` and `as` for coverage.
 */
export const FIXTURE_SCHEMA: Schema = {
    id: 'eu.jumplink.Learn6502',
    path: '/eu/jumplink/Learn6502/',
    keys: {
        'ui-font': { type: 's', default: 'Sans 11' },
        'primary-color': { type: 's', default: '' },
        'accent-color': { type: 's', default: '' },
        'font-name': { type: 's', default: 'Monospace 12' },
        'color-scheme': { type: 'i', default: 0 },
        'window-width': { type: 'i', default: 1000 },
        'window-height': { type: 'i', default: 700 },
        'is-maximized': { type: 'b', default: false },
        'show-line-numbers': { type: 'b', default: true },
        'auto-indent': { type: 'b', default: true },
        count: { type: 'u', default: 7 },
        ratio: { type: 'd', default: 1.5 },
        'support-prompt-years': { type: 'ai', default: [] },
        tags: { type: 'as', default: ['a', "b'c"] },
    },
};

/** The XML GJS compiles for the oracle; the same keys as {@link FIXTURE_SCHEMA}. */
export const FIXTURE_SCHEMA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="eu.jumplink.Learn6502" path="/eu/jumplink/Learn6502/">
    <key name="ui-font" type="s"><default>'Sans 11'</default></key>
    <key name="primary-color" type="s"><default>''</default></key>
    <key name="accent-color" type="s"><default>''</default></key>
    <key name="font-name" type="s"><default>'Monospace 12'</default></key>
    <key name="color-scheme" type="i"><default>0</default></key>
    <key name="window-width" type="i"><default>1000</default></key>
    <key name="window-height" type="i"><default>700</default></key>
    <key name="is-maximized" type="b"><default>false</default></key>
    <key name="show-line-numbers" type="b"><default>true</default></key>
    <key name="auto-indent" type="b"><default>true</default></key>
    <key name="count" type="u"><default>7</default></key>
    <key name="ratio" type="d"><default>1.5</default></key>
    <key name="support-prompt-years" type="ai"><default>[]</default></key>
    <key name="tags" type="as"><default>['a', "b'c"]</default></key>
  </schema>
</schemalist>
`;

export interface SettingsVector {
    readonly row: string;
    readonly rule: string;
    /** Subset-only vectors are not run on the oracle. */
    readonly subsetOnly?: boolean;
    readonly run: (subject: SettingsSubject) => unknown;
    readonly shows: unknown;
}

const ID = FIXTURE_SCHEMA.id;
const threw = (fn: () => void): string | null => {
    try {
        fn();
        return null;
    } catch (error) {
        return (error as Error).message;
    }
};
const make = (s: SettingsSubject) => new s.Settings({ schema_id: ID });

export const SETTINGS_VECTORS: readonly SettingsVector[] = [
    {
        row: 'defaults',
        rule: 'a never-written key returns the schema default, for each of b i u d s',
        run: (s) => {
            const x = make(s);
            return [
                x.get_boolean('show-line-numbers'),
                x.get_int('window-width'),
                x.get_uint('count'),
                x.get_double('ratio'),
                x.get_string('font-name'),
            ];
        },
        shows: [true, 1000, 7, 1.5, 'Monospace 12'],
    },
    {
        row: 'roundtrip',
        rule: 'set then get returns the value, for each of b i u d s',
        run: (s) => {
            const x = make(s);
            x.set_boolean('is-maximized', true);
            x.set_int('window-width', -5);
            x.set_uint('count', 4000000000);
            x.set_double('ratio', 0.25);
            x.set_string('font-name', 'Mono 9');
            return [
                x.get_boolean('is-maximized'),
                x.get_int('window-width'),
                x.get_uint('count'),
                x.get_double('ratio'),
                x.get_string('font-name'),
            ];
        },
        shows: [true, -5, 4000000000, 0.25, 'Mono 9'],
    },
    {
        row: 'instances',
        rule: 'a second instance on the schema sees the value and hears the change',
        run: (s) => {
            const a = make(s);
            const b = make(s);
            const heard: string[] = [];
            b.connect('changed::window-width', (_o: unknown, key: string) => heard.push(key));
            a.set_int('window-width', 640);
            return [b.get_int('window-width'), heard];
        },
        shows: [640, ['window-width']],
    },
    {
        row: 'changed',
        rule: 'changed::key runs once per differing set with the key; changed::other does not; changed runs for every key',
        run: (s) => {
            const x = make(s);
            const log: string[] = [];
            x.connect('changed::window-width', (_o: unknown, k: string) => log.push(`w:${k}`));
            x.connect('changed::window-height', (_o: unknown, k: string) => log.push(`h:${k}`));
            x.connect('changed', (_o: unknown, k: string) => log.push(`any:${k}`));
            x.set_int('window-width', 1);
            x.set_int('window-width', 2);
            return log;
        },
        shows: ['w:window-width', 'any:window-width', 'w:window-width', 'any:window-width'],
    },
    {
        row: 'equal',
        rule: 'the first write of the default fires (the key was unset); a write equal to the stored value is silent (memory backend)',
        run: (s) => {
            const x = make(s);
            let runs = 0;
            x.connect('changed::window-width', () => (runs += 1));
            x.set_int('window-width', 1000);
            x.set_int('window-width', 1000);
            x.set_int('window-width', 5);
            x.set_int('window-width', 5);
            return runs;
        },
        shows: 2,
    },
    {
        row: 'disconnect',
        rule: 'disconnect stops the handler',
        run: (s) => {
            const x = make(s);
            let runs = 0;
            const id = x.connect('changed::window-width', () => (runs += 1));
            x.set_int('window-width', 1);
            x.disconnect(id);
            x.set_int('window-width', 2);
            return runs;
        },
        shows: 1,
    },
    {
        row: 'properties',
        rule: 'schema_id and path read back; the schema path is taken when the call gives none',
        run: (s) => {
            const x = make(s);
            return [x.schema_id, x.path];
        },
        shows: [ID, FIXTURE_SCHEMA.path],
    },
    {
        row: 'errors',
        rule: 'an unknown key, an out-of-range uint, an unknown signal and an unknown schema throw',
        run: (s) => {
            const x = make(s);
            return [
                threw(() => x.get_int('nope')) !== null,
                threw(() => x.set_uint('count', -1)) !== null,
                threw(() => x.connect('bogus', () => {})) !== null,
                threw(() => new s.Settings({ schema_id: 'no.such' })) !== null,
            ];
        },
        shows: [true, true, true, true],
    },
    {
        row: 'value-defaults',
        rule: 'get_value of a never-written key is a Variant of the key type holding the default, for an array and a basic key',
        run: (s) => {
            const x = make(s);
            const years = x.get_value('support-prompt-years');
            const tags = x.get_value('tags');
            const width = x.get_value('window-width');
            return [
                years.get_type_string(),
                years.deepUnpack(),
                tags.get_type_string(),
                tags.deepUnpack(),
                width.get_type_string(),
                width.deepUnpack(),
            ];
        },
        shows: ['ai', [], 'as', ['a', "b'c"], 'i', 1000],
    },
    {
        row: 'value-roundtrip',
        rule: 'set_value returns true and get_value reads the value back; a basic key set through set_value reads through its typed getter',
        run: (s) => {
            const x = make(s);
            return [
                x.set_value('support-prompt-years', new s.Variant('ai', [2024, 2025])),
                x.set_value('tags', new s.Variant('as', [])),
                x.set_value('window-width', new s.Variant('i', 640)),
                x.get_value('support-prompt-years').deepUnpack(),
                x.get_value('tags').deepUnpack(),
                x.get_int('window-width'),
            ];
        },
        shows: [true, true, true, [2024, 2025], [], 640],
    },
    {
        row: 'value-changed',
        rule: 'an array key fires changed::key when the stored value differs: the first write of the default fires, an EQUAL array is silent (memory backend)',
        run: (s) => {
            const x = make(s);
            let runs = 0;
            x.connect('changed::support-prompt-years', () => (runs += 1));
            x.set_value('support-prompt-years', new s.Variant('ai', []));
            x.set_value('support-prompt-years', new s.Variant('ai', []));
            x.set_value('support-prompt-years', new s.Variant('ai', [1, 2]));
            x.set_value('support-prompt-years', new s.Variant('ai', [1, 2]));
            x.set_value('support-prompt-years', new s.Variant('ai', [2, 1]));
            return runs;
        },
        shows: 3,
    },
    {
        row: 'value-errors',
        rule: 'get_value and set_value of an unknown key throw; set_value of something that is not a Variant throws TypeError',
        run: (s) => {
            const x = make(s);
            let notVariant = '';
            try {
                x.set_value('support-prompt-years', [1]);
            } catch (error) {
                notVariant = (error as Error).constructor.name;
            }
            return [
                threw(() => x.get_value('nope')) !== null,
                threw(() => x.set_value('nope', new s.Variant('ai', []))) !== null,
                notVariant,
            ];
        },
        shows: [true, true, 'TypeError'],
    },
    {
        row: 'refusal-value-type',
        rule: 'set_value with a Variant of another type throws, naming key, expected and actual type string (GJS returns false and logs a GLib-CRITICAL)',
        subsetOnly: true,
        run: (s) => {
            const x = make(s);
            const message = threw(() => x.set_value('support-prompt-years', new s.Variant('as', []))) ?? '';
            return [message.includes('support-prompt-years'), message.includes("'ai'"), message.includes("'as'")];
        },
        shows: [true, true, true],
    },
    {
        row: 'refusal-type',
        rule: 'a wrong-type getter or setter throws, naming the key (GJS only logs a GLib-CRITICAL and goes on)',
        subsetOnly: true,
        run: (s) => {
            const x = make(s);
            return [
                (threw(() => x.get_int('is-maximized')) ?? '').includes('is-maximized'),
                (threw(() => x.set_int('is-maximized', 1)) ?? '').includes('is-maximized'),
            ];
        },
        shows: [true, true],
    },
    {
        row: 'refusal',
        rule: 'every row ADR 0099 § 2 refuses throws, naming itself',
        subsetOnly: true,
        run: (s) => {
            const x = make(s);
            const names = [
                'list_keys',
                'get_strv',
                'set_strv',
                'get_user_value',
                'get_default_value',
                'reset',
                'apply',
                'delay',
                'revert',
                'sync',
                'bind',
                'create_action',
                'get_child',
            ];
            return names.map((n) => (threw(() => x[n]('k')) ?? '').includes(n));
        },
        shows: [true, true, true, true, true, true, true, true, true, true, true, true, true],
    },
    {
        row: 'refusal-construct',
        rule: 'the backend construct property and a foreign path are refused',
        subsetOnly: true,
        run: (s) => [
            threw(() => new s.Settings({ schema_id: ID, backend: {} } as never)) !== null,
            threw(() => new s.Settings({ schema_id: ID, path: '/other/' })) !== null,
        ],
        shows: [true, true],
    },
];

export interface SettingsHarness {
    describe: (name: string, body: () => void | Promise<void>) => void | Promise<void>;
    it: (name: string, body: () => void | Promise<void>) => void | Promise<void>;
    expect: (value: unknown) => { toStrictEqual(expected: unknown): void };
}

export async function driveSettingsVectors(
    subject: SettingsSubject,
    { describe, it, expect }: SettingsHarness,
): Promise<void> {
    await describe(`Gio.Settings vectors: ${subject.name}`, async () => {
        for (const vector of SETTINGS_VECTORS) {
            if (vector.subsetOnly && subject.isOracle) continue;
            await it(`${vector.row}: ${vector.rule}`, () => {
                subject.reset();
                expect(vector.run(subject)).toStrictEqual(vector.shows);
            });
        }
    });
}
