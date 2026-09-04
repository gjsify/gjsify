// `AppRegistry` — the entry point, and the one place this layer cannot be a
// faithful copy.
//
// React Native's `AppRegistry.runApplication(key, { rootTag, initialProps })` is
// handed a root tag by a native host that already exists: an Activity on Android, a
// `UIViewController` on iOS. Nothing here has been started yet. So `runApplication`
// must CREATE the application and its window, which means it needs one fact React
// Native never has to ask for — the GApplication id.
//
// That divergence is declared rather than hidden. `runApplication` takes gjsify's
// own options object, and the ADR 0032 § 8 support table says `AppRegistry` is
// `partial` with exactly this limit written out, so a reader finds it before their
// code does.
//
// WHY `runAsync` AND NOT `run()`. `runAdwaitaApp` is on the async lifecycle because
// GJS does not flush the promise-job queue under a synchronous `Gio.Application.run`
// — a view that loads asynchronously hangs on its spinner forever. A React root is
// exactly that shape: the first commit is synchronous but everything an application
// does afterwards is not. ADR 0009 records the incident; this comment exists so the
// next person does not "simplify" the await away.
//
// THE APPLICATION IS REACHABLE, AND THAT IS THE POINT (#1455, ADR 0043). Because on
// a desktop the application is the host, this layer OWNS the one object every other
// GTK application in this repo is handed — so a React Native application on it must
// be able to reach it too, or it is the only kind that cannot be driven,
// screenshotted or inspected from outside. Two shapes, deliberately not one: the
// shell's own options travel through `RunApplicationOptions` for anything that must
// happen at a lifecycle moment (`devtools`, `onStartup`), and `getApplication()` /
// `getWindow()` answer "which application am I in" from anywhere in the tree.

// THE WINDOW'S CHROME IS CHECKED WHERE IT IS BUILT (#1546, #1549). `@gjsify/gtk-host/
// conformance`'s `windowChromeProblems()` is the right instrument for "can the user
// close this window, and is there exactly one button that does" — and for its whole
// life the only thing that pointed it anywhere was a hand-written vector, so the
// composition it was written for (this one) was the one composition it never saw. That
// is settled here rather than left as a choice: this function is the ONE composer of a
// React Native window on this layer, so it runs the reader itself, once, when the
// window maps.
//
// ONCE AND NOT PER COMMIT, and the reason is the instrument's own: the invariant is
// about the RESTING composition, and `Adw.NavigationView` keeps a departing page mapped
// while the arriving one slides in — so a window mid-push legitimately draws two header
// bars and a per-commit check would report a defect for every animation. At map time
// there is no transition in flight (the router's first stack sync is explicitly
// unanimated), which is what makes this moment both cheap and free of false positives.
// It is also the moment the defect it was built for surfaces: #1460 was an application
// that OPENED with two close buttons. A composition that goes wrong later is what a
// driveable check answers, and that is a `@gjsify/devtools` method rather than a walk
// per frame — see `status/open-todos.md`.
//
// NO GATE, deliberately. One tree walk per window is not worth a switch, and a switch
// is one more thing that is off in the configuration where the check was needed.
//
// VALUES through `gi://`, types through `@girs/*` — and this is a machine-checked
// constraint, not a style. `scripts/audit-runtimes.mjs` only tolerates this
// package's `node: "polyfill"` slot while its shipping source has `gi_url` and NOT
// `girs_value`: a value import from `@girs/*` flips the signal and the declared
// runtime table drifts from the suggested one, which fails `runtimes-drift`.
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import type Gtk from '@girs/gtk-4.0';
import { type AdwaitaAppOptions, runAdwaitaApp } from '@gjsify/adwaita-app';
import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { windowChromeProblems } from '@gjsify/gtk-host/conformance';
import { createRoot, type ReactRoot } from '@gjsify/gtk-host/react';
import { createElement, type ComponentType } from 'react';

