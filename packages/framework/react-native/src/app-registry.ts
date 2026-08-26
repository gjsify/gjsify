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

// VALUES through `gi://`, types through `@girs/*` — and this is a machine-checked
// constraint, not a style. `scripts/audit-runtimes.mjs` only tolerates this
// package's `node: "polyfill"` slot while its shipping source has `gi_url` and NOT
// `girs_value`: a value import from `@girs/*` flips the signal and the declared
// runtime table drifts from the suggested one, which fails `runtimes-drift`.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';
import { createRoot, type ReactRoot } from '@gjsify/gtk-host/react';
import { createElement, type ComponentType } from 'react';

import { UnsupportedError } from './unsupported.js';

/** What `registerComponent` is handed: a function returning the root component. */
export type ComponentProvider = () => ComponentType<Record<string, unknown>>;

/** The gjsify-shaped half of `runApplication`'s parameters. */
export interface RunApplicationOptions {
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
    /** CSS applied display-wide on startup. The class compiler's output goes here. */
    css?: string;
}

interface Registration {
    readonly provider: ComponentProvider;
}

const registry = new Map<string, Registration>();

/**
 * The window a registered component renders into.
 *
 * An `Adw.ApplicationWindow` with an `Adw.ToolbarView` and a header bar — the
 * ordinary Adwaita shell, not a bare window, because a desktop window without a
 * header bar cannot be moved or closed on every compositor. React renders into the
 * toolbar view's CONTENT, so the application's own chrome survives the first commit
 * (`clearContainer` clears the host's shadow children, never the adopted ones).
 */
function buildWindow(
    app: Adw.Application,
    key: string,
    options: RunApplicationOptions,
): { window: Gtk.Window; content: Gtk.Widget } {
    const window = new Adw.ApplicationWindow({
        application: app,
        title: options.title ?? key,
        defaultWidth: options.defaultWidth ?? 900,
        defaultHeight: options.defaultHeight ?? 700,
    });
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    toolbar.set_content(content);
    window.set_content(toolbar);
    return { window, content };
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

        // An object rather than a `let`: TypeScript does not track an assignment
        // made inside the `createWindow` closure, so a `let root: ReactRoot | null`
        // stays narrowed to `null` and `root?.unmount()` is an error on `never`.
        const mounted: { root: ReactRoot | null } = { root: null };
        const code = await runAdwaitaApp({
            applicationId: options.applicationId,
            css: options.css,
            createWindow: (app) => {
                const { window, content } = buildWindow(app, appKey, options);
                const Component = registration.provider();
                mounted.root = createRoot(content);
                // `createElement`, not a hand-built element literal and not a JSX
                // runtime. The literal's `$$typeof` symbol is React-version-specific
                // (`react.element` became `react.transitional.element` in 19) and a
                // JSX runtime would tie this module to a dialect the consumer has not
                // chosen. `createElement` is neither.
                mounted.root.render(createElement(Component, options.initialProps ?? {}));
                return window;
            },
        });
        mounted.root?.unmount();
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
 * `.gtk` variant just to start.
 */
export function registerRootComponent(
    component: ComponentType<Record<string, unknown>>,
    options: RunApplicationOptions,
): Promise<number> {
    AppRegistry.registerComponent('main', () => component);
    return AppRegistry.runApplication('main', options);
}
