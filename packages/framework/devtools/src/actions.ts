// @gjsify/devtools — enumerate + drive app.*/win.* GActions.
// Adapted from the PixelRPG map-editor (apps/maker-gjs/src/widgets/application-window.ts).
// Copyright (c) PixelRPG. MIT.

import type Gio from 'gi://Gio?version=2.0';
import type { ActionDescriptor } from '@gjsify/devtools-protocol';
import { buildVariant } from './gvariant.js';

/** Describe every action in a group (name, enabled, parameter/state types), sorted by name. */
export function describeActions(group: Gio.ActionGroup | null): ActionDescriptor[] {
    if (!group) return [];
    return group
        .list_actions()
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
            name,
            enabled: group.get_action_enabled(name),
            parameterType: group.get_action_parameter_type(name)?.dup_string() ?? null,
            stateType: group.get_action_state_type(name)?.dup_string() ?? null,
        }));
}

/**
 * Activate an action with an optional parameter built from the action's
 * declared parameter type (so a plain JS value is enough).
 */
export function activateAction(group: Gio.ActionGroup, name: string, value: unknown): void {
    const paramType = group.get_action_parameter_type(name);
    const param = value === undefined || value === null ? null : buildVariant(paramType, value);
    group.activate_action(name, param);
}

/**
 * Set a stateful action's state — used for idempotent toggles where plain
 * activation would only flip the current value.
 */
export function changeActionState(group: Gio.ActionGroup, name: string, value: unknown): void {
    group.change_action_state(name, buildVariant(group.get_action_state_type(name), value));
}