import { UnsupportedError } from './unsupported.js';
import { buildWindowShell, provideWindowChrome, type WindowChrome } from './window-chrome.js';

/** What `registerComponent` is handed: a function returning the root component. */
export type ComponentProvider = () => ComponentType<Record<string, unknown>>;

/**
 * `runApplication`'s parameters: React Native's `initialProps` plus the window
 * shape, over the WHOLE option set of the application shell this layer runs on.
 *
 * `Omit<AdwaitaAppOptions, 'createWindow'>` rather than a hand-copied list of the
 * fields worth forwarding, and that is the load-bearing part. The shell owns
 * `devtools`, `about`, `onStartup`, `quitAction`, `flags` and `css`, each wired at
 * the lifecycle moment only the shell knows — `installDevtools` in particular MUST
 * run in `startup`, because the bus connection and object path exist only after the
 * application has registered, which is inside `runAdwaitaApp` and unreachable from
 * a consumer's entry file. A forwarding list would have to grow every time the shell
 * gains an option, and the field nobody remembered to add is exactly the one a
 * consumer needs: `devtools` was that field, and its absence is why an application
 * on this layer could not be driven from outside (#1455). `createWindow` is the one
 * option this layer answers itself — it renders the registered component.
 */
export interface RunApplicationOptions extends Omit<AdwaitaAppOptions, 'createWindow'> {
    /**
     * GApplication id. REQUIRED, and the declared divergence from React Native:
     * a phone host supplies the application identity, a desktop one is the
     * application.
     */
    applicationId: string;
    /** Window title. Defaults to the registered app key. */
    title?: string;
    /** Initial window size. Defaults to 900x700, which is an ordinary desktop default. */
    defaultWidth?: number;
    defaultHeight?: number;
    /** Props handed to the root component — React Native's `initialProps`. */
    initialProps?: Record<string, unknown>;
}

interface Registration {
    readonly provider: ComponentProvider;
}

const registry = new Map<string, Registration>();

/**
 * The running application, its window and its React root — reachable while the
 * loop runs, `null` outside it.
 *
 * A live handle rather than a return value, because the two answers cannot be the
 * same object: `runApplication` resolves when the last window CLOSES, so anything
 * it returns arrives after the application it describes has stopped existing. An
 * entry file is `await registerRootComponent(App, { … })` and nothing else, so the
 * code that wants the application is somewhere else in the tree — a component, an
 * effect, a module wiring a controller — and a parameter cannot reach it. Hence a
 * module-scoped accessor, which is also what makes the divergence declared in
 * `runApplication`'s own comment reachable: on a desktop the application IS the
 * host, so a React Native application on this layer has one and every other GTK
 * application in this repo can use it.
 */
let live: LiveRoot | null = null;

/**
 * The key of the `runApplication` call that currently owns the loop, or `null`.
 *
 * A SECOND CONCURRENT CALL IS REFUSED BY NAME, which is the design question #1551 left
 * open and this is the answer: two React Native applications in one GJS process have no
 * defined meaning here — `AppRegistry` creates the application, and there is one
 * `GApplication` per process — so a named error beats a clear that only looks correct.
 *
 * What it looked like without one: both calls write `live`, whichever resolves first
 * reads `mounted = live` — by then the OTHER call's handle — and unmounts a React root
 * belonging to an application that is still running, leaving its window up and empty.
 * Not exotic either: `runAdwaitaApp` documents the single-instance handoff, where a
 * second launch returns promptly having built no window at all.
 *
 * Set BEFORE the await and cleared in a `finally`, so the refusal is answerable without
 * running a loop and a launch that REJECTS does not leave a dead application answering
 * `getApplication()` — the state this file's own comment calls worse than `null`.
 */
let running: string | null = null;

/**
 * What the last window-chrome check found, in the sentences it found them in.
 *
 * A reader rather than only a log, for the reason `announce.ts` keeps one: a window
 * whose chrome is right and a window nobody checked print the same nothing, and only an
 * answer tells them apart. Empty after a clean check, empty before the first one.
 */
