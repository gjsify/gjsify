// @gjsify/adwaita-app — the configured Adw.Application base + runAdwaitaApp().
// Wires the boilerplate every native Adwaita app repeats: the runAsync
// lifecycle (NOT sync run() — a synchronous view load hangs its spinner under
// run(), because GJS does not flush the promise-job queue), a startup CSS
// bootstrap, the opt-in @gjsify/devtools control plane, get-or-create window on
// activate, and the standard app.quit (<primary>q) + app.about actions.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
// The bare `system` built-in, not `imports.system`/`ARGV` (ARGV IS
// `system.programArgs` on gjs) — resolves on gjs AND the `--app node` reverse
// bridge (AGENTS.md § The legacy imports.* object is NOT an API).
import system from 'system';
import { type InstallDevtoolsOptions, installDevtools } from '@gjsify/devtools';
import type { AboutInfo } from './types.js';

/** Options for {@link AdwaitaApp} / {@link runAdwaitaApp}. */
export interface AdwaitaAppOptions {
    /** GApplication id, e.g. `org.example.App`. */
    applicationId: string;
    /** GApplication flags. Default `Gio.ApplicationFlags.DEFAULT_FLAGS`. */
    flags?: Gio.ApplicationFlags;
    /** Build the main window on first `activate`. Called once. */
    createWindow: (app: Adw.Application) => Gtk.Window;
    /** CSS string applied display-wide on `startup` (via `Gtk.CssProvider`). */
    css?: string;
    /** When set, wires an `app.about` action opening an `Adw.AboutDialog`. */
    about?: AboutInfo;
    /** Wire `app.quit` (`<primary>q`). Default `true`. */
    quitAction?: boolean;
    /**
     * Devtools control plane: `true` force-enables, an object passes
     * {@link InstallDevtoolsOptions} through, omitted leaves it gated on the
     * `GJSIFY_DEVTOOLS` env var (safe in production either way).
     */
    devtools?: boolean | InstallDevtoolsOptions;
    /** Extra work on `startup`, after CSS + devtools are wired. */
    onStartup?: (app: Adw.Application) => void;
}

/**
 * A ready-to-run `Adw.Application` configured from {@link AdwaitaAppOptions}.
 * Prefer {@link runAdwaitaApp} unless you need the instance.
 */
export class AdwaitaApp extends Adw.Application {
    private readonly _options: AdwaitaAppOptions;
    private _window: Gtk.Window | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwaitaApp' }, AdwaitaApp);
    }

    constructor(options: AdwaitaAppOptions) {
        super({
            application_id: options.applicationId,
            flags: options.flags ?? Gio.ApplicationFlags.DEFAULT_FLAGS,
        });
        this._options = options;
        this._initActions();
        this.connect('startup', () => this._onStartup());
        this.connect('activate', () => this._onActivate());
    }

    private _initActions(): void {
        if (this._options.quitAction !== false) {
            const quit = new Gio.SimpleAction({ name: 'quit' });
            quit.connect('activate', () => this.quit());
            this.add_action(quit);
            this.set_accels_for_action('app.quit', ['<primary>q']);
        }
        if (this._options.about) {
            const about = new Gio.SimpleAction({ name: 'about' });
            about.connect('activate', () => this._showAbout());
            this.add_action(about);
        }
    }

    private _onStartup(): void {
        if (this._options.css) this._loadCss(this._options.css);
        this._installDevtools();
        this._options.onStartup?.(this);
    }

    private _loadCss(css: string): void {
        const display = Gdk.Display.get_default();
        if (!display) {
            console.error('@gjsify/adwaita-app: no default display; CSS not applied');
            return;
        }
        const provider = new Gtk.CssProvider();
        provider.load_from_string(css);
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }

    private _installDevtools(): void {
        const devtools = this._options.devtools;
        if (devtools === false) return;
        // Object → pass through; `true` → force-enable; omitted → env-gated no-op.
        const opts: InstallDevtoolsOptions =
            typeof devtools === 'object' ? devtools : { enabled: devtools || undefined };
        installDevtools(this, opts);
    }

    private _onActivate(): void {
        if (!this._window) this._window = this._options.createWindow(this);
        this._window.present();
    }

    private _showAbout(): void {
        const info = this._options.about;
        if (!info) return;
        const dialog = new Adw.AboutDialog({
            application_name: info.applicationName,
            application_icon: info.applicationIcon ?? this._options.applicationId,
        });
        if (info.version) dialog.version = info.version;
        if (info.developerName) dialog.developer_name = info.developerName;
        if (info.website) dialog.website = info.website;
        if (info.issueUrl) dialog.issue_url = info.issueUrl;
        if (info.license) dialog.license = info.license;
        if (info.comments) dialog.comments = info.comments;
        if (info.copyright) dialog.copyright = info.copyright;
        if (info.developers?.length) dialog.set_developers(info.developers);
        dialog.present(this.get_active_window());
    }
}

/**
 * Construct and run an {@link AdwaitaApp}, resolving with its exit code when the
 * last window closes. The whole per-project launcher collapses to:
 *
 * ```ts
 * import { runAdwaitaApp } from '@gjsify/adwaita-app';
 * await runAdwaitaApp({
 *     applicationId: 'org.example.App',
 *     createWindow: (app) => new MyWindow(app),
 * });
 * ```
 */
export async function runAdwaitaApp(options: AdwaitaAppOptions): Promise<number> {
    return runApplication(new AdwaitaApp(options), [system.programInvocationName, ...system.programArgs]);
}

/**
 * Run a `Gio.Application` on the `runAsync` lifecycle and SAY SO when the launch
 * was a single-instance handoff.
 *
 * GApplication is single-instance by default: launching a second time claims no
 * bus name, sends `activate` to the process that already owns it, and returns 0.
 * That is correct, and it is indistinguishable from a crash — the second launch
 * prints nothing, opens no window and exits successfully. A cross-platform run
 * of the homepage's showcases read exactly that as "exits 0 after ~2 s, no
 * window, no output, no error — worse than a crash, because nothing tells the
 * user anything went wrong", on a box where a storybook from another session was
 * still running. So the silence cost a real diagnosis, and this is the line that
 * removes it.
 *
 * `register()` BEFORE `run()`, because the answer is only available while the
 * application is registered: `run()` unregisters on the way out, and
 * `get_is_remote()` afterwards is a `g_application_get_is_remote: assertion
 * 'application->priv->is_registered' failed` returning false — measured. `run()`
 * registers by itself when nobody did, so doing it here changes nothing else.
 */
export async function runApplication(app: Gio.Application, argv: string[]): Promise<number> {
    let remote = false;
    try {
        app.register(null);
        remote = app.get_is_remote();
    } catch {
        // `g_application_register` is `throws="1"`: an unreachable session bus
        // lands here. `run()` meets the same wall and reports it in its own
        // terms, so the only thing lost is the notice below.
        remote = false;
    }
    const code = await app.runAsync(argv);
    if (remote) {
        console.error(
            `${app.applicationId ?? 'This application'} is already running — ` +
                'brought the existing instance to the front instead of opening a second window.',
        );
    }
    return code;
}

GObject.type_ensure(AdwaitaApp.$gtype);
