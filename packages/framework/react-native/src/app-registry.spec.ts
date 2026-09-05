// The entry point's contract with the application shell it runs on (#1455, ADR 0043).
//
// WHY A KEY-SET ASSERTION AND NOT A LIST OF OPTIONS. The defect this file holds
// against was a forwarding LIST: `runApplication` handed `runAdwaitaApp` an object
// literal naming `applicationId` and `css`, which reads as complete at the call site
// and silently dropped every other field of `AdwaitaAppOptions` — including
// `devtools`, the option that decides whether a running application can be driven,
// inspected or screenshotted from outside at all, and `devtools.address`, the only
// route on a host with no session bus (macOS, Windows).
//
// A spec naming the options it cares about would have gone green on the same shape,
// one option later: the field nobody thought to add is the failure. So the assertion
// is that NOTHING is dropped, whatever it is — which fails for any field list, and
// keeps holding when the shell gains an option nobody has written down here.
//
// `toShellOptions` is pure, so the first block runs on Node and GJS alike: the shell's
// options are a value, and constructing that value needs no display, no bus and no GTK.
//
// THE OTHER TWO BLOCKS DRIVE THE SHIPPING COMPOSITION, which is what #1549 and #1551
// were open for. `runApplication` itself is unreachable from a spec — it runs a
// `Gio.Application`, and a nested `g_application_run` inside the test runner's own main
// loop never returns (MEASURED: `g_application_run: assertion
// '!application->priv->must_quit_now' failed`, and the case timed out at 5 s). So the
// bootstrap is entered one call in, at `mountApplicationRoot` and `ownTheApplication`,
// which together are everything `runApplication` does besides handing the shell its
// options — and those two halves are the two nothing could see:
//
//   - `provideWindowChrome()` had NO vector at its only shipping call site. Measured
//     with the call deleted and the dead import removed — the shape a careless rebase
//     resolution produces — `oxfmt`, `oxlint`, `tsc` and the whole unit suite stayed
//     green, ten hand-written window-chrome vectors included, while the running
//     application drew two mapped `AdwHeaderBar`s: two sets of window controls, one
//     dead close button (#1460, #1549). `router/router.spec.ts` cannot see it, because
//     it composes the shell by hand and so measures what it wrote.
//   - `windowChromeProblems()` had no SHIPPING caller at all (#1546). It has one now,
//     and this file asserts what it found rather than that it ran.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { windowChromeCensus, windowChromeProblems } from '@gjsify/gtk-host/conformance';
import { createElement, type ReactElement } from 'react';

import {
    AppRegistry,
    lastWindowChromeProblems,
    mountApplicationRoot,
    ownTheApplication,
    toShellOptions,
    windowChromeChecks,
    type RunApplicationOptions,
} from './app-registry.js';
import { RouterRoot, Stack, type RouteManifest } from './router/index.js';

/** Named identities, not a capability: a probe that answers "no" stands the suite DOWN. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

/** A stand-in for the window factory: identity is all this file reads off it. */
const CREATE_WINDOW = (() => null) as unknown as Parameters<typeof toShellOptions>[1];
const OTHER_WINDOW = (() => null) as unknown as Parameters<typeof toShellOptions>[1];

/**
 * One option of every shell field plus this layer's own, so the key-set assertion
 * has something to lose. The values are irrelevant — only the KEYS are read — which
 * is why an unknown extra key is in here too: a consumer of a NEWER
 * `@gjsify/adwaita-app` than this file knows about must not have their option eaten.
 */
const OPTIONS = {
    applicationId: 'org.example.App',
    title: 'Example',
    defaultWidth: 640,
    defaultHeight: 480,
    initialProps: { greeting: 'hello' },
    css: 'window { background: red; }',
    devtools: true,
    about: { applicationName: 'Example' },
    quitAction: false,
    flags: 0,
    onStartup: () => {},
    anOptionThisFileHasNeverHeardOf: 1,
} as unknown as RunApplicationOptions;

/** The routed tree the chrome vectors need — the SHAPE, not what is on the screen. */
const ROUTED_MANIFEST: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Stack,
                    null,
                    createElement(Stack.Screen, { key: 'i', name: 'index', options: { title: 'Home' } }),
                ),
        },
    },
    { contextKey: 'index.tsx', module: { default: () => createElement('GtkLabel', { label: 'home' }) } },
];

