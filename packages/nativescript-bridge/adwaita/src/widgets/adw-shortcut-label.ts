// AdwShortcutLabel — a keyboard shortcut drawn as keycaps, for NativeScript.
//
// Renders a REAL horizontal `StackLayout` of keycap boxes and dimmed separators.
// Every structural decision — which classes, which nesting, where the 6px
// spacing goes — is in `shortcut-label.ts`, and this class only walks the plan
// that module returns. The split is what lets the spec suite drive
// `SHORTCUT_LABEL_VECTORS` against the shipping code: `extends StackLayout`
// evaluates the bare `@nativescript/core` specifier at module eval, so this file
// cannot be imported off-device and its sibling can.
//
// Reference: refs/libadwaita/src/adw-shortcut-label.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, type View } from '@nativescript/core';
import { isIOS } from '@gjsify/native-platform';
import {
    SHORTCUT_LABEL_CLASS,
    shortcutLabelDirection,
    shortcutLabelPlatform,
    shortcutLabelRenderPlan,
} from './shortcut-label.js';
import type { ShortcutLabelViewSpec } from './shortcut-label.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export class AdwShortcutLabel extends StackLayout {
    private _accelerator = '';
    private _disabledText = '';

    constructor(props?: ConstructProps<AdwShortcutLabel>) {
        super();

        this.orientation = 'horizontal';
        this.className = SHORTCUT_LABEL_CLASS;
        this.verticalAlignment = 'middle';
        // `GTK_ACCESSIBLE_ROLE_LABEL` (:88). The name comes from the parse below —
        // the keycaps read as a pile of single letters otherwise.
        this.accessibilityRole = 'text';

        // `direction` is inherited and resolves to `null` until the view is
        // attached, which is where the constructor reads it. Rebuilding on load
        // is what gets the sequence arrow right in an RTL app; it re-fires on a
        // re-parent, which is correct rather than something to guard against.
        this.addEventListener('loaded', () => this._rebuild());
        this._rebuild();

        applyConstructProps(this, props);
    }

    /** The accelerator to draw, in `gtk_accelerator_parse` syntax (`<Control>C`). */
    get accelerator(): string {
        return this._accelerator;
    }

    set accelerator(value: string) {
        this._accelerator = value ?? '';
        this._rebuild();
    }

    /** The placeholder shown when {@link accelerator} is empty (:513-520). */
    get disabledText(): string {
        return this._disabledText;
    }

    set disabledText(value: string) {
        this._disabledText = value ?? '';
        this._rebuild();
    }

    private _rebuild(): void {
        const plan = shortcutLabelRenderPlan(this._accelerator, {
            disabledText: this._disabledText,
            direction: shortcutLabelDirection(this.style.direction),
            platform: shortcutLabelPlatform(isIOS),
        });

        this.removeChildren();
        for (const spec of plan.children) this.addChild(buildView(spec));
        this.accessibilityLabel = plan.accessibleLabel;

        // `g_warning ("Failed to parse %s, part of accelerator '%s'")` (:532).
        // The partial render is upstream's too — it keeps what it built.
        if (plan.error) {
            console.warn(
                `[AdwShortcutLabel] failed to parse ${plan.error}, part of accelerator '${this._accelerator}'`,
            );
        }
    }
}

/** One spec node → one view. No decisions here: the spec already carries them. */
function buildView(spec: ShortcutLabelViewSpec): View {
    if (spec.kind === 'label') {
        const label = new Label();
        label.className = spec.className;
        label.text = spec.text;
        label.verticalAlignment = 'middle';
        return label;
    }

    const box = new StackLayout();
    box.orientation = 'horizontal';
    box.className = spec.className;
    box.verticalAlignment = 'middle';
    if (spec.direction) box.style.direction = spec.direction;
    for (const child of spec.children) box.addChild(buildView(child));
    return box;
}
