// `Gtk.Application` as observable behaviour — ADR 0098 § Proof.
//
// A vector is a program written against `Gio.Application` / `Gtk.Application` and the data it must
// leave behind. The SAME vectors run on real GJS (the ORACLE: a vector that fails there is wrong,
// never a port bug), on the core with a test host, and on each port. `holds: 'subset'` marks a
// REFUSAL, which GJS cannot hold because it implements what the subset refuses.
//
// Where ADR 0098 and GJS disagreed, the vector follows GJS: the newest added window is the active
// one, and `present()` does not switch it synchronously.

import { UNLOCKED_VFUNCS, type GObjectNamespace } from '../gobject.js';
import type { ConstructHarness } from './constructs.js';

/** The rows of ADR 0098 § 1 that carry a claim; every one needs a vector. */
export const APPLICATION_ROWS = [
    'lifecycle',
    'order',
    'unlock',
    'actions',
    'windows',
    'resolution',
    'refusal',
] as const;

export type ApplicationRow = (typeof APPLICATION_ROWS)[number];

type Handler = (...args: unknown[]) => unknown;

/** The part of `Gtk.Application` the vectors read. */
export interface ApplicationLike {
    connect(signal: string, handler: Handler): number;
    runAsync(argv: string[]): Promise<number>;
    quit(): void;
    vfunc_startup(): void;
    vfunc_activate(): void;
    add_action(action: object): void;
    lookup_action(name: string): object | null;
    remove_action(name: string): void;
    has_action(name: string): boolean;
    list_actions(): string[];
    activate_action(name: string, parameter: null): void;
    add_window(window: object): void;
    remove_window(window: object): void;
    get_windows(): object[];
    get_active_window(): object | null;
    get_application_id(): string | null;
    [member: string]: unknown;
}

export interface SimpleActionLike {
    enabled: boolean;
    connect(signal: 'activate', handler: Handler): number;
    [member: string]: unknown;
}

/** Widgets a window scene needs; absent on a subject that cannot build a window (GJS without a display). */
export interface ApplicationScene {
    /** `new Gtk.ApplicationWindow({ application })`. */
    window(app: ApplicationLike): object;
    /** A button placed in the window. */
    buttonIn(window: object): object;
    /** A button inside a popover owned by a menu button placed in the window. */
    popoverButtonIn(window: object): object;
    /** A button with no window above it. */
    loose(): object;
    /** `activate_action(name)` of the widget: whether an enabled action ran. */
    activate(widget: object, name: string): boolean;
    /** `Gtk.ApplicationWindow.add_action`. */
    addWindowAction(window: object, action: object): void;
}

/** What a driver hands the vectors. */
export interface ApplicationSubject {
    readonly name: string;
    /** True for real GJS: refusal vectors are the subset's own and are not run there. */
    readonly isOracle: boolean;
    readonly GObject: GObjectNamespace;
    /** `Gtk.Application`, or `Gio.Application` where GJS has no display. */
    readonly Application: new (params?: Record<string, unknown>) => ApplicationLike;
    readonly SimpleAction: new (params: { name: string; enabled?: boolean }) => SimpleActionLike;
    /** `Gio.ApplicationFlags.HANDLES_OPEN`: a flag other than the default. */
    readonly handlesOpen: number;
    readonly scene?: ApplicationScene;
    /**
     * Runs the application to its end. Ports: `runAsync`. GJS inside a test runner cannot (its own
     * main loop is running, and `runAsync` refuses), so the oracle registers and activates instead.
     */
    run?(app: ApplicationLike): Promise<number>;
    /** Makes the action API usable before a run (`g_application_register` on GJS); a port needs nothing. */
    ready?(app: ApplicationLike): void;
}

const runOf = (s: ApplicationSubject, app: ApplicationLike): Promise<number> => (s.run ? s.run(app) : app.runAsync([]));

export interface ApplicationVector {
    readonly row: ApplicationRow;
    readonly rule: string;
    readonly holds: 'oracle' | 'subset';
    /** Needs `subject.scene`. */
    readonly windowed?: true;
    /** `Class.vfunc_name` entries of `UNLOCKED_VFUNCS` this vector proves against GJS. */
    readonly unlocks?: readonly string[];
    readonly observe: (subject: ApplicationSubject) => unknown;
    readonly shows: unknown;
}