const RoutedApp = (): ReactElement => createElement(RouterRoot, { manifest: ROUTED_MANIFEST });

/** What `runApplication` passes on, minus the half the shell owns. */
const WINDOW_OPTIONS: RunApplicationOptions = { applicationId: 'org.gjsify.ReactNativeVector', title: 'vector' };

/**
 * Pump the GLib main context until `done`, then say how many turns it took.
 *
 * `-1` for "never", so a scheduler that does not run FAILS a vector rather than hanging
 * one — `router/router.spec.ts` keeps the same helper for the same reason.
 */
async function settle(done: () => boolean, budget = 200): Promise<number> {
    const context = GLib.MainContext.default();
    for (let turn = 0; turn < budget; turn++) {
        if (done()) return turn;
        context.iteration(false);
        await Promise.resolve();
    }
    return done() ? budget : -1;
}

/** A registered, never-run application — all `mountApplicationRoot` needs of one. */
function vectorApplication(id: string): Adw.Application {
    const app = new Adw.Application({ applicationId: id, flags: Gio.ApplicationFlags.NON_UNIQUE });
    app.register(null);
    return app;
}

/**
 * Run the bootstrap's two halves over one window, and DESTROY it whatever happens.
 *
 * The `finally` is not tidiness: `Gtk.Window.get_toplevels()` is GTK's own live list
 * and `Dimensions` reads the application window off it, so a window left behind by a
 * failing assertion here fails four cases in `apis.spec.ts` instead — measured, on the
 * very run that proved these vectors red.
 */
async function mounted(id: string, body: (window: Gtk.Window, app: Adw.Application) => Promise<void>): Promise<void> {
    const app = vectorApplication(id);
    let window: Gtk.Window | null = null;
    try {
        await ownTheApplication(id, async () => {
            window = mountApplicationRoot(app, id, WINDOW_OPTIONS, () => RoutedApp);
            await body(window, app);
            return 0;
        });
    } finally {
        (window as Gtk.Window | null)?.destroy();
    }
}

