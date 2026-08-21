// @gjsify/devtools — the in-app org.gjsify.Devtools DBus service. Method bodies adapt
// the PixelRPG map-editor's ControlDbusService.

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
import { type DevtoolsPeerServer, removeDevtoolsAddressFile } from './peer-transport.js';
import { captureWidgetPng } from './screenshot.js';
import { dumpCss, swapCss } from './css.js';
import { dumpGSettings } from './gsettings.js';
import {
    activateWidget,
    dumpTree,
    findWidgetPath,
    getWidgetProperty,
    listToplevels,
    parseWidgetSelector,
    pathOfWidget,
    resolveWidgetPath,
    sendKeyToWidget,
    widgetType,
} from './widget-tree.js';

type ActionScope = 'app' | 'win';

/**
 * Does this widget-scope string mean "the active window"?
 *
 * `DumpTree`, `GetProperty`, `ActivateWidget` and `Screenshot` all take ONE string
 * that is either this or a `toplevel:N/child:M` path. ONE predicate rather than the
 * inline test it replaces, because `_resolveRootWidget` and `Screenshot`'s
 * not-found split have to ask the identical question — two copies drift into a
 * scope that resolves for one caller and 404s for the other, which is unreviewable
 * from either side.
 */
function isActiveWindowScope(scope: string): boolean {
    return !scope || scope === 'window' || scope === 'active';
}

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
 * Capture `widget` to PNG, retrying across a handful of frames: a window that is mapped
 * but not yet realised or allocated produces a zero-size GSK frame, so a few main-loop
 * iterations turn a transient empty capture into a real screenshot. `null` only if the
 * widget never becomes renderable.
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
 * The permanent `org.gjsify.Devtools` DBus interface for a GTK app, through which
 * external tooling (the MCP bridge, `gdbus`, scripts) inspects, screenshots and drives
 * it. Generic methods live here; app extensions contribute pause-guarded methods merged
 * into the same interface. The live window is resolved lazily per call, so the service
 * survives window recreation.
 */
