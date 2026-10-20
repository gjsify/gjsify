// AdwWindowTitle — a Libadwaita-style window title for NativeScript.
//
// Renders a REAL NativeScript vertical `StackLayout` with a centered bold title
// `Label` and a dim subtitle `Label`, intended as the title view of an
// `ActionBar` (the NS analogue of a GTK header bar).
//
// The two labels, their visibility and the change detection are HEADLESS and
// live in `@gjsify/adwaita-core` (ADR 0004) as `WindowTitleState`, shared with
// `@gjsify/adwaita-web`. Three rules from adw-window-title.c this port did not
// have: the TITLE hides when empty (C:207-208 — the template even starts it
// `visible=False`, adw-window-title.ui:15), a set to the value already held
// returns early (C:203-204, :244-245), and a real change notifies (C:210, :251).
// Only the subtitle was ever hidden, so a header showing just a subtitle
// reserved a blank title line above it.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_headerbar.scss` (title bold,
// subtitle dim/smaller).
// Reference: refs/libadwaita/src/adw-window-title.c, adw-window-title.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_header-bar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
//
// THE FIRST WIDGET WHOSE PROPERTIES ARE A REAL GObject's (ADR 0105 § 2, route D). `title` and
// `subtitle` are DECLARED at the `extends` and built by the seam, not written here: on Android
// they are properties of a GType registered over `StackLayout`, so `instanceof GObject.Object`,
// `bind_property` and `Gio.ListStore` identity are the real thing; everywhere else they are the
// seam's own accessors, with the same names, the same notifies and the same equal-write rule.
// `widgets/signals.ts` says why, at length.
//
// WHAT THAT COSTS THIS FILE. There is no `get title()` / `set title()` any more — node-gi reads
// a property out of the GObject's store and never calls a JS getter, so an accessor here would
// shadow the registered one and leave the store stale. `declare title: string;` keeps the type
// and the docs without emitting code. And `_apply()` is no longer called from a setter: it hangs
// off `notify::title` / `notify::subtitle`, which is where both legs agree a change is a change.

import { Label, StackLayout } from '@nativescript/core';
import { WindowTitleState, toLabelVisuals } from './row-state.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import type { GObjectNotify } from './signals.js';

/** Event name emitted when {@link AdwWindowTitle.title} changes. */
export const NOTIFY_TITLE = 'notify::title';

/** Event name emitted when {@link AdwWindowTitle.subtitle} changes. */
export const NOTIFY_SUBTITLE = 'notify::subtitle';

export class AdwWindowTitle extends withSignals(StackLayout, {
    GTypeName: 'AdwWindowTitle',
    Properties: {
        title: { kind: 'string', default: '', blurb: 'The title to display' },
        subtitle: { kind: 'string', default: '', blurb: 'The subtitle to display' },
    },
}) {
    static readonly GTypeName: string = 'AdwWindowTitle';

    /** The window title (bold, top line). Empty collapses its label. */
    declare title: string;

    /** The subtitle (dim second line). Empty collapses its label. */
    declare subtitle: string;

    /** `notify('title')` beside NativeScript's `notify({ eventName })` — see {@link GObjectNotify}. */
    declare notify: GObjectNotify;

    /** The bold title label. */
    protected readonly _titleLabel: Label;
    /** The dim subtitle label. */
    protected readonly _subtitleLabel: Label;
    /** The headless title/subtitle pair + change detection (ADR 0004). */
    private readonly _state = new WindowTitleState();

    constructor(props?: ConstructProps<AdwWindowTitle>) {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-window-title';
        this.horizontalAlignment = 'center';

        const titleLabel = new Label();
        titleLabel.className = 'adw-window-title-title';
        titleLabel.horizontalAlignment = 'center';
        this.addChild(titleLabel);
        this._titleLabel = titleLabel;

        // Both labels stay in the tree and collapse when empty — the same shape
        // `preferences-group-state.ts` and the action row use. Adding/removing
        // them made the rule structural, which is why it was only ever applied
        // to one of the two.
        const subtitleLabel = new Label();
        subtitleLabel.className = 'adw-window-title-subtitle';
        subtitleLabel.horizontalAlignment = 'center';
        this.addChild(subtitleLabel);
        this._subtitleLabel = subtitleLabel;

        // The property is the source of truth now, and a notification is what says it moved —
        // on either leg. The handler reads the EMITTER rather than an enclosing `this`, which is
        // the idiom `tests/integration/nativescript-gi/app/specs/foreign-parent.ts` settled on.
        this.connect(NOTIFY_TITLE, (self) => self._apply());
        this.connect(NOTIFY_SUBTITLE, (self) => self._apply());

        this._apply();

        applyConstructProps(this, props);
    }

    /** Push the derived text + visibility onto the two `Label`s. */
    private _apply(): void {
        // `WindowTitleState` stays the headless half (ADR 0004) and keeps deriving the visuals;
        // what it no longer owns is the CHANGE DETECTION, which is the property's own now.
        this._state.setTitle(this.title);
        this._state.setSubtitle(this.subtitle);
        const visuals = toLabelVisuals(this._state.state);
        this._titleLabel.text = visuals.title;
        this._titleLabel.visibility = visuals.titleVisibility;
        this._subtitleLabel.text = visuals.subtitle;
        this._subtitleLabel.visibility = visuals.subtitleVisibility;
    }
}