let serial = 0;
const idOf = (): string => `org.gjsify.vec.App${++serial}`;

function attempt(fn: () => void): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

function register(
    s: ApplicationSubject,
    body: (base: ApplicationSubject['Application']) => unknown,
): ApplicationSubject['Application'] {
    return s.GObject.registerClass(
        { GTypeName: `GoVecApplication${++serial}` },
        body(s.Application) as ApplicationSubject['Application'],
    ) as ApplicationSubject['Application'];
}

const refusedBy = (member: string, call: (app: ApplicationLike) => unknown) =>
    ({
        row: 'refusal',
        rule: `${member} is refused, by name`,
        holds: 'subset',
        observe(s) {
            const app = new s.Application({ application_id: idOf() });
            return (attempt(() => void call(app)) ?? '').includes(member);
        },
        shows: true,
    }) satisfies ApplicationVector;

export const APPLICATION_VECTORS: readonly ApplicationVector[] = [
    {
        row: 'lifecycle',
        rule: 'startup once, then activate once, then runAsync resolves 0 for an application that holds nothing',
        holds: 'oracle',
        async observe(s) {
            const app = new s.Application({ application_id: idOf() });
            const log: string[] = [];
            app.connect('startup', () => log.push('startup'));
            app.connect('activate', () => log.push('activate'));
            return { log, code: await runOf(s, app) };
        },
        shows: { log: ['startup', 'activate'], code: 0 },
    },
    {
        row: 'order',
        rule: 'vfunc_startup runs before the startup handlers (RUN_FIRST); the activate handlers run before vfunc_activate (RUN_LAST)',
        holds: 'oracle',
        unlocks: ['Gio.Application.vfunc_startup', 'Gio.Application.vfunc_activate'],
        async observe(s) {
            const log: string[] = [];
            const App = register(
                s,
                (Base) =>
                    class extends Base {
                        vfunc_startup(): void {
                            log.push('vfunc_startup');
                            super.vfunc_startup();
                        }
                        vfunc_activate(): void {
                            log.push('vfunc_activate');
                        }
                    },
            );
            const app = new App({ application_id: idOf() });
            app.connect('startup', () => log.push('h_startup'));
            app.connect('activate', () => log.push('h_activate'));
            await runOf(s, app);
            return log;
        },
        shows: ['vfunc_startup', 'h_startup', 'h_activate', 'vfunc_activate'],
    },
    {
        row: 'lifecycle',
        rule: 'application_id reads back, and null is allowed',
        holds: 'oracle',
        observe(s) {
            const id = idOf();
            const named = new s.Application({ application_id: id });
            return [named.get_application_id() === id, named.application_id === id];
        },
        shows: [true, true],
    },
    {
        row: 'lifecycle',
        rule: 'quit() resolves runAsync with 0',
        holds: 'oracle',
        async observe(s) {
            const App = register(
                s,
                (Base) =>
                    class extends Base {
                        vfunc_activate(): void {
                            void Promise.resolve().then(() => this.quit());
                        }
                    },
            );
            const app = new App({ application_id: idOf() });
            app.connect('activate', () => {
                // Holds the application for the tick that quits it: GIO ends one that holds nothing.
            });
            return await runOf(s, app);
        },
        shows: 0,
    },
    {
        row: 'actions',
        rule: 'add_action then lookup_action; a duplicate name replaces; remove_action removes',
        holds: 'oracle',
        observe(s) {
            const app = new s.Application({ application_id: idOf() });
            s.ready?.(app);
            const first = new s.SimpleAction({ name: 'go' });
            const second = new s.SimpleAction({ name: 'go' });
            app.add_action(first);
            const found = app.lookup_action('go') === first;
            app.add_action(second);
            const replaced = app.lookup_action('go') === second;
            const listed = [app.has_action('go'), app.list_actions().join()];
            app.remove_action('go');
            return { found, replaced, listed, removed: app.lookup_action('go') === null, has: app.has_action('go') };
        },
        shows: { found: true, replaced: true, listed: [true, 'go'], removed: true, has: false },
    },
    {
        row: 'actions',
        rule: 'activate_action runs the handler; a disabled action and an unknown name do nothing',
        holds: 'oracle',
        observe(s) {
            const app = new s.Application({ application_id: idOf() });
            s.ready?.(app);
            const action = new s.SimpleAction({ name: 'go' });
            let ran = 0;
            action.connect('activate', () => ran++);
            app.add_action(action);
            app.activate_action('go', null);
            action.enabled = false;
            app.activate_action('go', null);
            action.enabled = true;
            app.activate_action('nope', null);
            app.activate_action('go', null);
            return ran;
        },
        shows: 2,
    },
    {
        row: 'windows',
        rule: 'the newest window added is active and first; adding twice adds once; remove_window of the last resolves runAsync with 0',
        holds: 'oracle',
        windowed: true,
        async observe(s) {
            const scene = s.scene!;
            const seen: unknown[] = [];
            const App = register(
                s,
                (Base) =>
                    class extends Base {
                        vfunc_activate(): void {
                            const first = scene.window(this);
                            const second = scene.window(this);
                            const [a, b] = this.get_windows();
                            this.add_window(first);
                            seen.push(
                                a === second,
                                b === first,
                                this.get_active_window() === second,
                                this.get_windows().length,
                            );
                            this.remove_window(first);
                            seen.push(this.get_active_window() === second);
                            this.remove_window(second);
                            seen.push(this.get_active_window());
                        }
                    },
            );
            const app = new App({ application_id: idOf() });
            return { seen, code: await runOf(s, app) };
        },
        shows: { seen: [true, true, true, 2, true, null], code: 0 },
    },
    {
        row: 'resolution',
        rule: 'an app. action resolves from a button in a window, and a win. action from the same button',
        holds: 'oracle',
        windowed: true,
        async observe(s) {
            const scene = s.scene!;
            const hit: string[] = [];
            const App = register(
                s,
                (Base) =>
                    class extends Base {
                        vfunc_activate(): void {
                            const appAction = new s.SimpleAction({ name: 'x' });
                            appAction.connect('activate', () => hit.push('app'));
                            this.add_action(appAction);
                            const window = scene.window(this);
                            const winAction = new s.SimpleAction({ name: 'w' });
                            winAction.connect('activate', () => hit.push('win'));
                            scene.addWindowAction(window, winAction);
                            const button = scene.buttonIn(window);
                            hit.push(String(scene.activate(button, 'app.x')), String(scene.activate(button, 'win.w')));
                            this.quit();
                        }
                    },
            );
            await runOf(s, new App({ application_id: idOf() }));
            return hit;
        },
        shows: ['app', 'win', 'true', 'true'],
    },
    {
        row: 'resolution',
        rule: 'an app. action resolves from a button in a popover owned by a menu button in the window',
        holds: 'oracle',
        windowed: true,
        async observe(s) {
            const scene = s.scene!;
            const hit: string[] = [];
            const App = register(
                s,
                (Base) =>
                    class extends Base {
                        vfunc_activate(): void {
                            const action = new s.SimpleAction({ name: 'x' });
                            action.connect('activate', () => hit.push('app'));
                            this.add_action(action);
                            const window = scene.window(this);
                            hit.push(String(scene.activate(scene.popoverButtonIn(window), 'app.x')));
                            this.quit();
                        }
                    },
            );
            await runOf(s, new App({ application_id: idOf() }));
            return hit;
        },
        shows: ['app', 'true'],
    },
    {
        row: 'resolution',
        rule: 'a widget with no window above it, and a disabled action, resolve nothing',
        holds: 'oracle',
        windowed: true,
        async observe(s) {
            const scene = s.scene!;
            const result: boolean[] = [];
            const App = register(
                s,
                (Base) =>
                    class extends Base {
                        vfunc_activate(): void {
                            const action = new s.SimpleAction({ name: 'x' });
                            action.connect('activate', () => result.push(true));
                            this.add_action(action);
                            const window = scene.window(this);
                            // GJS answers "found" and not "ran" to a disabled action, so the handler is the witness.
                            scene.activate(scene.loose(), 'app.x');
                            action.enabled = false;
                            scene.activate(scene.buttonIn(window), 'app.x');
                            this.quit();
                        }
                    },
            );
            await runOf(s, new App({ application_id: idOf() }));
            return result;
        },
        shows: [],
    },
    {
        row: 'refusal',
        rule: 'a vfunc_* that UNLOCKED_VFUNCS does not list is refused at registration, naming the method',
        holds: 'subset',
        observe(s) {
            const message = attempt(() => {
                register(
                    s,
                    (Base) =>
                        class extends Base {
                            vfunc_shutdown(): void {}
                        },
                );
            });
            return (message ?? '').includes('vfunc_shutdown');
        },
        shows: true,
    },
    {
        row: 'refusal',
        rule: 'run() is refused, naming runAsync as the way',
        holds: 'subset',
        observe(s) {
            const app = new s.Application({ application_id: idOf() });
            const message = attempt(() => void (app as unknown as { run(argv: string[]): number }).run([]));
            return (message ?? '').includes('run()') && (message ?? '').includes('runAsync');
        },
        shows: true,
    },
    {
        row: 'refusal',
        rule: 'a flag other than the default is refused, and an invalid application id throws',
        holds: 'subset',
        observe(s) {
            const flags = attempt(() => void new s.Application({ application_id: idOf(), flags: s.handlesOpen }));
            const id = attempt(() => void new s.Application({ application_id: 'bad' }));
            return [(flags ?? '').includes('Gio.ApplicationFlags'), (id ?? '').includes('application id')];
        },
        shows: [true, true],
    },
    refusedBy('hold()', (app) => (app as unknown as { hold(): void }).hold()),
    refusedBy('release()', (app) => (app as unknown as { release(): void }).release()),
    refusedBy('open()', (app) => (app as unknown as { open(): void }).open()),
    refusedBy("the 'open' signal", (app) => app.connect('open', () => {})),
    refusedBy("the 'shutdown' signal", (app) => app.connect('shutdown', () => {})),
    refusedBy("the 'command-line' signal", (app) => app.connect('command-line', () => {})),
    refusedBy('send_notification()', (app) => (app as unknown as { send_notification(): void }).send_notification()),
    {
        row: 'refusal',
        rule: 'set_accels_for_action throws until stage 2, because a shortcut that silently dies is a drop',
        holds: 'subset',
        windowed: true,
        observe(s) {
            const app = new s.Application({ application_id: idOf() }) as unknown as {
                set_accels_for_action(action: string, accels: string[]): void;
            };
            return (attempt(() => app.set_accels_for_action('app.quit', ['<Control>q'])) ?? '').includes(
                'set_accels_for_action',
            );
        },
        shows: true,
    },
];

/** Every `Class.vfunc_name` of `UNLOCKED_VFUNCS`, for the gate that an entry without a vector fails. */
export function unlockedVfuncNames(): string[] {
    return Object.entries(UNLOCKED_VFUNCS).flatMap(([type, names]) => names.map((name) => `${type}.${name}`));
}

/** The entries of `UNLOCKED_VFUNCS` no vector proves. */
export function unprovenVfuncs(vectors: readonly ApplicationVector[] = APPLICATION_VECTORS): string[] {
    const proven = new Set(vectors.flatMap((vector) => vector.unlocks ?? []));
    return unlockedVfuncNames().filter((name) => !proven.has(name));
}

/** Holds a subject to the vectors. Windowed vectors need `subject.scene`. */
export async function driveApplicationVectors(
    subject: ApplicationSubject,
    harness: ConstructHarness,
    vectors: readonly ApplicationVector[] = APPLICATION_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gtk.Application subset (ADR 0098)`, async () => {
        for (const vector of vectors) {
            if (vector.holds === 'subset' && subject.isOracle) continue;
            if (vector.windowed && subject.scene === undefined) continue;
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
