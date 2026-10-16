// `Gio.Application` / `Gtk.Application`, renderer-free — ADR 0098 §§ 1 and 3.
//
// A strict SUBSET with GJS's semantics: what is implemented behaves as on GJS (the oracle of
// `APPLICATION_VECTORS`), what is not throws naming itself. A port supplies an
// {@link ApplicationHost} (when the platform can show a window, and how it ends) as the static
// `host` of the class it exports; everything else lives here once.
//
// STATE LIVES IN A WEAKMAP, never in a class field: `GObjectObject`'s constructor sets the declared
// properties (`application-id`) from inside `super()`, before a subclass field initializer could run
// and overwrite what that wrote.
//
// Reference: GLib gio/gapplication.c (signal order, resource-base-path), GTK gtk/gtkapplication.c
// (windows, gtk_application_load_resources)

import {
    GIR_TYPE,
    GObjectObject,
    ParamFlags,
    ParamSpec,
    UnsupportedGObjectError,
    registerBaseClass,
    type SignalHandler,
} from './gobject.js';
import { AcceleratorMap } from './accelerators.js';
import { applicationOfWindow, findActionGroup, installActionMap, linkWindow } from './gio-actions.js';
import { resources_get_info } from './gio-resource.js';
import { keyvalOfKey } from './gtk-platform.js';
import { parseDetailedAction } from './menu.js';

/** `Gio.ApplicationFlags`: only the default is accepted (ADR 0098 § 1). */
export const ApplicationFlags = {
    NONE: 0,
    FLAGS_NONE: 0,
    DEFAULT_FLAGS: 0,
    IS_SERVICE: 1,
    IS_LAUNCHER: 2,
    HANDLES_OPEN: 4,
    HANDLES_COMMAND_LINE: 8,
    SEND_ENVIRONMENT: 16,
    NON_UNIQUE: 32,
    CAN_OVERRIDE_APP_ID: 64,
    ALLOW_REPLACEMENT: 128,
    REPLACE: 256,
} as const;

/** `Gtk.ApplicationInhibitFlags`: only `LOGOUT` means anything on a page (`gtk_application_inhibit`). */
export const ApplicationInhibitFlags = {
    LOGOUT: 1,
    SWITCH: 2,
    SUSPEND: 4,
    IDLE: 8,
} as const;

/** What a platform gives the application (ADR 0098 § 3). */
export interface ApplicationHost {
    readonly name: string;
    /** NativeScript's `create` has to return a root view: `activate` must add a window, or it rejects. */
    readonly requiresWindow: boolean;
    /**
     * Runs `body` (startup, then activate) when the platform is ready. It returns the active window,
     * which a platform that needs a root view hands on. A rejection is the application's rejection.
     */
    start(body: () => object | null): void | Promise<void>;
    /** `quit()` takes a window the application added off the platform. */
    detach(window: object): void;
    /** The application ended: a platform that has a process to end ends it. */
    exit(): void;
    /**
     * The `Gtk.IconTheme` of the default display, which startup adds `<resource-base-path>/icons/`
     * to (ADR 0116 § 4): `gtk_application_load_resources` asks
     * `gtk_icon_theme_get_for_display (gdk_display_get_default ())`. A platform without one draws
     * no resource icons, and startup skips it.
     */
    iconTheme?(): { add_resource_path(path: string): void };
    /**
     * `gtk_application_inhibit` with `LOGOUT`: whether leaving the page must be confirmed. Called
     * with `true` when the first logout inhibitor arrives and `false` when the last one goes. A
     * platform without it answers `inhibit()` with cookie 0 and ignores `uninhibit()`.
     */
    guardUnload?(active: boolean): void;
}

/** `g_application_id_is_valid`: dotted, two or more non-empty elements, none starting with a digit. */
export function isValidApplicationId(id: unknown): boolean {
    if (typeof id !== 'string' || id.length > 255 || id === '') return false;
    const elements = id.split('.');
    return elements.length >= 2 && elements.every((element) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(element));
}

