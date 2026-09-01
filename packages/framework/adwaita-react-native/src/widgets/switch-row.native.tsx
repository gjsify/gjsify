/** @jsxImportSource react */
// `AdwSwitchRow` on React Native — two routes into one transition, both through core.
// (On the pragma, see `bin.native.tsx`.)
//
// THE ROW IS THE CONTROL, NOT JUST THE HANDLE, and that is the rule a port drops.
// `adw_switch_row_init` makes the row activatable and points its activatable-widget at
// the slider, so "the user can control the switch by activating the row or by dragging on
// the switch handle" (the class documentation, in one line). `@gjsify/adwaita-nativescript`
// shipped with only the handle working until the same state machine was routed through.
// So there are two handlers here, and each takes its rule from
// `@gjsify/adwaita-core`'s `SwitchRowState`:
//
//   - the ROW press runs `activate()`, which INVERTS — the rule, not `!active` retyped;
//   - the SLIDER runs `setActive(next)`, whose return value IS the `g_object_notify`
//     gate: a set to the value already held emits nothing. `adw_switch_row_set_active`
//     early-returns before it writes the slider, so libadwaita is silent there too, and a
//     platform that re-delivers the current value must not read as a user change.
//
// STRICTLY CONTROLLED, which is React Native's own contract for `Switch` and not an
// invention here: "If the `value` prop is not updated, the component will continue to
// render the supplied `value` prop instead of the expected result of any user actions."
// So the machine is constructed per interaction, seeded from the prop, and holds nothing
// between renders — there is exactly one source of truth and it is the consumer. Where
// that DIVERGES from GTK is named in the README: on GTK the widget keeps a value the
// consumer declines to echo back, and here it does not.

import { useCallback, type ReactElement } from 'react';
import { Pressable, Switch } from 'react-native';

import { SwitchRowState } from '@gjsify/adwaita-core';

import type { AdwSwitchRowProps } from '../props.js';
import { ADW_ROW_STYLE, AdwRowLabels } from '../row-shell.native.js';

/** The core machine, seeded from the controlled prop. */
const seeded = (active: boolean | undefined): SwitchRowState => {
    const state = new SwitchRowState();
    state.setActive(active === true);
    return state;
};

/** {@link import('./switch-row.js').AdwSwitchRow} on React Native. */
export function AdwSwitchRow({ title, subtitle, active, onNotifyActive }: AdwSwitchRowProps): ReactElement | null {
    const activateRow = useCallback(() => {
        const state = seeded(active);
        state.activate();
        onNotifyActive?.(state.active);
    }, [active, onNotifyActive]);

    const changeFromSlider = useCallback(
        (next: boolean) => {
            const state = seeded(active);
            if (state.setActive(next)) onNotifyActive?.(state.active);
        },
        [active, onNotifyActive],
    );

    return (
        <Pressable style={ADW_ROW_STYLE} onPress={activateRow}>
            <AdwRowLabels title={title} subtitle={subtitle} />
            <Switch value={active === true} onValueChange={changeFromSlider} />
        </Pressable>
    );
}
