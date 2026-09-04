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

// VALUES through `gi://`, types through `@girs/*` — and this is a machine-checked
// constraint, not a style. `scripts/audit-runtimes.mjs` only tolerates this
// package's `node: "polyfill"` slot while its shipping source has `gi_url` and NOT
// `girs_value`: a value import from `@girs/*` flips the signal and the declared
// runtime table drifts from the suggested one, which fails `runtimes-drift`.
import Adw from 'gi://Adw?version=1';
import type Gtk from '@girs/gtk-4.0';
import { type AdwaitaAppOptions, runAdwaitaApp } from '@gjsify/adwaita-app';
import { registerBuiltinWidgets } from '@gjsify/gtk-host';
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

        const code = await runAdwaitaApp(
            toShellOptions(options, (app) => {
                const { window, content, chrome } = buildWindow(app, appKey, options);
                const Component = registration.provider();
                const root = createRoot(content);
                live = { app, window, content, root };
                // `createElement`, not a hand-built element literal and not a JSX
                // runtime. The literal's `$$typeof` symbol is React-version-specific
                // (`react.element` became `react.transitional.element` in 19) and a
                // JSX runtime would tie this module to a dialect the consumer has not
                // chosen. `createElement` is neither.
                root.render(provideWindowChrome(chrome, createElement(Component, options.initialProps ?? {})));
                return window;
            }),
        );
        // Cleanup beside ownership: this function is the only writer of `live`, so it
        // is also the one that clears it. An accessor answering with a closed
        // application's window is worse than answering `null`.
        const mounted = live;
        live = null;
        mounted?.root.unmount();
        return code;
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