function refuse(feature: string, detail: string): UnsupportedGObjectError {
    return new UnsupportedGObjectError(
        feature,
        `${feature} ${detail}, which is outside the Gio subset (ADR 0098 § 1).`,
    );
}

const REFUSED_METHODS = [
    'register',
    'hold',
    'release',
    'mark_busy',
    'unmark_busy',
    'open',
    'set_inactivity_timeout',
    'send_notification',
    'withdraw_notification',
    'register_session',
    'set_option_context_parameter_string',
    'set_option_context_summary',
    'set_option_context_description',
    'add_main_option',
    'add_main_option_entries',
    'add_option_group',
    'set_flags',
    'get_is_remote',
    'get_is_registered',
    'get_dbus_connection',
    'get_dbus_object_path',
    'bind_busy_property',
    'add_action_entries',
    'set_default',
] as const;

const REFUSED_PROPERTIES = ['is_remote', 'is_registered', 'is_busy', 'inactivity_timeout', 'action_group'] as const;

const REFUSED_SIGNALS = ['open', 'command-line', 'handle-local-options', 'shutdown', 'name-lost'] as const;

const GTK_REFUSED_METHODS = [
    'set_menubar',
    'get_menubar',
    'get_menu_by_id',
    'set_app_menu',
    'get_app_menu',
    'get_menu_by_id',
] as const;

interface AppState {
    id: string | null;
    /** `undefined` until construction ends, which derives it from the id unless one was given. */
    resourceBasePath: string | null | undefined;
    windows: object[];
    /** Cookie to flags of the active `gtk_application_inhibit` calls. */
    inhibitors: Map<number, number>;
    running: boolean;
    resolve: (code: number) => void;
}

const STATE = new WeakMap<object, AppState>();
let defaultApplication: object | null = null;
let lastCookie = 0;

function rememberDefault(app: object): void {
    defaultApplication ??= app;
}

function stateOf(app: object): AppState {
    let state = STATE.get(app);
    if (state === undefined) {
        state = {
            id: null,
            resourceBasePath: undefined,
            windows: [],
            inhibitors: new Map(),
            running: false,
            resolve: () => {},
        };
        STATE.set(app, state);
    }
    return state;
}

const ACCELERATORS = new WeakMap<object, AcceleratorMap>();

function acceleratorsOf(app: object): AcceleratorMap {
    let map = ACCELERATORS.get(app);
    if (map === undefined) {
        map = new AcceleratorMap();
        ACCELERATORS.set(app, map);
    }
    return map;
}

/**
 * `gtk_application_window`'s accelerator pass: a key press in `window` activates the first enabled
 * action whose accelerator it matches, found as `gtk_widget_activate_action` finds it (`win.` on the
 * window, `app.` on its application), with the target of the detailed name. Returns whether one ran.
 */
export function dispatchAccelerator(
    window: object,
    event: { readonly key: string; readonly state: number; readonly pressed: boolean },
    parent: (node: object) => object | null | undefined,
): boolean {
    if (!event.pressed) return false;
    const app = applicationOfWindow(window);
    if (app === null) return false;
    for (const detailed of acceleratorsOf(app).matching(keyvalOfKey(event.key), event.state)) {
        const parsed = parseDetailedAction(detailed);
        const dot = parsed?.name.indexOf('.') ?? -1;
        if (parsed === null || dot <= 0) continue;
        const action = findActionGroup(window, parsed.name.slice(0, dot), parent)?.lookup_action(
            parsed.name.slice(dot + 1),
        );
        if (!action || !action.enabled) continue;
        action.activate(parsed.target ?? null);
        return true;
    }
    return false;
}

function hostOf(app: object): ApplicationHost {
    const host = (app.constructor as { host?: ApplicationHost }).host;
    if (host === undefined) {
        throw new Error('Gio.Application: this class has no ApplicationHost; use the Gtk.Application of a port.');
    }
    return host;
}

