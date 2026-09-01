/** @jsxImportSource react */
// `AdwButtonRow` on React Native — one centred label, and the row is the button.
// (On the pragma, see `bin.native.tsx`.)
//
// `ButtonRowState` FROM `@gjsify/adwaita-core` RATHER THAN TWO LOCAL EXPRESSIONS. It
// carries both facts this half needs and both are easy to get wrong alone: the title's
// `string_is_not_empty` visibility, and `activatable`, which is `BUTTON_ROW_ACTIVATABLE`
// — always `true`, because `adw-button-row.ui` hardcodes it and the class installs no
// property to change it. The sibling `<AdwActionRow>` reads `activatable` as an ordinary
// prop, so one surface would otherwise carry two opposite meanings for one word; taking
// the value from core is what stops this file inventing an opt-out.
//
// THE ICONS ARE NOT HERE. `AdwButtonRow:start-icon-name` and `:end-icon-name` name
// entries in a GTK ICON THEME, and this package ships no icon renderer for React Native —
// so they are absent from the surface rather than accepted on one half and dropped on the
// other. `ButtonRowState` computes their visibility anyway and this file ignores it,
// which is the honest state: the derivation is ready, the renderer is not. The README
// carries the omission.

import type { ReactElement } from 'react';
import { Pressable, Text, type ViewStyle } from 'react-native';

import { ButtonRowState, type ButtonRowRenderState } from '@gjsify/adwaita-core';

import type { AdwButtonRowProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE, ADW_ROW_STYLE } from '../row-shell.native.js';

/** `adw-button-row.ui` centres its content box inside the row. */
const BUTTON_ROW_STYLE: ViewStyle = { ...ADW_ROW_STYLE, justifyContent: 'center' };

/** The core derivation, as a value — the state object holds nothing between renders. */
const buttonRowState = (title: string | undefined): ButtonRowRenderState => {
    const state = new ButtonRowState();
    state.setTitle(title);
    return state.state;
};

/** {@link import('./button-row.js').AdwButtonRow} on React Native. */
export function AdwButtonRow({ title, onActivated }: AdwButtonRowProps): ReactElement | null {
    const state = buttonRowState(title);
    return (
        <Pressable style={BUTTON_ROW_STYLE} disabled={!state.activatable} onPress={onActivated}>
            <Text style={state.titleVisible ? undefined : ADW_ROW_HIDDEN_STYLE}>{state.title}</Text>
        </Pressable>
    );
}