export default async () => {
    await describe('AppRegistry — the shell options', async () => {
        await it('forwards every option it was given, plus createWindow', async () => {
            const shell = toShellOptions(OPTIONS, CREATE_WINDOW);
            const expected = [...Object.keys(OPTIONS), 'createWindow'].sort();
            expect(Object.keys(shell).sort()).toStrictEqual(expected);
        });

        await it('forwards the option VALUES unchanged', async () => {
            const shell = toShellOptions(OPTIONS, CREATE_WINDOW) as unknown as Record<string, unknown>;
            const source = OPTIONS as unknown as Record<string, unknown>;
            for (const key of Object.keys(source)) expect(shell[key]).toBe(source[key]);
        });

        await it('answers createWindow itself, so a consumer cannot replace the React root', async () => {
            // Typed through `never`: `createWindow` is `Omit`ted from
            // `RunApplicationOptions` precisely so this cannot be written by
            // accident. It can still be written by a plain JS consumer, and the
            // spread order is what makes that harmless.
            const withOwnWindow = { ...OPTIONS, createWindow: OTHER_WINDOW } as never;
            expect(toShellOptions(withOwnWindow, CREATE_WINDOW).createWindow).toBe(CREATE_WINDOW);
        });

        await it('does not mutate the options it was handed', async () => {
            const before = Object.keys(OPTIONS).length;
            toShellOptions(OPTIONS, CREATE_WINDOW);
            expect(Object.keys(OPTIONS).length).toBe(before);
            expect('createWindow' in OPTIONS).toBeFalsy();
        });
    });

    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        await describe('AppRegistry — the window the bootstrap builds (#1546, #1549)', async () => {
            await it('publishes the window chrome, so a routed tree draws ONE set of controls', async () => {
                await mounted('org.gjsify.ReactNativeChromeVector', async (window, app) => {
                    window.present();
                    expect((await settle(() => window.get_mapped())) >= 0).toBe(true);

                    const census = windowChromeCensus(window);
                    expect(census.mapped).toBe(true);
                    // ONE bar, because the router claimed the window's own — which it can
                    // only do because `provideWindowChrome` published the hand-over from
                    // the render call. MEASURED with that call deleted: 2 header bars and
                    // 2 sets of controls at the end side, which is #1460 exactly.
                    expect(census.headerBars).toBe(1);
                    // Non-vacuous: a host drawing no buttons at all would answer 0 and
                    // make the empty problem list below meaningless. WHICH side carries
                    // them is `gtk-decoration-layout` and not this vector's business.
                    expect(Math.max(census.start, census.end)).toBe(1);
                    expect(census.start + census.end >= 1).toBe(true);
                    expect(windowChromeProblems(window)).toStrictEqual([]);

                    // The accessors ADR 0043 added, answered off this composition.
                    expect(AppRegistry.getApplication()).toBe(app);
                    expect(AppRegistry.getWindow()).toBe(window);
                });
            });

            await it('runs the chrome check ITSELF, and reports what it found (#1546)', async () => {
                // The instrument had two callers for its whole life and both were specs.
                // This asserts what the shipping caller FOUND, not that it was called: a
                // check whose only evidence is having run is the green that measured
                // nothing.
                const checked = windowChromeChecks();
                await mounted('org.gjsify.ReactNativeChromeCheckVector', async (window) => {
                    window.present();
                    // WAIT FOR THE COUNT, not for the window plus a fixed pump. The list
                    // answers `[]` both for a clean composition and for one nothing
                    // checked, so a case that only reads the list stays green with the
                    // shipping call deleted — MEASURED: with `checkWindowChrome(window)`
                    // removed from `mountApplicationRoot` this very case still passed,
                    // which is #1546's own defect reintroduced inside #1546's vector. The
                    // count fails there, and it is also what stops this reading the answer
                    // a previous case left behind.
                    expect((await settle(() => windowChromeChecks() > checked)) >= 0).toBe(true);
                    // MEASURED with `provideWindowChrome` deleted: one sentence, "2 sets of
                    // window controls draw at the end of their header bar … 1 of those
                    // close buttons close nothing the user is looking at (2 mapped header
                    // bar(s))".
                    expect(lastWindowChromeProblems()).toStrictEqual([]);
                });
            });
        });

        await describe('AppRegistry — one application per process (#1551)', async () => {
            await it('refuses a SECOND launch by name instead of taking the first one’s handle', async () => {
                let release = (): void => {};
                const first = ownTheApplication(
                    'first',
                    () => new Promise<number>((resolve) => (release = () => resolve(0))),
                );
                let refusal = '';
                try {
                    await ownTheApplication('second', () => Promise.resolve(0));
                } catch (error) {
                    refusal = (error as Error).message;
                }
                release();
                expect(await first).toBe(0);
                expect(refusal).toContain('was called while "first" is still running');
            });

            await it('lets the NEXT launch through once the first has left', async () => {
                expect(await ownTheApplication('again', () => Promise.resolve(7))).toBe(7);
            });

            await it('releases the slot when the launch REJECTS, rather than leaking it', async () => {
                // The half #1551 could only reason about, because no throw path through
                // `runAdwaitaApp` survives GJS swallowing exceptions inside a GObject
                // handler. With the launcher as a parameter it is one line.
                let thrown = '';
                try {
                    await ownTheApplication('rejects', () => Promise.reject(new Error('launch failed')));
                } catch (error) {
                    thrown = (error as Error).message;
                }
                expect(thrown).toBe('launch failed');
                expect(AppRegistry.getApplication()).toBe(null);
                expect(AppRegistry.getWindow()).toBe(null);
                expect(await ownTheApplication('after-the-rejection', () => Promise.resolve(0))).toBe(0);
            });

            await it('clears the handle a launch built, so no accessor answers a dead window', async () => {
                await mounted('org.gjsify.ReactNativeHandleVector', async (window, app) => {
                    expect(AppRegistry.getWindow()).toBe(window);
                    expect(AppRegistry.getApplication()).toBe(app);
                });
                expect(AppRegistry.getApplication()).toBe(null);
                expect(AppRegistry.getWindow()).toBe(null);
            });
        });
    });
};
