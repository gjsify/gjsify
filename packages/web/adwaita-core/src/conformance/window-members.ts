// `Gtk.Window`'s close / maximize / focus members as observable behaviour.
//
// A vector is a program written against `Gtk.Window` and the data it must leave behind. The SAME
// vectors run on real GJS (the ORACLE: a vector that fails there is wrong, never a port bug), on
// the core's `CloseRequestState` / `WindowMemberState`, and on each port that has the member.
//
// `is-active` has no row: the platform decides when a window is active, so a program cannot make
// it change, and GTK's own read-only property is the whole claim. Its "notify only on change"
// rule is a unit test of `WindowMemberState` and of each port's platform feed.
//
// A port that cannot supply a member says so through `capabilities`, and the driver skips the
// rows that need it — the port's own spec then pins the REFUSAL.

import type { ConstructHarness } from './constructs.js';

export const WINDOW_ROWS = ['close-request', 'close', 'hide-on-close', 'maximized', 'focus-widget'] as const;
export type WindowRow = (typeof WINDOW_ROWS)[number];

type Handler = (...args: unknown[]) => unknown;

/** What a port can honestly do. GTK itself has all of it. */
export interface WindowCapabilities {
    /** `maximize()` / `unmaximize()` change the state. */
    readonly maximizable: boolean;
    /** A change of focus is reported through `notify::focus-widget`. */
    readonly observesFocus: boolean;
    /** `hide-on-close` exists. */
    readonly hideOnClose: boolean;
}

/** What a driver hands the vectors. */
export interface WindowSubject {
    readonly name: string;
    /** True for real GJS. */
    readonly isOracle: boolean;
    readonly capabilities: WindowCapabilities;
    /** A window that is NOT yet shown. */
    create(options: { hideOnClose?: boolean }): object;
    /** `present()`: the window becomes realized and visible. */
    show(window: object): void;
    connect(window: object, signal: string, handler: Handler): number;
    close(window: object): void;
    maximize(window: object): void;
    unmaximize(window: object): void;
    isMaximized(window: object): boolean;
    isVisible(window: object): boolean;
    /** Two widgets inside `window` that can take focus. */
    focusables(window: object): [object, object];
    setFocus(window: object, widget: object | null): void;
    getFocus(window: object): object | null;
}

export interface WindowVector {
    readonly row: WindowRow;
    readonly rule: string;
    /** Skipped on a subject that lacks the capability. */
    readonly needs?: keyof WindowCapabilities;
    readonly observe: (subject: WindowSubject) => unknown;
    readonly shows: unknown;
}

export const WINDOW_VECTORS: readonly WindowVector[] = [
    {
        row: 'close-request',
        rule:
            'close-request is RUN_LAST with _gtk_boolean_handled_accumulator: handlers run in connect order and the ' +
            'first truthy return stops the emission, so a later handler never runs and the window stays visible',
        observe(s) {
            const win = s.create({});
            s.show(win);
            const log: string[] = [];
            s.connect(win, 'close-request', () => void log.push('first'));
            s.connect(win, 'close-request', () => {
                log.push('second');
                return true;
            });
            s.connect(win, 'close-request', () => void log.push('third'));
            s.close(win);
            return { log, visible: s.isVisible(win) };
        },
        shows: { log: ['first', 'second'], visible: true },
    },
    {
        row: 'close',
        rule: 'gtk_window_close does nothing for a window that is not realized (gtkwindow.c:1469): no close-request',
        observe(s) {
            const win = s.create({});
            let emitted = 0;
            s.connect(win, 'close-request', () => void emitted++);
            s.close(win);
            return emitted;
        },
        shows: 0,
    },
    {
        row: 'close',
        rule: 'a handler that calls close() again is ignored: in_emit_close_request guards the re-entry (:1473)',
        observe(s) {
            const win = s.create({});
            s.show(win);
            let emitted = 0;
            s.connect(win, 'close-request', () => {
                emitted++;
                s.close(win);
                return true;
            });
            s.close(win);
            return emitted;
        },
        shows: 1,
    },
    {
        row: 'hide-on-close',
        rule: 'with hide-on-close set and no handler taking it, the class handler hides the window and counts it handled',
        needs: 'hideOnClose',
        observe(s) {
            const win = s.create({ hideOnClose: true });
            s.show(win);
            s.close(win);
            return s.isVisible(win);
        },
        shows: false,
    },
    {
        row: 'hide-on-close',
        rule: 'a close-request handler that returns true beats hide-on-close: the class handler never runs',
        needs: 'hideOnClose',
        observe(s) {
            const win = s.create({ hideOnClose: true });
            s.show(win);
            s.connect(win, 'close-request', () => true);
            s.close(win);
            return s.isVisible(win);
        },
        shows: true,
    },
    {
        row: 'maximized',
        rule:
            'maximize() on a window that is not mapped sets the property and notifies it directly (:5660); ' +
            'an equal write does not notify again',
        needs: 'maximizable',
        observe(s) {
            const win = s.create({});
            let notified = 0;
            s.connect(win, 'notify::maximized', () => void notified++);
            s.maximize(win);
            s.maximize(win);
            const after = { maximized: s.isMaximized(win), notified };
            s.unmaximize(win);
            s.unmaximize(win);
            return { after, undone: { maximized: s.isMaximized(win), notified } };
        },
        shows: { after: { maximized: true, notified: 1 }, undone: { maximized: false, notified: 2 } },
    },
    {
        row: 'focus-widget',
        rule: 'set_focus(widget) is read back by get_focus(); set_focus(NULL) unsets it',
        observe(s) {
            const win = s.create({});
            const [a] = s.focusables(win);
            s.show(win);
            s.setFocus(win, a);
            const set = s.getFocus(win) === a;
            s.setFocus(win, null);
            return { set, cleared: s.getFocus(win) === null };
        },
        shows: { set: true, cleared: true },
    },
    {
        row: 'focus-widget',
        rule: 'notify::focus-widget fires when the focus moves and not for an equal write (gtk_window_set_focus :5361)',
        needs: 'observesFocus',
        observe(s) {
            const win = s.create({});
            const [a, b] = s.focusables(win);
            s.show(win);
            // GTK hands the first focusable child the focus when the window maps; start from none.
            s.setFocus(win, null);
            let notified = 0;
            s.connect(win, 'notify::focus-widget', () => void notified++);
            s.setFocus(win, a);
            s.setFocus(win, a);
            const first = notified;
            s.setFocus(win, b);
            s.setFocus(win, null);
            return { first, total: notified };
        },
        shows: { first: 1, total: 3 },
    },
];

/** Run the rows against `subject`, skipping those a capability rules out. */
export async function driveWindowVectors(
    subject: WindowSubject,
    harness: ConstructHarness,
    vectors: readonly WindowVector[] = WINDOW_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gtk.Window members`, async () => {
        for (const vector of vectors) {
            if (vector.needs && !subject.capabilities[vector.needs]) continue;
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
