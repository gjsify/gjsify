// A minimal `GAction` registry — the half of `Gio.ActionGroup` a `.blp` button needs.
//
// A Blueprint writes `action-name: "source-view.copy"` and the widget class answers it with
// `new Gio.SimpleAction({ name: 'copy' })` in an action group inserted under `source-view`.
// Until this file existed the port only HELD the name (`GtkButton.actionName`), so every
// app wired the click to `clicked` itself and the shared class could not run on both sides.
//
// WHAT IS HERE: `SimpleAction` (name, enabled, `activate` signal), `SimpleActionGroup`
// (add/lookup/remove/activate), `insertActionGroup` (`gtk_widget_insert_action_group`) and
// `activateWidgetAction` (what a button does on click: walk the parent chain, find the
// group registered under the name's prefix, activate the action).
//
// WHAT IS NOT: parameter types, state, `app.`/`win.` resolution through an application,
// `Gio.Menu` targets, accelerators. An action with a `parameter-type` is activated with
// whatever the caller passes; nothing checks it. `enabled = false` is honoured, because
// GTK greys a button out for it and the click must not reach the handler either.
//
// NS-CORE-FREE ON PURPOSE: the parent chain is read through the structural `ActionHost`
// (`@nativescript/core`'s `View.parent`), so a pure spec drives all of it off a device.
//
// Reference: refs/gtk gtk/gtkactionable.c, gtk/gtkwidget.c (gtk_widget_insert_action_group)
// Reference: GLib gio/gsimpleaction.c, gio/gsimpleactiongroup.c

/** The one signal an action emits: its `activate`, with the caller's parameter (or `null`). */
export type ActionActivateHandler = (action: SimpleAction, parameter: unknown) => void;

export interface SimpleActionProps {
    name: string;
    enabled?: boolean;
    /** Accepted for `new Gio.SimpleAction({ …, parameter_type })` call sites; never checked. */
    parameter_type?: unknown;
}

/** `Gio.SimpleAction`. */
export class SimpleAction {
    readonly name: string;
    enabled: boolean;
    readonly parameter_type: unknown;
    private readonly _handlers = new Map<number, ActionActivateHandler>();
    private _nextId = 1;

    constructor(props: SimpleActionProps) {
        if (typeof props?.name !== 'string' || props.name === '' || props.name.includes('.')) {
            throw new TypeError(
                `SimpleAction: ${JSON.stringify(props?.name)} is not an action name — ` +
                    'it has to be non-empty and carry no `.`, which separates the group prefix.',
            );
        }
        this.name = props.name;
        this.enabled = props.enabled ?? true;
        this.parameter_type = props.parameter_type ?? null;
    }

    /** `g_signal_connect`. Only `activate` exists; any other name is refused rather than ignored. */
    connect(signal: 'activate', handler: ActionActivateHandler): number {
        if (signal !== 'activate') {
            throw new TypeError(`SimpleAction.connect: unsupported signal ${JSON.stringify(signal)} (only "activate")`);
        }
        const id = this._nextId++;
        this._handlers.set(id, handler);
        return id;
    }

    disconnect(id: number): void {
        this._handlers.delete(id);
    }

    /** `g_action_activate`. A disabled action swallows it, as GIO does. */
    activate(parameter: unknown = null): void {
        if (!this.enabled) return;
        for (const handler of [...this._handlers.values()]) handler(this, parameter);
    }
}

/** `Gio.SimpleActionGroup`. */
export class SimpleActionGroup {
    private readonly _actions = new Map<string, SimpleAction>();

    add_action(action: SimpleAction): void {
        this._actions.set(action.name, action);
    }

    remove_action(name: string): void {
        this._actions.delete(name);
    }

    lookup_action(name: string): SimpleAction | null {
        return this._actions.get(name) ?? null;
    }

    has_action(name: string): boolean {
        return this._actions.has(name);
    }

    list_actions(): string[] {
        return [...this._actions.keys()];
    }

    /** `g_action_group_activate_action`. False when no such action exists. */
    activate_action(name: string, parameter: unknown = null): boolean {
        const action = this._actions.get(name);
        if (!action) return false;
        action.activate(parameter);
        return true;
    }
}

/** What the chain walk needs of a view: `View.parent`, nothing else. */
export interface ActionHost {
    parent?: ActionHost | null;
}

const groups = new WeakMap<object, Map<string, SimpleActionGroup>>();

/**
 * `gtk_widget_insert_action_group`: make `group`'s actions resolvable as `prefix.name` from
 * `widget` and everything below it. `null` removes the group again.
 */
export function insertActionGroup(widget: ActionHost, prefix: string, group: SimpleActionGroup | null): void {
    let byPrefix = groups.get(widget);
    if (group === null) {
        byPrefix?.delete(prefix);
        return;
    }
    if (!byPrefix) groups.set(widget, (byPrefix = new Map()));
    byPrefix.set(prefix, group);
}

/** `gtk_widget_get_action_group`-style lookup, nearest ancestor first. */
export function findActionGroup(widget: ActionHost, prefix: string): SimpleActionGroup | null {
    for (let node: ActionHost | null | undefined = widget; node; node = node.parent) {
        const group = groups.get(node)?.get(prefix);
        if (group) return group;
    }
    return null;
}

/**
 * What a `Gtk.Actionable` does when it fires: split `prefix.name`, find the group on the
 * widget or its nearest ancestor, activate. Returns whether an enabled action ran, so a
 * caller can tell a wired button from a dangling name (GTK only warns about the latter).
 */
export function activateWidgetAction(widget: ActionHost, fullName: string, parameter: unknown = null): boolean {
    const dot = fullName.indexOf('.');
    if (dot <= 0) return false;
    const action = findActionGroup(widget, fullName.slice(0, dot))?.lookup_action(fullName.slice(dot + 1));
    if (!action || !action.enabled) return false;
    action.activate(parameter);
    return true;
}
