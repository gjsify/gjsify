// @gjsify/devtools — the in-app org.gjsify.Devtools DBus service.
// Original implementation; method bodies adapt the PixelRPG map-editor's
// ControlDbusService (apps/maker-gjs/src/services/control-dbus.service.ts).

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';
import {
    type ActionList,
    type DevtoolsStatus,
    formatDbusErrorMessage,
    GENERIC_METHODS,
    type MethodKind,
} from '@gjsify/devtools-protocol';
import { activateAction, changeActionState, describeActions } from './actions.js';
import { buildDevtoolsIfaceXml } from './devtools-iface.js';
import type { DevtoolsExtension, InstallDevtoolsOptions } from './extension.js';
import { captureWidgetPng } from './screenshot.js';
import { dumpCss, swapCss } from './css.js';
import { dumpGSettings } from './gsettings.js';
import {
    activateWidget,
    dumpTree,
    getWidgetProperty,
    listToplevels,
    pathOfWidget,
    resolveWidgetPath,
    widgetType,
} from './widget-tree.js';

type ActionScope = 'app' | 'win';

/** Resolve after `ms`, yielding to the GLib main loop so layout/render can progress. */
function frameDelay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Capture `widget` to PNG, retrying across a handful of frames. A window that is
 * mapped but not yet realised/allocated (e.g. right after launch, or while a
 * heavy view is still being laid out) produces a zero-size GSK frame — giving it
 * a few main-loop iterations to lay out turns those transient empty captures into
 * a real screenshot. Returns null only if it never becomes renderable.
 */
async function captureWidgetWhenRenderable(widget: Gtk.Widget, tries = 12, gapMs = 50): Promise<Uint8Array | null> {
    for (let i = 0; i < tries; i++) {
        const png = captureWidgetPng(widget);
        if (png) return png;
        await frameDelay(gapMs);
    }
    return captureWidgetPng(widget);
}

/**
 * The permanent `org.gjsify.Devtools` DBus interface for a GTK app — lets
 * external tooling (the MCP bridge, `gdbus`, scripts) inspect, screenshot,
 * and drive the running app. Generic methods are implemented here; app
 * extensions contribute extra methods that are attached (pause-guarded) and
 * merged into the same interface. Resolves the live window lazily per call so
 * it survives window recreation.
 */
export class DevtoolsService {
    private _exported: Gio.DBusExportedObject | null = null;
    private readonly _extensions: readonly DevtoolsExtension[];
    private readonly _kinds = new Map<string, MethodKind>();