let chromeProblems: readonly string[] = [];

/** Every problem the last mapped window's chrome had. Empty is the clean answer. */
export const lastWindowChromeProblems = (): readonly string[] => chromeProblems;

/**
 * Ask `windowChromeProblems()` about this window once it is on screen, and report.
 *
 * ON THE IDLE AFTER `map`, not in the handler: `map` runs while GTK is still bringing
 * the window up, and the census counts what DRAWS. The idle is the first moment the
 * answer means anything.
 *
 * The mapped re-check is not a paranoid probe: a window can be closed between the map
 * and the idle, and `windowChromeProblems` REFUSES an unmapped root by design — so
 * without it a fast open-and-close prints a problem about the measurement rather than
 * about the window.
 */
function checkWindowChrome(window: Gtk.Window): void {
    const id = window.connect('map', () => {
        window.disconnect(id);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!window.get_mapped()) return GLib.SOURCE_REMOVE;
            chromeProblems = windowChromeProblems(window);
            for (const problem of chromeProblems) console.warn(`@gjsify/react-native: ${problem}`);
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * What `runApplication` owns while the loop runs. NOT exported, and the two
 * members past the first are why.
 *
 * `getApplication()` and `getWindow()` hand out the two objects #1455 asks for,
 * both of which a consumer can only observe and configure. `content` and `root`
 * are the bootstrap's OWN working state: `root.render()` replaces the tree this
 * layer mounted, and `root.unmount()` tears it down while `live` still points at
 * it — after which `getWindow()` answers with a window whose content is gone,
 * which is the lying accessor `runApplication`'s cleanup exists to prevent. A
 * consumer reaching the container legitimately does it through the host element
 * gtk-host gives React (`adopt`), not through a raw widget handed out here.
 *
 * Un-exported because the asymmetry runs one way: adding an accessor later is
 * additive, removing one from a published API is not.
 */
interface LiveRoot {
    /** The application `runApplication` created. */
    readonly app: Adw.Application;
    /** Its window — an `Adw.ApplicationWindow`, typed as what every caller needs. */
    readonly window: Gtk.Window;
    /** The widget React renders into: the toolbar view's content box. */
    readonly content: Gtk.Widget;
    /** The mounted React root. */
    readonly root: ReactRoot;
}

/**
 * Everything `runApplication` hands the application shell, as a VALUE.
 *
 * A named function with a spec rather than an object literal inline, because the
 * defect it prevents is invisible at the call site: the previous shape listed
 * `applicationId` and `css` and dropped every other field, which reads as complete
 * and silently swallowed `devtools` — the option a consumer needs to be able to
 * drive their own application at all (#1455). `app-registry.spec.ts` asserts that
 * NOTHING is dropped, whatever it is, so re-introducing a field list fails for any
 * option rather than only for the ones a test happened to name.
 *
 * `createWindow` last: it is the one option this layer answers itself, and a
 * consumer's `createWindow` must not be able to replace the React root.
 */
export function toShellOptions(
    options: RunApplicationOptions,
    createWindow: (app: Adw.Application) => Gtk.Window,
): AdwaitaAppOptions {
    return { ...options, createWindow };
}

/**
 * The window a registered component renders into.
 *
 * An `Adw.ApplicationWindow` around `buildWindowShell()`'s toolbar view and header
 * bar — the ordinary Adwaita shell, not a bare window, because a desktop window
 * without a header bar cannot be moved or closed on every compositor.
 *
 * That bar is a DEFAULT and not a fixture: a tree that owns the window's chrome
 * itself — a routed application's outermost navigator does — claims it through the
 * returned `chrome` and the window lets it go. `window-chrome.ts` carries the reason.
 */
function buildWindow(
    app: Adw.Application,
    key: string,
    options: RunApplicationOptions,
): { window: Gtk.Window; content: Gtk.Widget; chrome: WindowChrome } {
    const window = new Adw.ApplicationWindow({
        application: app,
        title: options.title ?? key,
        defaultWidth: options.defaultWidth ?? 900,
        defaultHeight: options.defaultHeight ?? 700,
    });
    const shell = buildWindowShell();
    window.set_content(shell.root);
    return { window, content: shell.content, chrome: shell.chrome };
}

/**
 * Build the window, mount the registered component into it, publish the chrome.
 *
 * A NAMED FUNCTION AND NOT THE CLOSURE IT WAS, for the reason `window-chrome.ts` gives
 * one function earlier: the vectors have to measure THIS composition, and a spec that
 * rebuilt it by hand passes while the shipping shell drifts. That is #1549 as measured
 * — deleting `provideWindowChrome(chrome, …)` from the render call below left `oxfmt`
 * clean, `oxlint` at 0, `tsc` at 0 and the whole `@gjsify/react-native` suite green,
 * ten hand-written window-chrome vectors included, while the running application drew
 * two mapped `AdwHeaderBar`s: two sets of window controls, one dead close button
 * (#1460).
 *
 * The seam is HERE and not one call further out because `runApplication` cannot be
 * entered from a spec at all: it runs a `Gio.Application`, and a nested
 * `g_application_run` inside the test runner's own main loop never returns — measured,
 * `g_application_run: assertion '!application->priv->must_quit_now' failed` and a
 * timed-out case. Everything past this function is the shell's, and `toShellOptions`
 * already holds the hand-over to it.
 */
export function mountApplicationRoot(
    app: Adw.Application,
    appKey: string,
    options: RunApplicationOptions,
    provider: ComponentProvider,
): Gtk.Window {
    const { window, content, chrome } = buildWindow(app, appKey, options);
    const Component = provider();
    const root = createRoot(content);
    live = { app, window, content, root };
    // `createElement`, not a hand-built element literal and not a JSX runtime. The
    // literal's `$$typeof` symbol is React-version-specific (`react.element` became
    // `react.transitional.element` in 19) and a JSX runtime would tie this module to a
    // dialect the consumer has not chosen. `createElement` is neither.
    root.render(provideWindowChrome(chrome, createElement(Component, options.initialProps ?? {})));
    checkWindowChrome(window);
    return window;
}

/**
 * Hold the process's one application handle for the duration of ONE launch.
 *
 * THE LAUNCHER IS A PARAMETER, which is what makes this the shipping code rather than a
 * copy of it: `runApplication` hands it `runAdwaitaApp`, and a vector hands it a
 * launcher it can resolve or reject on cue — so both defects #1551 names are reachable
 * without a `Gio` main loop, which a spec cannot run (see `mountApplicationRoot`).
 *
 * Everything the handle owns is released in the `finally`, and that is the second
 * defect: a launch that REJECTS after the window was built used to leave `live` set, so
 * `getApplication()` kept answering with a dead application — the state this file's own
 * comment calls worse than answering `null`.
 */
export async function ownTheApplication(appKey: string, launch: () => Promise<number>): Promise<number> {
    if (running !== null) {
        throw new Error(
            `@gjsify/react-native: AppRegistry.runApplication("${appKey}") was called while "${running}" is ` +
                'still running. One process is one GApplication here — this layer CREATES the application, which ' +
                'is the declared divergence from React Native — so a second call has no window of its own to ' +
                'build and would take the first one\u2019s handle away from it. Await the first call, or render ' +
                'both trees under one root component.',
        );
    }
    running = appKey;
    try {
        return await launch();
    } finally {
        // Cleanup beside ownership: the handle belongs to THIS call, so it is this call
        // that clears it — and only if nothing has replaced it, which is what makes the
        // clear safe rather than merely tidy.
        const mounted = live;
        live = null;
        running = null;
        mounted?.root.unmount();
    }
}

export const AppRegistry = {
    /** Register a root component under `appKey`. React Native's own signature. */
    registerComponent(appKey: string, componentProvider: ComponentProvider): string {
        registry.set(appKey, { provider: componentProvider });
        return appKey;
    },

    /** Every registered key, in registration order. React Native's own signature. */
    getAppKeys(): string[] {
        return [...registry.keys()];
    },

    /** Whether `appKey` was registered. */
    getRunnable(appKey: string): Registration | undefined {
        return registry.get(appKey);
    },

    /**
     * The running application, or `null` before `activate` and after the loop ends.
     *
     * The accessor #1455 asks for: `installDevtools` needs a `Gio.Application` to
     * export on, `set_accels_for_action` needs one, and so does every action a
     * component adds. Prefer `options.devtools` / `options.onStartup` for work that
     * must happen at a specific lifecycle moment — this answers "which application
     * am I in", not "run this at startup".
     */
    getApplication(): Adw.Application | null {
        return live?.app ?? null;
    },

    /**
     * The window the registered component renders into, or `null` outside the loop.
     *
     * Non-null from the first render onwards and BEFORE the window maps, so a
     * component may set a default size, attach an `Gtk.EventController`, or connect
     * `close-request` — the adjacent half of #1455.
     */
    getWindow(): Gtk.Window | null {
        return live?.window ?? null;
    },

    /**
     * Create the application, mount the registered component, and run the loop.
     *
     * Resolves with the application's exit code, so a caller can `await` it and
     * still `return process.exit(code)` — a bare `process.exit()` in a GJS app is
     * the core-dump shape recorded in the CLI's own notes.
     */
    async runApplication(appKey: string, options: RunApplicationOptions): Promise<number> {
        const registration = registry.get(appKey);
        if (registration === undefined) {
            const known = [...registry.keys()];
            throw new Error(
                `@gjsify/react-native: no component is registered as "${appKey}". ` +
                    (known.length > 0
                        ? `Registered: ${known.join(', ')}.`
                        : 'Nothing is registered — call AppRegistry.registerComponent(key, () => Component) first.'),
            );
        }

        // The widget table, before anything can look a tag up in it. Every showcase
        // and every spec in this repo calls it explicitly and is right to — a
        // renderer may bind its own table (ADR 0027) — but a React Native entry file
        // cannot: `registerBuiltinWidgets` is not a React Native name, and this
        // function IS the bootstrap it would have to be called from. Without it the
        // first commit threw `GtkHostError: No descriptor registered for <GtkBox>`
        // from inside `createWindow`, GJS logged and SWALLOWED it (an exception in a
        // GObject handler skips the rest of the handler), so `present()` never ran:
        // the process stayed up with one UNMAPPED toplevel and no diagnostic beyond
        // that one logged trace. Idempotent — registration is keyed on the GType.
        registerBuiltinWidgets();

        return ownTheApplication(appKey, () =>
            runAdwaitaApp(
                toShellOptions(options, (app) => mountApplicationRoot(app, appKey, options, registration.provider)),
            ),
        );
    },

    /** React Native's teardown hook. Unmounts the tree; the loop is the caller's. */
    unmountApplicationComponentAtRootTag(): void {
        throw new UnsupportedError('AppRegistry');
    },
} as const;

/**
 * Expo's spelling: register under `"main"` and run.
 *
 * The one line an Expo entry file contains, so an application's `index.js` needs no
 * `.gtk` variant just to start. Resolves with the exit code, so the application is
 * reached through `AppRegistry.getApplication()` / `getWindow()` while it runs, and
 * through `options.devtools` / `options.onStartup` at startup — not through this
 * return value, which arrives after the application has stopped.
 */
export function registerRootComponent(
    component: ComponentType<Record<string, unknown>>,
    options: RunApplicationOptions,
): Promise<number> {
    AppRegistry.registerComponent('main', () => component);
    return AppRegistry.runApplication('main', options);
}
