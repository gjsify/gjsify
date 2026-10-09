// The action model of Gio, renderer-free — ADR 0098 §§ 1–2.
//
// `Gio.SimpleAction`, the `Gio.ActionMap` / `Gio.ActionGroup` methods a window or an application
// carries, and the walk that resolves `prefix.name` from a widget: the nearest group with that
// prefix up the parent chain, a window's own actions under `win`, and from a window the application
// under `app`. A port supplies only `parent(widget)`; the walk lives here once.
//
// A SUBSET: what GIO does and this does not (`add_action_entries`, `Gio.PropertyAction`, state, a
// parameter that is not null) is refused by name, never ignored.
//
// Reference: GLib gio/gsimpleaction.c, gio/gactionmap.c, gio/gactiongroup.c; gtk/gtkwidget.c

import { UnsupportedGObjectError } from './gobject.js';

/** `activate` handler: the action that fired and the caller's parameter (`null` when none). */
export type ActionActivateHandler = (action: SimpleAction, parameter: unknown) => void;

/** What a registry holds and a widget walk activates. */
export interface ActionLike {
    readonly name: string;
    enabled: boolean;
    activate(parameter?: unknown): void;
}

/** What a group answers; `Gio.ActionMap` and the groups of `insertActionGroup` both do. */
export interface ActionGroupLike {
    lookup_action(name: string): ActionLike | null;
}

export interface SimpleActionProps {
    name: string;
    enabled?: boolean;
    /** Held, never checked: an action activates with whatever the caller passes. */
    parameter_type?: unknown;
}

function refuse(feature: string, detail: string): UnsupportedGObjectError {
    return new UnsupportedGObjectError(
        feature,
        `${feature} ${detail}, which is outside the Gio subset (ADR 0098 § 1).`,
    );
}

/** `Gio.SimpleAction`: `name`, `enabled`, the `activate` signal and `activate()`. */
export class SimpleAction implements ActionLike {
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
        if ('state' in props) throw refuse('Gio.SimpleAction state', 'is a stateful action');
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
        for (const handler of Array.from(this._handlers.values())) handler(this, parameter);
    }
}

/**
 * `Gio.SimpleActionGroup`: `add_action` (an existing name is replaced), `lookup_action`, `has_action`,
 * `list_actions`, `remove_action` and `activate_action`. `list_actions()` is in insertion order where
 * GIO's hash order is unspecified, so a caller must not depend on either. `activate_action` takes the
 * caller's parameter as is and answers whether an action of that name exists (GIO answers nothing);
 * a disabled action swallows it. Not here: `change_action_state`, `query_action`, `add_action_entries`
 * and the `action-added` / `action-removed` signals.
 */
export class SimpleActionGroup implements ActionGroupLike {
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

/** The registry behind `Gio.ActionMap` and `Gio.ActionGroup`. */
export class ActionRegistry implements ActionGroupLike {
    private readonly _actions = new Map<string, ActionLike>();

    /** `g_action_map_add_action`: an existing name is replaced. */
    add(action: ActionLike): void {
        this._actions.set(action.name, action);
    }

    remove(name: string): void {
        this._actions.delete(name);
    }

    lookup_action(name: string): ActionLike | null {
        return this._actions.get(name) ?? null;
    }

    has(name: string): boolean {
        return this._actions.has(name);
    }

