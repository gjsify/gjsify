// `Gio.SimpleActionGroup` as observable behaviour. The SAME vectors run on real `gi://Gio` (the
// ORACLE: a vector that fails there is wrong, never a port bug), on the core and on each port's `Gio`
// door. `activate_action` is held by its effects, not its return value (GIO returns nothing, the ports
// answer whether the action exists); `list_actions` is sorted, GIO's order being a hash table's.

import type { ConstructHarness } from './constructs.js';

export interface GioSimpleActionLike {
    enabled: boolean;
    connect(signal: 'activate', handler: () => void): number;
}

export interface SimpleActionGroupLike {
    add_action(action: GioSimpleActionLike): void;
    remove_action(name: string): void;
    lookup_action(name: string): unknown;
    has_action(name: string): boolean;
    list_actions(): string[];
    activate_action(name: string, parameter: null): unknown;
}

/** The part of `Gio` the vectors read. */
export interface GioActionsLike {
    SimpleAction: new (props: { name: string }) => GioSimpleActionLike;
    SimpleActionGroup: new () => SimpleActionGroupLike;
}

export interface SimpleActionGroupSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Gio: GioActionsLike;
}

export const SIMPLE_ACTION_GROUP_ROWS = [
    'lookup',
    'replace',
    'list',
    'remove',
    'activate',
    'disabled',
    'unknown',
] as const;

export type SimpleActionGroupRow = (typeof SIMPLE_ACTION_GROUP_ROWS)[number];

export interface SimpleActionGroupVector {
    readonly row: SimpleActionGroupRow;
    readonly rule: string;
    readonly observe: (subject: SimpleActionGroupSubject) => unknown;
    readonly shows: unknown;
}

function named({ Gio }: SimpleActionGroupSubject, names: string[], log: string[]) {
    const group = new Gio.SimpleActionGroup();
    const actions = names.map((name) => {
        const action = new Gio.SimpleAction({ name });
        action.connect('activate', () => void log.push(name));
        group.add_action(action);
        return action;
    });
    return { group, actions };
}

export const SIMPLE_ACTION_GROUP_VECTORS: readonly SimpleActionGroupVector[] = [
    {
        row: 'lookup',
        rule: 'lookup_action returns the very action added, null for a name never added; has_action agrees',
        observe(subject) {
            const { group, actions } = named(subject, ['a', 'b'], []);
            return [
                group.lookup_action('a') === actions[0],
                group.lookup_action('zz'),
                group.has_action('b'),
                group.has_action('zz'),
            ];
        },
        shows: [true, null, true, false],
    },
    {
        row: 'replace',
        rule: 'adding an action under a name that is taken replaces it',
        observe(subject) {
            const log: string[] = [];
            const { group } = named(subject, ['a'], log);
            const second = new subject.Gio.SimpleAction({ name: 'a' });
            second.connect('activate', () => void log.push('a2'));
            group.add_action(second);
            group.activate_action('a', null);
            return [group.lookup_action('a') === second, log];
        },
        shows: [true, ['a2']],
    },
    {
        row: 'list',
        rule: 'list_actions names every action once',
        observe(subject) {
            const { group } = named(subject, ['b', 'a', 'b'], []);
            return group.list_actions().sort();
        },
        shows: ['a', 'b'],
    },
    {
        row: 'remove',
        rule: 'a removed action is gone from lookup, has and list; removing an unknown name is quiet',
        observe(subject) {
            const { group } = named(subject, ['a', 'b'], []);
            group.remove_action('a');
            group.remove_action('zz');
            return [group.has_action('a'), group.lookup_action('a'), group.list_actions()];
        },
        shows: [false, null, ['b']],
    },
    {
        row: 'activate',
        rule: 'activate_action runs the named action once and no other',
        observe(subject) {
            const log: string[] = [];
            const { group } = named(subject, ['a', 'b'], log);
            group.activate_action('b', null);
            return log;
        },
        shows: ['b'],
    },
    {
        row: 'disabled',
        rule: 'a disabled action swallows the activation; enabling it again lets it through',
        observe(subject) {
            const log: string[] = [];
            const { group, actions } = named(subject, ['a'], log);
            actions[0]!.enabled = false;
            group.activate_action('a', null);
            actions[0]!.enabled = true;
            group.activate_action('a', null);
            return log;
        },
        shows: ['a'],
    },
    {
        row: 'unknown',
        rule: 'activating a name that was never added does not throw and runs nothing',
        observe(subject) {
            const log: string[] = [];
            const { group } = named(subject, ['a'], log);
            group.activate_action('zz', null);
            return log;
        },
        shows: [],
    },
];

export async function driveSimpleActionGroupVectors(
    subject: SimpleActionGroupSubject,
    harness: ConstructHarness,
    vectors: readonly SimpleActionGroupVector[] = SIMPLE_ACTION_GROUP_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gio.SimpleActionGroup`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