export class DevtoolsService {
    /**
     * One `Gio.DBusExportedObject` PER CONNECTION. The session bus is a single shared
     * pipe, but the peer transport hands out one `Gio.DBusConnection` per client with no
     * shared object registry, so a single-slot field would export to the FIRST peer only
     * and every later client would see `UnknownMethod` for every method.
     */
    private readonly _exported = new Map<Gio.DBusConnection, Gio.DBusExportedObject>();
    private _peer: DevtoolsPeerServer | null = null;
    private _addressFile: string | null = null;
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
                // Extension handlers are attached under the bare method name. Every one
                // today is synchronous; an async one may return a Promise (measured working
                // on gjs 1.88.1) or use the `<Name>Async(params, invocation, fdList)`
                // manual-reply convention, as ScreenshotAsync does.
                (this as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = (...args: unknown[]) => {
                    this._guard(name);
                    return impl(...args);
                };
            }
        }
    }

    /**
     * Export the interface at `objectPath` on `connection`. Idempotent per
     * connection; accepts ANY `Gio.DBusConnection` — the app's session-bus
     * connection or a peer connection from a `Gio.DBusServer`.
     */
    export(connection: Gio.DBusConnection, objectPath: string): void {
        if (this._exported.has(connection)) return;
        const xml = buildDevtoolsIfaceXml(this._extensions.flatMap((e) => e.methodsXml ?? []));
        const exported = Gio.DBusExportedObject.wrapJSObject(xml, this);
        exported.export(connection, objectPath);
        this._exported.set(connection, exported);
    }

    /**
     * Tear the interface down — on `connection` only, or (default) everywhere,
     * including a peer server attached via {@link attachPeerServer}. Idempotent.
     */
    unexport(connection?: Gio.DBusConnection): void {
        if (connection) {
            this._exported.get(connection)?.unexport();
            this._exported.delete(connection);
            return;
        }
        for (const exported of this._exported.values()) exported.unexport();
        this._exported.clear();
        this._peer?.stop();
        this._peer = null;
        // The published address file CLAIMS that an app of this id is listening right now,
        // and the bridge ranks it above the session bus on that basis, so it must retract
        // together with the socket it names: `uninstallDevtools()` stops the server with no
        // app exit at all, and `GApplication::shutdown` never fires on Ctrl-C or SIGKILL.
        if (this._addressFile) {
            removeDevtoolsAddressFile(this._addressFile);
            this._addressFile = null;
        }
    }

    /**
     * Record the peer server hosting this service and the file its address went to, so
     * `unexport()` closes the socket AND retracts the claim, and callers can read both
     * back instead of scraping the app's stderr.
     */
    attachPeerServer(peer: DevtoolsPeerServer, addressFile?: string | null): void {
        this._peer = peer;
        this._addressFile = addressFile ?? null;
    }

    /** The peer address clients must dial, or `null` when this service is on a bus. */
    get peerAddress(): string | null {
        return this._peer?.address ?? null;
    }

    /** Where this service's peer address is published, or `null` when it is not. */
    get addressFile(): string | null {
        return this._addressFile;
    }

    // Generic DBus methods; the names match buildDevtoolsIfaceXml.

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

    /**
     * `Screenshot(scope) -> ay` — PNG bytes of `scope` via the GSK renderer.
     *
     * `scope` is the same widget vocabulary `DumpTree`/`GetProperty`/`ActivateWidget`
     * take: `''`, `window` or `active` for the active window, or a stable
     * `toplevel:N/child:M` path for ONE widget inside it. Capturing a single widget
     * costs nothing extra — `captureWidgetPng` snapshots whatever `Gtk.Widget` it is
     * handed — so the only thing that ever made this window-only was not reading the
     * argument.
     *
     * It went unread for the whole life of the method while being DECLARED in the
     * interface XML and exposed as a user-facing `scope` parameter on the MCP
     * `screenshot` tool, which even defaulted it to `'window'`. Asking for a child
     * widget therefore returned the whole window and said nothing — the failure mode a
     * declared-but-ignored argument always has, since every caller looks correct.
     *
     * Uses the `<Name>Async` manual-reply convention: the method takes the raw
     * `invocation` and calls `return_value()` itself, and `wrapJSObject` finds it because
     * it falls back to `<Name>Async` when the bare name is absent, so the wire method
     * stays `Screenshot`.
     *
     * The shape exists because gjs 1.86.0 mis-marshalled the resolved value of ANY
     * Promise-returning exported method (`org.gnome.gjs.JSError.ValueError: Service
     * implementation returned an incorrect value type`), while a manual reply was
     * unaffected. That no longer reproduces on gjs 1.88.1 — a plain `async Screenshot()`
     * returning `ay` marshals correctly — so this can collapse back into one.
     */
    async ScreenshotAsync(params: unknown[], invocation: Gio.DBusMethodInvocation): Promise<void> {
        try {
            // Defensive rather than trusting the signature: the same service is reached
            // over the session bus AND the peer transport, and an extension may call the
            // method directly. A non-string first argument means the active window, which
            // is what every pre-scope caller expected.
            const scope = typeof params?.[0] === 'string' ? params[0] : '';
            const png = await this._captureScopePng(scope);
            invocation.return_value(new GLib.Variant('(ay)', [png]));
        } catch (error) {
            invocation.return_dbus_error(
                'org.gjsify.Devtools.Error.Screenshot',
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    /**
     * Capture `scope` to PNG, warming up across frames: a just-launched or mid-layout
     * window yields a zero-size GSK frame, so the first `captureWidgetPng` can be empty.
     * Empty bytes remain the genuine-failure signal, for a window that never realises at
     * all.
     */
    private async _captureScopePng(scope: string): Promise<Uint8Array> {
        const resolved = this._resolveRootWidget(scope);
        if (!resolved) {
            // Two different absences, reported differently on purpose. An explicit path
            // matching no live widget is a CALLER error and gets the same `not-found`
            // every other path-taking method raises. The DEFAULT scope with no active
            // window is the app not being up yet — callers already treat empty bytes as
            // "present it and retry", and turning that into an error would break the
            // retry the MCP tool performs.
            if (isActiveWindowScope(scope)) return new Uint8Array(0);
            throw new Error(formatDbusErrorMessage('not-found', `no widget at '${scope}'`));
        }
        let png = captureWidgetPng(resolved.widget);
        if (!png) {
            // Present the toplevel that OWNS the scope rather than `get_active_window()`:
            // for a child widget the two can differ, and presenting the wrong window
            // leaves the target unrealised for every one of the retries below.
            const root = resolved.widget.get_root();
            if (root instanceof Gtk.Window) root.present();
            png = await captureWidgetWhenRenderable(resolved.widget);
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

    /** `FindWidget(selector) -> s` — path of the first widget matching
     * `Type`, `:css-class` or `Type:css-class`, searched depth-first from the
     * active window; `''` when nothing matches.
     *
     * The lookup every click-driving caller was doing by hand. Widget paths are
     * POSITIONAL, so one written into a script is wrong as soon as a widget is
     * inserted above it — callers therefore dumped the tree and walked the JSON
     * themselves, reimplementing this same walk once per language. Empty string
     * rather than an error for "no match": not finding a widget is an ordinary
     * answer a caller acts on (wait and retry, or report), not a fault.
     *
     * Invisible and unmapped subtrees are skipped — see {@link findWidgetPath}. */
    FindWidget(selector: string): string {
        const parsed = parseWidgetSelector(selector);
        if (!parsed) throw new Error(formatDbusErrorMessage('invalid-params', `empty selector '${selector}'`));
        const resolved = this._resolveRootWidget('');
        if (!resolved) return '';
        return findWidgetPath(resolved.widget, parsed, resolved.path) ?? '';
    }

    /** `SendKey(accelerator, path) -> b` — deliver a key to the key controllers of the
     * widget at `path` (empty path = the focused widget, else the active window).
     *
     * The half of headless GUI verification that was missing: buttons could be
     * pressed and actions fired, but nothing could be TYPED, so every
     * `Gtk.EventControllerKey` handler — an editor's arrow keys, Delete in a
     * canvas — was unverifiable. Accelerator syntax is GTK's own
     * (`Delete`, `Left`, `<primary>s`, `<shift>Up`).
     *
     * What it proves is the HANDLER, not GDK's routing — see
     * {@link sendKeyToWidget}. Pair it with `GetProperty(path, "focusable")` when
     * the question is whether a real key would arrive. */
    SendKey(accelerator: string, path: string): boolean {
        this._guard('SendKey');
        const [ok, keyval, mods] = Gtk.accelerator_parse(accelerator);
        if (!ok) throw new Error(formatDbusErrorMessage('invalid-params', `cannot parse accelerator '${accelerator}'`));

        let target: Gtk.Widget | null;
        if (path) {
            target = this._resolveRootWidget(path)?.widget ?? null;
        } else {
            // No path: whatever has the keyboard right now, which is what a real key press would
            // reach. Falling back to the window would send the key somewhere the user is not.
            const win = this._app.get_active_window();
            target = win?.get_focus() ?? null;
        }
        if (!target) throw new Error(formatDbusErrorMessage('not-found', `no widget at '${path || 'focus'}'`));
        // `accelerator_parse` types its modifier out as nullable; a parse that SUCCEEDED with no
        // modifier means zero, not "unknown".
        return sendKeyToWidget(target, keyval, mods ?? 0);
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
        if (isActiveWindowScope(root)) {
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
