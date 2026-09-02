// Story decorators — reusable wrappers for common story setup.
// original implementation using Gio actions.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type Gtk from '@girs/gtk-4.0';
import type { StoryDecorator, StoryWidget } from './story-widget.js';

/** Declarative description of one action to install in a story sandbox. */
export interface StoryAction {
    /** Action name (without the group prefix). */
    name: string;
    /**
     * Initial state for a stateful action. `boolean` → a toggle, `string` → a
     * radio/enum action. Omit for a plain (parameterless, stateless) action.
     */
    state?: boolean | string;
    /** Called when the action activates (plain) or changes state (stateful). */
    onChange?: (value: GLib.Variant | null) => void;
}

/**
 * Install a `Gio.SimpleActionGroup` on a widget so a story's buttons reach
 * stubbed actions in the sandbox — replaces the hand-rolled
 * `Gio.SimpleAction.new_stateful(...)` boilerplate that every interactive
 * story used to repeat.
 */
export function installActionGroup(widget: Gtk.Widget, prefix: string, actions: StoryAction[]): Gio.SimpleActionGroup {
    const group = new Gio.SimpleActionGroup();

    for (const spec of actions) {
        if (typeof spec.state === 'boolean') {
            const action = Gio.SimpleAction.new_stateful(spec.name, null, GLib.Variant.new_boolean(spec.state));
            action.connect('change-state', (a, value) => {
                a.set_state(value!);
                spec.onChange?.(value);
            });
            group.add_action(action);
        } else if (typeof spec.state === 'string') {
            const action = Gio.SimpleAction.new_stateful(
                spec.name,
                GLib.VariantType.new('s'),
                GLib.Variant.new_string(spec.state),
            );
            action.connect('change-state', (a, value) => {
                a.set_state(value!);
                spec.onChange?.(value);
            });
            group.add_action(action);
        } else {
            const action = new Gio.SimpleAction({ name: spec.name });
            action.connect('activate', (_a, value) => spec.onChange?.(value ?? null));
            group.add_action(action);
        }
    }

    widget.insert_action_group(prefix, group);
    return group;
}

/**
 * Decorator that installs an action group before the story builds — so the
 * actions exist by the time the previewed widget wires its buttons.
 */
export function withActionGroup(prefix: string, actions: StoryAction[]): StoryDecorator {
    return (build: () => void, widget: StoryWidget) => {
        installActionGroup(widget, prefix, actions);
        build();
    };
}