/** `Gio.Application`: the lifecycle, `application_id`, `Gio.ActionMap` and `Gio.ActionGroup`. */
export class GioApplicationBase extends GObjectObject {
    static [GIR_TYPE] = 'Gio.Application';
    static host: ApplicationHost | undefined;

    static id_is_valid(id: string): boolean {
        return isValidApplicationId(id);
    }

    static get_default(): object | null {
        return defaultApplication;
    }

    constructor(params?: Record<string, unknown>) {
        super(params);
        rememberDefault(this);
        // `g_application_constructed`: the default comes from the id once, at construction; a
        // `resource-base-path` passed to the constructor is set after it and wins.
        const state = stateOf(this);
        if (state.resourceBasePath === undefined) {
            state.resourceBasePath = state.id === null ? null : `/${state.id.split('.').join('/')}`;
        }
    }

    get application_id(): string | null {
        return stateOf(this).id;
    }

    set application_id(id: string | null | undefined) {
        const value = id ?? null;
        if (value !== null && !isValidApplicationId(value)) {
            throw new Error(
                `Gio.Application: '${String(value)}' is not a valid application id (g_application_id_is_valid)`,
            );
        }
        const state = stateOf(this);
        if (state.running) throw new Error('Gio.Application: the application id cannot change while it runs');
        if (state.id === value) return;
        state.id = value;
        this.notify('application-id');
    }

    get flags(): number {
        return 0;
    }

    set flags(value: number | undefined) {
        // GJS reads `DEFAULT_FLAGS` as undefined on a GLib older than 2.74; it means NONE.
        if (value !== undefined && value !== ApplicationFlags.NONE) {
            throw refuse(`Gio.ApplicationFlags value ${String(value)}`, 'is a flag other than the default');
        }
    }

    get_application_id(): string | null {
        return this.application_id;
    }

    set_application_id(id: string | null): void {
        this.application_id = id;
    }

    get_flags(): number {
        return 0;
    }

    get resource_base_path(): string | null {
        return stateOf(this).resourceBasePath ?? null;
    }

    set resource_base_path(path: string | null | undefined) {
        const value = path ?? null;
        if (value !== null && !value.startsWith('/')) {
            throw new Error(`Gio.Application: resource base path '${value}' does not start with '/'`);
        }
        const state = stateOf(this);
        if (state.resourceBasePath === value) return;
        state.resourceBasePath = value;
        this.notify('resource-base-path');
    }

    get_resource_base_path(): string | null {
        return this.resource_base_path;
    }

    set_resource_base_path(resource_path: string | null): void {
        this.resource_base_path = resource_path;
    }

    /** `startup`: `RUN_FIRST`, so the class closure runs before the handlers. */
    vfunc_startup(): void {}

    /** `activate`: `RUN_LAST`, so the handlers run before the class closure. */
    vfunc_activate(): void {}

    run(): never {
        throw refuse('Gio.Application.run()', 'blocks, and a page cannot; use runAsync()');
    }

    connect(signal: string, handler: SignalHandler): number {
        const name = signal.split('::')[0] ?? signal;
        if ((REFUSED_SIGNALS as readonly string[]).includes(name)) {
            throw refuse(`the '${name}' signal`, 'is not emitted');
        }
        return super.connect(signal, handler);
    }

    /** `runAsync`: startup once, activate once, then alive while it has a window or until `quit()`. */
    async runAsync(_argv: readonly string[] = []): Promise<number> {
        const state = stateOf(this);
        if (state.running) throw new Error('Gio.Application.runAsync(): the application is already running');
        const host = hostOf(this);
        state.running = true;
        const done = new Promise<number>((resolve) => {
            state.resolve = resolve;
        });

        let failure: unknown;
        let failed = false;
        const body = (): object | null => {
            try {
                this.vfunc_startup();
                this.emit('startup');
                this.emit('activate');
                this.vfunc_activate();
                // An application that already ended inside `activate` (the last window left) has
                // nothing to show, so it owes the platform no window.
                if (state.running && state.windows.length === 0 && host.requiresWindow) {
                    throw new Error(
                        `Gio.Application.runAsync(): activate added no window on ${host.name}; ` +
                            'a window must be added synchronously by activate (ADR 0098 § 3).',
                    );
                }
            } catch (error) {
                failure = error;
                failed = true;
            }
            return state.windows[0] ?? null;
        };
        try {
            await host.start(body);
        } catch (error) {
            failure = error;
            failed = true;
        }
        if (failed) {
            state.running = false;
            host.exit();
            throw failure;
        }
        // GIO ends an application that holds nothing; a window is what holds it here.
        if (state.windows.length === 0) this._finish(0);
        return done;
    }