    constructor(
        private readonly _app: Gtk.Application,
        private readonly _options: InstallDevtoolsOptions,
    ) {
        this._extensions = _options.extend ?? [];
        for (const [name, kind] of Object.entries(GENERIC_METHODS)) this._kinds.set(name, kind);
        for (const ext of this._extensions) {
            for (const [name, kind] of Object.entries(ext.methodKinds)) this._kinds.set(name, kind);
            for (const [name, fn] of Object.entries(ext.handlers)) {
                const impl = fn as (...args: unknown[]) => unknown;
                (this as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = (...args: unknown[]) => {
                    this._guard(name);
                    return impl(...args);
                };
            }
        }
    }

    /** Export the interface at `objectPath` on `connection`. Idempotent. */
    export(connection: Gio.DBusConnection, objectPath: string): void {
        if (this._exported) return;
        const xml = buildDevtoolsIfaceXml(this._extensions.flatMap((e) => e.methodsXml ?? []));
        const exported = Gio.DBusExportedObject.wrapJSObject(xml, this);
        exported.export(connection, objectPath);
        this._exported = exported;
    }

    /** Tear the interface down. Idempotent. */
    unexport(): void {
        this._exported?.unexport();
        this._exported = null;
    }

    // --- generic DBus methods (names match buildDevtoolsIfaceXml) ---

    /** `GetStatus() -> s` — JSON snapshot of the app's live state. */
    GetStatus(): string {
        const win = this._app.get_active_window();
        const status: DevtoolsStatus = {
            appId: this._app.get_application_id() ?? 'unknown',
            instance: this._options.instance ?? 'default',
            activeWindow: win
                ? { id: win.get_name() || 'window', title: win.get_title() ?? '', mapped: win.get_mapped() }
                : null,
            toplevelCount: Gtk.Window.get_toplevels().get_n_items(),
            focusedWidget: null,
            paused: this._isPaused(),
        };
        for (const ext of this._extensions) {
            const extra = ext.contributeStatus?.();
            if (extra) Object.assign(status, extra);
        }
        return JSON.stringify(status);
    }

    /** `Screenshot(scope) -> ay` — PNG bytes of the active window via the GSK renderer. */
    async Screenshot(_scope: string): Promise<Uint8Array> {
        const win = this._app.get_active_window();
        if (!win) return new Uint8Array(0);
        // Fast path: already renderable. Otherwise present it and retry across a
        // few frames — a just-launched or mid-layout window yields a zero-size
        // GSK frame. Previously that returned empty bytes on the very first try,
        // so callers (the MCP bridge, gdbus, screenshot scripts) saw spurious
        // "empty screenshot" results during window warm-up. Waiting here makes a
        // successful capture the norm; the empty-bytes contract is preserved as
        // the genuine-failure signal (window truly never realises / is occluded).
        let png = captureWidgetPng(win);
        if (!png) {
            win.present();
            png = await captureWidgetWhenRenderable(win);
        }
        return png ?? new Uint8Array(0);
    }

    /** `ListActions() -> s` — JSON of the `app.*` + `win.*` actions. */
    ListActions(): string {
        const list: ActionList = {
            app: describeActions(this._actionGroup('app')),
            win: describeActions(this._actionGroup('win')),
        };
        return JSON.stringify(list);
    }

    /** `ActivateAction(scope, name, value_json)` — activate a GAction with an optional parameter. */
    ActivateAction(scope: string, name: string, valueJson: string): void {
        this._guard('ActivateAction');
        const sc = this._scope(scope);
        const group = this._requireGroup(sc, name);
        activateAction(group, name, this._parseValue(valueJson));
    }

    /** `ChangeActionState(scope, name, value_json)` — set a stateful action's state. */
    ChangeActionState(scope: string, name: string, valueJson: string): void {
        this._guard('ChangeActionState');
        const sc = this._scope(scope);
        const group = this._requireGroup(sc, name);
        changeActionState(group, name, this._parseValue(valueJson));
    }

    /** `PresentWindow()` — raise the active window (needed by the screenshot retry path). */
    PresentWindow(): void {
        this._app.get_active_window()?.present();
    }

    /** `ResizeWindow(w, h) -> (w, h)` — resize the active window; returns the requested size. */
    ResizeWindow(width: number, height: number): [number, number] {
        this._guard('ResizeWindow');
        const win = this._app.get_active_window();
        if (!win) throw new Error(formatDbusErrorMessage('unavailable', 'no active window to resize'));
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (win.is_maximized()) win.unmaximize();
        if (win.is_fullscreen()) win.unfullscreen();
        win.set_default_size(w, h);
        return [w, h];
    }

    // --- Phase 3: introspection (read-only) + CSS hot-swap ---

    /** `ListToplevels() -> s` — JSON of live toplevel windows. */
    ListToplevels(): string {
        return JSON.stringify(listToplevels());
    }

    /** `DumpTree(root, depth) -> s` — JSON widget tree from `root` ('' = active window). */
    DumpTree(root: string, depth: number): string {
        const resolved = this._resolveRootWidget(root);
        if (!resolved)
            throw new Error(formatDbusErrorMessage('not-found', `no widget at '${root || 'active window'}'`));
        return JSON.stringify(dumpTree(resolved.widget, depth > 0 ? depth : 8, resolved.path));
    }

    /** `GetProperty(path, prop) -> s` — JSON value of a widget's GObject property. */
    GetProperty(path: string, prop: string): string {
        const resolved = this._resolveRootWidget(path);
        if (!resolved) throw new Error(formatDbusErrorMessage('not-found', `no widget at '${path}'`));
        const value = getWidgetProperty(resolved.widget, prop);
        if (value === undefined)
            throw new Error(formatDbusErrorMessage('not-found', `widget has no property '${prop}'`));
        return JSON.stringify(value);
    }

    /** `GetFocused() -> s` — JSON {path,name,type} of the focused widget, or null. */
    GetFocused(): string {
        const win = this._app.get_active_window();
        const focus = win ? win.get_focus() : null;
        if (!focus) return JSON.stringify(null);
        return JSON.stringify({ path: pathOfWidget(focus), name: focus.get_name() || null, type: widgetType(focus) });
    }

    /** `ActivateWidget(path) -> b` — activate the widget at `path`: its own
     * default activation (Button→clicked, Entry→activate, Toggle) or, for a
     * GtkListBoxRow/AdwActionRow, a click on the owning GtkListBox (select the
     * row + row-activated) so nav / preference rows drive. The click-drive
     * counterpart of DumpTree/GetProperty. Throws if the path resolves to no
     * live widget; returns whether it activated. */
    ActivateWidget(path: string): boolean {
        this._guard('ActivateWidget');
        const resolved = this._resolveRootWidget(path);
        if (!resolved) throw new Error(formatDbusErrorMessage('not-found', `no widget at '${path}'`));
        return activateWidget(resolved.widget);
    }

    /** `DumpGSettings(schema_id) -> s` — JSON of a schema's keys + values. */
    DumpGSettings(schemaId: string): string {
        return JSON.stringify(dumpGSettings(schemaId));
    }

    /** `DumpCss() -> s` — JSON of the devtools-installed CSS provider names. */
    DumpCss(): string {
        return JSON.stringify(dumpCss());
    }

    /** `SwapCss(name, css) -> b` — live-install/replace a named CSS provider. */
    SwapCss(name: string, css: string): boolean {
        this._guard('SwapCss');
        return swapCss(name, css);
    }

    // --- internals ---

    private _resolveRootWidget(root: string): { widget: Gtk.Widget; path: string } | null {
        if (!root || root === 'window' || root === 'active') {
            const win = this._app.get_active_window();
            if (!win) return null;
            return { widget: win, path: pathOfWidget(win) ?? 'toplevel:0' };
        }
        const widget = resolveWidgetPath(root);
        return widget ? { widget, path: root } : null;
    }

    private _isPaused(): boolean {
        return this._options.paused?.() ?? false;
    }

    private _guard(method: string): void {
        const kind = this._kinds.get(method);
        if (!kind) {
            throw new Error(formatDbusErrorMessage('internal', `unclassified devtools method '${method}'`));
        }
        if (kind === 'mutating' && this._isPaused()) {
            throw new Error(
                formatDbusErrorMessage(
                    'paused',
                    `${method} rejected — external control is paused. Read-only methods keep working.`,
                ),
            );
        }
    }

    private _scope(scope: string): ActionScope {
        return scope === 'app' ? 'app' : 'win';
    }

    private _actionGroup(scope: ActionScope): Gio.ActionGroup | null {
        if (scope === 'app') return this._app as unknown as Gio.ActionGroup;
        if (this._options.winActionGroup) return this._options.winActionGroup;
        const win = this._app.get_active_window();
        // Gtk.ApplicationWindow implements GActionGroup; Adw.ApplicationWindow does
        // not, so an Adw app must pass winActionGroup to installDevtools().
        if (win instanceof Gtk.ApplicationWindow) return win as unknown as Gio.ActionGroup;
        return null;
    }

    private _requireGroup(scope: ActionScope, name: string): Gio.ActionGroup {
        const group = this._actionGroup(scope);
        if (!group) throw new Error(formatDbusErrorMessage('unavailable', `no '${scope}' action group`));
        if (!group.has_action(name)) {
            throw new Error(formatDbusErrorMessage('not-found', `unknown action ${scope}.${name}`));
        }
        return group;
    }

    private _parseValue(valueJson: string): unknown {
        if (!valueJson || valueJson === 'null') return null;
        try {
            return JSON.parse(valueJson);
        } catch {
            throw new Error(formatDbusErrorMessage('invalid-params', `value_json is not valid JSON: ${valueJson}`));
        }
    }
}