    list(): string[] {
        return [...this._actions.keys()];
    }
}

const REGISTRIES = new WeakMap<object, ActionRegistry>();

/** The registry an owner (an application, a window) carries; made on first use. */
export function actionRegistryOf(owner: object, create = true): ActionRegistry | undefined {
    let registry = REGISTRIES.get(owner);
    if (registry === undefined && create) {
        registry = new ActionRegistry();
        REGISTRIES.set(owner, registry);
    }
    return registry;
}

function requireAction(action: unknown): ActionLike {
    const given = action as Partial<ActionLike> | null;
    if (typeof given?.name !== 'string' || typeof given.activate !== 'function') {
        throw new TypeError('add_action: needs a Gio.Action (a Gio.SimpleAction)');
    }
    return given as ActionLike;
}

const MAP_METHODS = {
    add_action(this: object, action: ActionLike): void {
        actionRegistryOf(this)!.add(requireAction(action));
    },
    lookup_action(this: object, name: string): ActionLike | null {
        return actionRegistryOf(this, false)?.lookup_action(name) ?? null;
    },
    remove_action(this: object, name: string): void {
        actionRegistryOf(this, false)?.remove(name);
    },
};

const GROUP_METHODS = {
    has_action(this: object, name: string): boolean {
        return actionRegistryOf(this, false)?.has(name) ?? false;
    },
    list_actions(this: object): string[] {
        return actionRegistryOf(this, false)?.list() ?? [];
    },
    /** `g_action_group_activate_action`: an unknown or disabled action does nothing, as on GIO. */
    activate_action(this: object, name: string, parameter: unknown = null): void {
        if (parameter !== null) {
            throw refuse('activate_action with a parameter', 'needs a GLib.Variant');
        }
        actionRegistryOf(this, false)?.lookup_action(name)?.activate(null);
    },
    get_action_enabled(this: object, name: string): boolean {
        return actionRegistryOf(this, false)?.lookup_action(name)?.enabled ?? false;
    },
};

/**
 * Gives a prototype `Gio.ActionMap` (`add_action`, `lookup_action`, `remove_action`) and, with
 * `group`, `Gio.ActionGroup`. A window is an ActionMap only: its `activate_action` is the WIDGET's,
 * which takes `win.x`, so the group half stays off it.
 */
export function installActionMap(proto: object, group = false): void {
    const methods: Record<string, unknown> = group ? { ...MAP_METHODS, ...GROUP_METHODS } : { ...MAP_METHODS };
    for (const [name, value] of Object.entries(methods)) {
        Object.defineProperty(proto, name, { value, writable: true, configurable: true, enumerable: false });
    }
}

// --- Resolution: the walk of `gtk_widget_activate_action` --------------------------------------

const EXPLICIT = new WeakMap<object, Map<string, ActionGroupLike>>();
const LINKS = new WeakMap<object, ActionGroupLike>();

/** `gtk_widget_insert_action_group`: `group`'s actions resolve as `prefix.name` below `widget`. `null` removes it. */
export function insertActionGroup(widget: object, prefix: string, group: ActionGroupLike | null): void {
    let byPrefix = EXPLICIT.get(widget);
    if (group === null) {
        byPrefix?.delete(prefix);
        return;
    }
    if (byPrefix === undefined) EXPLICIT.set(widget, (byPrefix = new Map()));
    byPrefix.set(prefix, group);
}

/** The application a window belongs to (`Gtk.Window:application`), or `null`. */
export function applicationOfWindow(window: object): ActionGroupLike | null {
    return LINKS.get(window) ?? null;
}

/** Records or clears the application of a window. `Application.add_window` / `remove_window` call it. */
export function linkWindow(window: object, application: ActionGroupLike | null): void {
    if (application === null) LINKS.delete(window);
    else LINKS.set(window, application);
}

/**
 * The group a widget finds for `prefix`: the nearest explicit group up the chain, the `win` actions
 * of the first node that carries an ActionMap, and the application of the first node that is a window
 * of one (`app`). A widget with no window above it finds none, which is not an empty group (ADR 0042 § 2).
 */
export function findActionGroup(
    widget: object,
    prefix: string,
    parent: (node: object) => object | null | undefined,
): ActionGroupLike | null {
    for (let node: object | null | undefined = widget; node; node = parent(node)) {
        const explicit = EXPLICIT.get(node)?.get(prefix);
        if (explicit !== undefined) return explicit;
        if (prefix === 'win') {
            const own = actionRegistryOf(node, false);
            if (own !== undefined) return own;
        }
        if (prefix === 'app') {
            const application = LINKS.get(node);
            if (application !== undefined) return application;
        }
    }
    return null;
}

/**
 * What a `Gtk.Actionable` does when it fires: split `prefix.name`, find the group, activate. Returns
 * whether an enabled action ran, so a caller can tell a wired button from a dangling name.
 */
export function activateWidgetAction(
    widget: object,
    fullName: string,
    parent: (node: object) => object | null | undefined,
    parameter: unknown = null,
): boolean {
    const dot = fullName.indexOf('.');
    if (dot <= 0) return false;
    const action = findActionGroup(widget, fullName.slice(0, dot), parent)?.lookup_action(fullName.slice(dot + 1));
    if (!action || !action.enabled) return false;
    action.activate(parameter);
    return true;
}