    /** `quit()`: the windows it was given leave the platform, and `runAsync` resolves with 0. */
    quit(): void {
        const state = stateOf(this);
        if (!state.running) return;
        for (const window of state.windows.splice(0)) {
            linkWindow(window, null);
            hostOf(this).detach(window);
        }
        this._finish(0);
    }

    _finish(code: number): void {
        const state = stateOf(this);
        if (!state.running) return;
        state.running = false;
        state.resolve(code);
        hostOf(this).exit();
    }
}

registerBaseClass(GioApplicationBase as never, 'GApplication', { startup: [], activate: [] }, [
    ParamSpec.string('application-id', '', '', ParamFlags.READWRITE | ParamFlags.CONSTRUCT, null),
    ParamSpec.uint('flags', '', '', ParamFlags.READWRITE | ParamFlags.CONSTRUCT, 0, 0xffffffff, 0),
    ParamSpec.string('resource-base-path', '', '', ParamFlags.READWRITE, null),
]);
installActionMap(GioApplicationBase.prototype, true);

function refuseMembers(proto: object, methods: readonly string[], properties: readonly string[]): void {
    for (const name of methods) {
        Object.defineProperty(proto, name, {
            value: () => {
                throw refuse(`${name}()`, 'is not implemented');
            },
            writable: true,
            configurable: true,
            enumerable: false,
        });
    }
    for (const name of properties) {
        Object.defineProperty(proto, name, {
            get() {
                throw refuse(`the '${name}' property`, 'is not implemented');
            },
            configurable: true,
            enumerable: false,
        });
    }
}
refuseMembers(GioApplicationBase.prototype, REFUSED_METHODS, REFUSED_PROPERTIES);

// TypeScript's mixin rule: a constructor with a single rest parameter of `any[]`.
// oxlint-disable-next-line typescript/no-explicit-any
type GioApplicationConstructor = new (...args: any[]) => GioApplicationBase;

