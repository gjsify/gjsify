// AdwBreakpointBin — a bin that measures ITSELF, for NativeScript.
//
// `Adw.BreakpointBin` is `Adw.Bin` whose `Adw.Breakpoint` children are evaluated against the
// bin's own size, not the window's. The apps use it for a view that must adapt to the room it is
// given (a split pane, a tab page), and read the result through `current-breakpoint`.
//
// The breakpoints themselves are not children here: the tree builder wires the `breakpoints` a
// template carries (`wireBreakpoints`), measures this view with `observeViewSize`, and reports
// the applied index through {@link AdwBreakpointBin._applyBreakpoint}. `adwaita-core` decides
// which breakpoint wins; this class only holds the answer and announces a change.
//
// `current-breakpoint` holds an `AdwBreakpoint` (one per authored definition, made on first use
// so the same index always answers the same object) or null while no condition matches.
//
// DIFFERENCE: libadwaita also drops the current breakpoint when the child goes away
// (`adw_breakpoint_bin_set_child`, `has-child` handling). A childless bin here keeps it.
//
// Reference: refs/libadwaita/src/adw-breakpoint-bin.c (AdwBreakpointBin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwBreakpoint, TYPE_OBJECT } from '@gjsify/adwaita-core';
import { AdwBin } from './adw-bin.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { pushDeclared, withProperties, type GObjectNotify } from './signals.js';

interface BreakpointBinValues {
    _current: AdwBreakpoint | null;
}

export class AdwBreakpointBin extends withProperties(AdwBin, {
    GTypeName: 'AdwBreakpointBin',
    Properties: {
        // READ-ONLY upstream (`G_PARAM_READABLE`). `explicitNotify` because the applied index is
        // the source of truth and `_applyBreakpoint` is what pushes the value and emits.
        'current-breakpoint': {
            kind: 'object',
            valueType: TYPE_OBJECT,
            explicitNotify: true,
            blurb: 'The breakpoint currently applied',
            normalize: (_value, self) => (self as BreakpointBinValues)._current,
        },
    },
}) {
    static readonly GTypeName: string = 'AdwBreakpointBin';

    /**
     * `Adw.BreakpointBin:current-breakpoint` — the applied breakpoint, `null` for none. Read-only
     * by derivation (see the declaration).
     */
    declare currentBreakpoint: AdwBreakpoint | null;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

    private _current: AdwBreakpoint | null = null;
    private readonly _definitions = new Map<number, AdwBreakpoint>();

    constructor(props?: ConstructProps<AdwBreakpointBin>) {
        super();
        applyConstructProps(this, props);
    }

    /** `adw_breakpoint_bin_get_current_breakpoint`. */
    get_current_breakpoint(): AdwBreakpoint | null {
        return this._current;
    }

    /**
     * Called by the tree builder after every evaluation. `index` is the applied definition (null
     * for none) and `condition` the authored text of that definition. Emits only on a change.
     */
    _applyBreakpoint(index: number | null, condition: string | null): void {
        let next: AdwBreakpoint | null = null;
        if (index !== null) {
            next = this._definitions.get(index) ?? null;
            if (next === null) {
                next = new AdwBreakpoint(condition, { onApply: () => {} });
                this._definitions.set(index, next);
            }
        }
        if (next === this._current) return;
        this._current = next;
        pushDeclared(this, 'current-breakpoint', next);
        this.notify('current-breakpoint');
    }
}