/** What `withGtkApplication` adds, named so the emitted `.d.ts` of a subclass refers to it. */
export interface GtkApplicationMembers {
    readonly active_window: object | null;
    set_accels_for_action(detailed_action_name: string, accels: string[]): void;
    get_accels_for_action(detailed_action_name: string): string[];
    get_actions_for_accel(accel: string): string[];
    list_action_descriptions(): string[];
    get_active_window(): object | null;
    get_windows(): object[];
    add_window(window: object): void;
    remove_window(window: object): void;
    inhibit(window: object | null, flags: number, reason?: string | null): number;
    uninhibit(cookie: number): void;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type GtkApplicationConstructor = new (...args: any[]) => GtkApplicationMembers;

/**
 * `Gtk.Application` over a `Gio.Application` of a port, so the chain `Gio` → `Gtk` → `Adw` is one
 * prototype chain and `instanceof` answers as it does on GJS: the windows, and the application
 * they belong to.
 */
// The return type is written out: inferred, a subclass's `.d.ts` inlines the whole class and emits
// every accessor as `set x(v): any`, which TypeScript rejects (TS1095) in a consumer without `skipLibCheck`.
export function withGtkApplication<T extends GioApplicationConstructor>(Base: T): T & GtkApplicationConstructor {
    class GtkApplication extends Base {
        /** `gtk_application_startup`: the parent's startup, then `gtk_application_load_resources`. */
        override vfunc_startup(): void {
            super.vfunc_startup();
            loadResources(this);
        }

        get active_window(): object | null {
            return stateOf(this).windows[0] ?? null;
        }

        get_active_window(): object | null {
            return this.active_window;
        }

        set_accels_for_action(detailed: string, accels: string[]): void {
            acceleratorsOf(this).setAccels(detailed, accels);
        }

        get_accels_for_action(detailed: string): string[] {
            return acceleratorsOf(this).getAccels(detailed);
        }

        get_actions_for_accel(accel: string): string[] {
            return acceleratorsOf(this).actionsFor(accel);
        }

        list_action_descriptions(): string[] {
            return acceleratorsOf(this).listActions();
        }

        get_windows(): object[] {
            return [...stateOf(this).windows];
        }

        /** `gtk_application_add_window`: the newest window is the active one, as on GTK. */
        add_window(window: object): void {
            const state = stateOf(this);
            if (state.windows.includes(window)) return;
            state.windows.unshift(window);
            linkWindow(window, this as never);
        }

        /**
         * `gtk_application_inhibit`: a `LOGOUT` inhibitor makes the page ask before it is left. The
         * browser shows its own text, so `reason` is accepted and never displayed. The other flags
         * mean nothing on a page: they get a cookie and do nothing. A host that cannot guard an
         * unload returns 0, which GTK documents for a session that cannot inhibit.
         */
        inhibit(_window: object | null, flags: number, _reason?: string | null): number {
            const host = hostOf(this);
            if (host.guardUnload === undefined) return 0;
            const state = stateOf(this);
            const before = guarded(state);
            const cookie = ++lastCookie;
            state.inhibitors.set(cookie, flags);
            if (guarded(state) !== before) host.guardUnload(!before);
            return cookie;
        }

        /** `gtk_application_uninhibit`: an unknown cookie is ignored (GTK warns). */
        uninhibit(cookie: number): void {
            const host = hostOf(this);
            if (host.guardUnload === undefined) return;
            const state = stateOf(this);
            const before = guarded(state);
            if (!state.inhibitors.delete(cookie)) return;
            if (guarded(state) !== before) host.guardUnload(!before);
        }

        /** `gtk_application_remove_window`: the last window to go ends a running application. */
        remove_window(window: object): void {
            const state = stateOf(this);
            const at = state.windows.indexOf(window);
            if (at === -1) return;
            state.windows.splice(at, 1);
            linkWindow(window, null);
            if (state.windows.length === 0) this._finish(0);
        }
    }
    refuseMembers(GtkApplication.prototype, GTK_REFUSED_METHODS, []);
    return GtkApplication;
}

function guarded(state: AppState): boolean {
    for (const flags of state.inhibitors.values()) if (flags & ApplicationInhibitFlags.LOGOUT) return true;
    return false;
}

function hasResource(path: string): boolean {
    try {
        return resources_get_info(path, 0)[0];
    } catch {
        return false;
    }
}

/**
 * `gtk_application_load_resources`: `<base>/icons/` joins the icon theme's resource path. The menus
 * and the help overlay it would also load are refused while present (ADR 0116 § 5), never ignored.
 */
function loadResources(app: GioApplicationBase): void {
    const base = app.resource_base_path;
    if (base === null) return;
    const slash = base.endsWith('/') ? '' : '/';
    hostOf(app).iconTheme?.().add_resource_path(`${base}${slash}icons/`);
    for (const file of ['gtk/menus.ui', 'gtk/help-overlay.ui']) {
        const path = `${base}${slash}${file}`;
        if (hasResource(path)) {
            throw new UnsupportedGObjectError(
                `Gtk.Application resource ${file}`,
                `Gtk.Application: GTK loads ${path} at startup, and this port does not yet (ADR 0116 § 5).`,
            );
        }
    }
}

/** The core's own `Gtk.Application`, over the core's `Gio.Application`. */
export class GtkApplicationBase extends withGtkApplication(GioApplicationBase) {}
