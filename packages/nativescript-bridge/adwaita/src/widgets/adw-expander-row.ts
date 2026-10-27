// AdwExpanderRow — a Libadwaita-style expander row for NativeScript.
//
// Extends {@link AdwActionRow}: the inherited title/subtitle stack is the always-
// visible header, a trailing cluster (consumer suffixes, the enable switch, the
// chevron) sits in the suffix column, and a second grid row (spanning both columns)
// holds a `StackLayout` of child rows that is revealed/collapsed by toggling its
// `visibility`. Mirrors `Adw.ExpanderRow`: `add_row(child)` appends to the
// disclosure, `expanded` drives the reveal. Tapping the HEADER toggles it — see the
// constructor for which views carry that and the device measurement behind it.
//
// THE THREE PROPERTIES ARE DECLARED, NOT HELD IN AN `ExpanderState` (ADR 0105 § 2, route D).
// `expanded`, `enable-expansion` and `show-enable-switch` are GObject properties of this
// class, so on Android they live in the GObject's own store — which is what `bind_property`
// binds to and what `NodeGiGetProperty` reads. `ExpanderState` stays in
// `@gjsify/adwaita-core` for `@gjsify/adwaita-web` and `react-native`; holding it here beside
// the property would be the defect `adw-switch-row.ts` names: two stores, one of them stale.
//
// THE FIRST DECLARED PROPERTY THAT OWNS A SUBTREE. `title` or `active` decide how a view
// LOOKS; `expanded` decides whether the rows a consumer added with `add_row` are reachable at
// all. That changes nothing about the seam — the property is still the only store and
// `notify::expanded` still the only render trigger — and it is worth saying why: the rows live
// in the tree from construction and the reveal is a `visibility` toggle, so expansion is a
// REPAINT, never a structural change. A collapsed row therefore still answers
// {@link disclosureRows}, exactly as `gtk_revealer`'s hidden child stays its child.
//
// THE GATING, AND WHY IT LIVES IN THE NORMALIZERS. libadwaita couples two of the three:
//
//   * `adw_expander_row_set_expanded` coerces with `expanded && priv->enable_expansion`
//     (C:264) BEFORE its equal-return, so a write of `true` while expansion is disabled
//     resolves to `false` and emits nothing at all.
//   * `adw_expander_row_set_enable_expansion` stores, then calls
//     `set_expanded (priv->enable_expansion)` (C:310), THEN notifies its own property.
//     Enabling expands, disabling collapses, and `notify::expanded` always precedes
//     `notify::enable-expansion`.
//
// Both halves are {@link DeclaredProperty.normalize} work, because a normalizer is the only
// hook that runs on BOTH legs ahead of the store and ahead of the equal-write check — a
// `notify::` handler runs after the value already landed, and a refusal from one cannot be
// seen (`signals.ts` on logged handler exceptions). So `enable-expansion`'s normalizer does
// its own equal-return, arms {@link EXPANSION_GATE}, cross-writes `expanded` (which emits
// `notify::expanded` first, from inside the still-running write), disarms the gate and returns
// — and the seam then stores and emits `notify::enable-expansion`. The gate is what lets
// `expanded`'s own normalizer read the INCOMING `enable-expansion` instead of the stale stored
// one, which is the C's "store first, then set_expanded" order expressed without a store to
// write early.
//
// `show-enable-switch` gates NOTHING logically — it only reveals the switch, which is the
// one user affordance that writes `enable-expansion` (the .ui binds them bidirectionally).
// Hiding it does not re-enable expansion, and that asymmetry is upstream's.
//
// WHAT THE OLD EVENT PAYLOAD BECAME. `NotifyExpandedEventData` carried the new value; a real
// `notify::` carries a `GParamSpec`, never a value, so a handler reads the emitter —
// `(self) => self.expanded`. It is gone rather than kept as an alias: this port carries no
// backward compatibility (`status/open-todos/nativescript.md`).
//
// NOTE on animation: the NativeScript CSS subset used by this package has no
// `transform` / height-transition support, so the reveal is an instant
// `visibility` toggle rather than the animated slide `Adw.ExpanderRow` performs.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_row.scss`.
// Reference: refs/libadwaita/src/adw-expander-row.c, adw-expander-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_expanders.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, StackLayout, Switch } from '@nativescript/core';
import { panDownSymbolic, panUpSymbolic } from '@gjsify/adwaita-icons/ui';
import { AdwActionRow } from './adw-action-row.js';
import { GtkImage } from './gtk-image.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { switchClassName } from './row-state.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { readDeclaredValue, withProperties } from './signals.js';

/** Event name emitted when {@link AdwExpanderRow.expanded} changes. Mirrors GObject `notify::expanded`. */
export const NOTIFY_EXPANDED = 'notify::expanded';

/** Event name emitted when {@link AdwExpanderRow.enableExpansion} changes. */
export const NOTIFY_ENABLE_EXPANSION = 'notify::enable-expansion';

/** Event name emitted when {@link AdwExpanderRow.showEnableSwitch} changes. */
export const NOTIFY_SHOW_ENABLE_SWITCH = 'notify::show-enable-switch';

/**
 * Opacity of the chevron while expansion is disabled.
 *
 * `.expander-row-arrow:disabled` is not expressible here: the NS CSS subset has no widget
 * states, so the insensitive look the `.ui`'s `sensitive` binding produces (bound to
 * `enable-expansion`, adw-expander-row.ui:60) has to be an opacity the row assigns.
 *
 * 0.5 is `--disabled-opacity`, which `_expanders.scss:7` takes and which has no dark-scheme
 * override (`tokens.generated.ts:255`) — so one number covers both schemes. NOT shared with
 * `NS_INSENSITIVE_OPACITY` (0.3, `entry-row-view.ts`): that is libadwaita's stronger
 * `$strong_disabled_opacity`, which only the entry row's pencil takes.
 */
export const NS_EXPANDER_ARROW_DISABLED_OPACITY = 0.5;

/** What an XML child or an authored tree may ask for; anything else is a disclosure row. */
const EXPANDER_ROW_SLOTS = ['prefix', 'suffix'] as const;

/**
 * The row a declared property's {@link DeclaredProperty.normalize} reads its siblings off.
 *
 * Structural, because `normalize` is handed a bare `object` — the seam knows nothing of this
 * class, and a cast to `AdwExpanderRow` would be a lie while the instance is still constructing
 * (the `EntryRowValues` precedent in `adw-entry-row.ts`).
 */
interface ExpanderRowValues {
    /** The in-flight `enable-expansion` write's value, or `undefined` when none is running. */
    _expansionGate: boolean | undefined;
    readonly enableExpansion: boolean;
    expanded: boolean;
}

export class AdwExpanderRow extends withProperties(AdwActionRow, {
    GTypeName: 'AdwExpanderRow',
    Properties: {
        expanded: {
            kind: 'boolean',
            default: false,
            blurb: 'Whether the row is expanded',
            // `expanded = !!expanded && priv->enable_expansion` (C:264), ahead of the
            // equal-return — so a write of `true` while expansion is disabled resolves to the
            // `false` already held and emits nothing, which is what the seam's equal-write rule
            // then makes of it. `_expansionGate` is the value an `enable-expansion` write is
            // CURRENTLY installing: the C stores it before calling `set_expanded`, and this is
            // that ordering without a store to write early.
            normalize: (value, self) => {
                const row = self as ExpanderRowValues;
                const next = readDeclaredValue('expanded', 'boolean', value) as boolean;
                return next && (row._expansionGate ?? row.enableExpansion);
            },
        },
        'enable-expansion': {
            kind: 'boolean',
            default: true,
            blurb: 'Whether the expansion is enabled',
            // `adw_expander_row_set_enable_expansion` (C:303-312): equal-return, store,
            // `set_expanded (priv->enable_expansion)`, notify. Enabling EXPANDS and disabling
            // COLLAPSES, and `notify::expanded` always comes FIRST — which is why the
            // cross-write happens here, inside the still-running write, rather than from a
            // `notify::enable-expansion` handler that could only ever run after it.
            normalize: (value, self) => {
                const row = self as ExpanderRowValues;
                const next = readDeclaredValue('enable-expansion', 'boolean', value) as boolean;
                // The equal-return is this normalizer's OWN, because the seam's runs after it
                // and the cross-write must not happen for a write that changes nothing.
                if (next === row.enableExpansion) return next;
                row._expansionGate = next;
                try {
                    row.expanded = next;
                } finally {
                    row._expansionGate = undefined;
                }
                return next;
            },
        },
        'show-enable-switch': {
            kind: 'boolean',
            default: false,
            blurb: 'Whether the switch enabling the expansion is visible',
        },
    },
}) {
    static readonly GTypeName: string = 'AdwExpanderRow';

    /** The names this widget's `_addChildFromBuilder` honours — see `./builder-slots.ts`. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(EXPANDER_ROW_SLOTS, 'row');

    /** `AdwExpanderRow` derives from `AdwPreferencesRow` in C
     *  (adw-expander-row.c:72), so the search does not consult a subtitle here. */
    override readonly isActionRow: boolean = false;

    /** Whether the disclosure is revealed. Coerced to `false` while {@link enableExpansion} is off. */
    declare expanded: boolean;

    /** `Adw.ExpanderRow:enable-expansion` — whether the row can be expanded at all. */
    declare enableExpansion: boolean;

    /** `Adw.ExpanderRow:show-enable-switch` — whether the enable switch is visible. */
    declare showEnableSwitch: boolean;

    /** The disclosure chevron — a plain symbolic icon, like Adw.ExpanderRow's arrow. */
    protected readonly _toggle: GtkImage;
    /** The switch that writes {@link enableExpansion} (`enable_switch` in the .ui). */
    protected readonly _enableSwitch: Switch;
    /** The consumer suffix BOX — `priv->suffixes`, not a slot. */
    protected readonly _suffixes: StackLayout;
    /** The container of revealed child rows (second grid row). */
    protected readonly _disclosure: StackLayout;

    /**
     * See {@link ExpanderRowValues._expansionGate}. A field and not a declared property because
     * it is not state at all — it is one write's argument, visible for the length of that write.
     */
    private _expansionGate: boolean | undefined = undefined;

    /** The newest suffix installed through {@link add_suffix} — what `suffix` answers. */
    private _slotSuffix: View | null = null;

    constructor(props?: ConstructProps<AdwExpanderRow>) {
        super();

        this.className = 'adw-row adw-action-row adw-expander-row';

        // `activatable=False` on the expander itself (adw-expander-row.ui:18) — the inner
        // header row is the activatable one there, and this port has no inner row, so the
        // header-scoped tap listeners below stand in for it. Inherited default is already
        // `false`; stated so the two halves of that decision sit together.
        this.activatable = false;

        // Second grid row holds the disclosure box across both columns.
        this.addRow(new ItemSpec(1, 'auto'));

        const disclosure = new StackLayout();
        disclosure.orientation = 'vertical';
        disclosure.className = 'adw-expander-disclosure';
        disclosure.visibility = 'collapse';
        GridLayout.setRow(disclosure, 1);
        GridLayout.setColumn(disclosure, 0);
        GridLayout.setColumnSpan(disclosure, 3);
        this.addChild(disclosure);
        this._disclosure = disclosure;

        // THE TRAILING CLUSTER, in the .ui's own order: the suffixes box, then the enable
        // switch, then the arrow (adw-expander-row.ui:39-62). One horizontal box installed
        // ONCE through the inherited single-slot `super.add_suffix`, so a consumer suffix
        // joins it instead of evicting the affordances — the shape `adw-entry-row.ts` uses
        // for the same reason.
        const cluster = new StackLayout();
        cluster.orientation = 'horizontal';
        cluster.className = 'adw-expander-row-cluster';

        // `priv->suffixes` starts invisible and becomes visible with its first child
        // (`adw_expander_row_add_suffix`), so an empty box contributes no spacing.
        const suffixes = new StackLayout();
        suffixes.orientation = 'horizontal';
        suffixes.className = 'adw-expander-row-suffixes';
        suffixes.visibility = 'collapse';
        cluster.addChild(suffixes);
        this._suffixes = suffixes;

        const enableSwitch = new Switch();
        enableSwitch.className = switchClassName(true);
        enableSwitch.visibility = 'collapse';
        cluster.addChild(enableSwitch);
        this._enableSwitch = enableSwitch;

        // Adwaita expanders use a plain chevron affordance (pan-down = collapsed,
        // pan-up = expanded) — a REAL symbolic icon, not a `▾` glyph or a button.
        const toggle = new GtkImage();
        toggle.iconName = panDownSymbolic;
        toggle.className = `${toggle.className} adw-expander-toggle`.trim();
        cluster.addChild(toggle);
        this._toggle = toggle;

        super.add_suffix(cluster);

        // The switch is the one user affordance that writes `enable-expansion`, which the
        // `.ui` expresses as a bidirectional binding (adw-expander-row.ui:50-52). Here it is
        // the same single funnel `adw-switch-row.ts` uses: NativeScript fires `checkedChange`
        // for a programmatic write too, and the property's own equal-write rule is what stops
        // the re-entry back out of the render below.
        enableSwitch.addEventListener('checkedChange', () => {
            this.enableExpansion = enableSwitch.checked;
        });

        // Each property renders from its OWN notify, so an equal write re-paints nothing and
        // no setter needs a guard. `enable-expansion`'s cross-write means a single assignment
        // runs the `expanded` handler first — the order libadwaita emits in.
        this.connect(NOTIFY_EXPANDED, (self) => self._applyExpanded());
        this.connect(NOTIFY_ENABLE_EXPANSION, (self) => self._applyEnableExpansion());
        this.connect(NOTIFY_SHOW_ENABLE_SWITCH, (self) => self._applyShowEnableSwitch());

        // `adw_expander_row_init`'s start: enabled, collapsed, switch hidden. Equal to the
        // declared defaults, so construction emits nothing (C:338-339 does the same) and the
        // first paint has to be driven rather than observed.
        this._applyExpanded();
        this._applyEnableExpansion();
        this._applyShowEnableSwitch();

        // WHAT TOGGLES THE ROW, and why it is wired exactly here (#1155).
        //
        // libadwaita expands from the HEADER, and says why in the template:
        // "The header row must be activatable to toggle expansion by clicking it"
        // (adw-expander-row.ui:24-26 → activate_cb → adw-expander-row.c:94-98). It
        // sets `activatable=False` on the expander itself and True on the inner
        // header, so the REVEALED rows cannot toggle their own parent.
        //
        // This port has no inner header widget — it IS an AdwActionRow — so the
        // targets are the header's own children: the title/subtitle stack, which
        // fills the flexible column and therefore most of the header, plus the
        // chevron. Both sit in grid row 0; the disclosure is row 1.
        //
        // MEASURED ON DEVICE, because the answer decides the shape and no
        // off-device spec can reach it (`extends GridLayout` cannot be imported):
        // a NativeScript `tap` does NOT stop at a child that handles it. A tap on a
        // plain Label inside the disclosure fires its own listener AND the row's;
        // so does a tap on a nested switch row. (A nested entry row fires neither —
        // the native EditText consumes it.) So the tempting version, toggling from
        // the row's own `tap` or from `activate()`, would collapse the row whenever
        // a user touched anything inside it.
        //
        // For the same reason the chevron's listener is the ONLY one on the chevron:
        // if the row itself also toggled, a chevron tap would toggle twice and read
        // as dead. Siblings do not receive each other's taps, which is what makes
        // two header-scoped listeners safe.
        //
        // The affordance was previously the chevron alone — a 16-unit square, on the
        // port whose targets are fingers.
        //
        // NOTHING GATES IT, and that is the gating: `activate_cb` calls
        // `set_expanded (!priv->expanded)` unconditionally (C:94-98), and while expansion is
        // disabled `expanded` is already `false`, so the write of `true` is coerced back to
        // `false` by the property's own normalizer and emits nothing. The no-op is the
        // property's, not a branch here — one rule instead of two that can disagree.
        const toggleOnTap = () => {
            this.expanded = !this.expanded;
        };
        this._textStack.addEventListener('tap', toggleOnTap);
        toggle.addEventListener('tap', toggleOnTap);

        applyConstructProps(this, props);
    }

    get_expanded(): boolean {
        return this.expanded;
    }

    set_expanded(expanded: boolean): void {
        this.expanded = expanded;
    }

    get_enable_expansion(): boolean {
        return this.enableExpansion;
    }

    set_enable_expansion(enableExpansion: boolean): void {
        this.enableExpansion = enableExpansion;
    }

    get_show_enable_switch(): boolean {
        return this.showEnableSwitch;
    }

    set_show_enable_switch(showEnableSwitch: boolean): void {
        this.showEnableSwitch = showEnableSwitch;
    }

    /**
     * Append a child row (or any view) to the disclosure container —
     * `adw_expander_row_add_row`.
     *
     * The GIR name is what ended a collision: this method was `addRow(View | ItemSpec)`,
     * a union that existed only because `GridLayoutBase` already declares
     * `addRow(itemSpec: ItemSpec)` and a same-named method with a narrower parameter is
     * a type error against the real `@nativescript/core`. `add_row` is nobody else's, so
     * the grid's track setup and the row's child list no longer share a name.
     */
    add_row(view: View): void {
        this._disclosure.addChild(view);
    }

    /**
     * Install a suffix — `adw_expander_row_add_suffix`, which PREPENDS into `priv->suffixes`
     * (`gtk_box_prepend`, C:449) and makes that box visible.
     *
     * The suffixes box COEXISTS with the enable switch and the arrow, as upstream's does: it
     * is the first child of the trailing cluster the constructor installed once through the
     * inherited single-slot `add_suffix`, so a consumer suffix no longer has to evict an
     * affordance to be placed. That is what retired this class's old refusal of an authored
     * `slot: "suffix"` — the refusal existed because the one slot held the chevron, and the
     * cluster is why it no longer does.
     */
    override add_suffix(view: View): void {
        view.className = `${view.className ?? ''} adw-row-suffix`.trim();
        this._suffixes.insertChild(view, 0);
        this._suffixes.visibility = 'visible';
        this._slotSuffix = view;
    }

    /**
     * Remove a prefix, a suffix or a disclosure row — `adw_expander_row_remove`, which
     * dispatches on where the child actually is (C:466-477).
     *
     * The box going invisible again when it empties is upstream's own line:
     * `gtk_widget_set_visible (parent, gtk_widget_get_first_child (parent) != NULL)`.
     */
    override remove(view: View): void {
        if (view === this.prefix) {
            super.remove(view);
            return;
        }
        if (this._suffixes.getChildIndex(view) !== -1) {
            this._suffixes.removeChild(view);
            if (this._suffixes.getChildrenCount() === 0) this._suffixes.visibility = 'collapse';
            if (view === this._slotSuffix) this._slotSuffix = this._lastSuffix();
            return;
        }
        this._disclosure.removeChild(view);
    }

    /** The suffix most recently installed through {@link add_suffix}, or `null`. */
    override get suffix(): View | null {
        return this._slotSuffix;
    }

    /**
     * An XML child is a ROW inside the disclosure — the one placement an expander row
     * adds over its base, and the reason this overrides `AdwActionRow`'s prefix/suffix
     * rule rather than inheriting it. The two edges stay reachable by name.
     */
    _addChildFromBuilder(name: string, view: View): void {
        const slot = resolveBuilderSlot(name, EXPANDER_ROW_SLOTS, 'row');
        if (slot === 'row') this.add_row(view);
        else super._addChildFromBuilder(slot, view);
    }

    /**
     * The rows inside the disclosure, in order — the read-back for `add_row`.
     *
     * Answers the same list whether the row is expanded or collapsed: the reveal is a
     * `visibility` toggle, never a structural change (see the module header).
     *
     * NOT `rows`, which is what it was called first. `GridLayoutBase` declares `rows`
     * as a SETTER-ONLY accessor (its getter is `rowsInternal`), so a getter of that
     * name on a subclass shadows it: `expanderRow.rows = 'auto,*'` then throws
     * `TypeError: Cannot set property rows … which has only a getter` in strict mode,
     * which every NativeScript bundle is. Measured against that prototype shape, and
     * it would have broken apps that never touch XML. `rows` and `columns` are the
     * only two accessors of that shape on the bases this package extends —
     * `scripts/check-nativescript-xml-doors.mjs` holds both (in `SETTER_ONLY_ON_BASE`,
     * `scripts/nativescript-xml-doors.mjs:116`).
     */
    get disclosureRows(): readonly View[] {
        const out: View[] = [];
        for (let i = 0; i < this._disclosure.getChildrenCount(); i++) out.push(this._disclosure.getChildAt(i));
        return out;
    }

    /** The suffix box's newest remaining child — what `suffix` falls back to after a removal. */
    private _lastSuffix(): View | null {
        return this._suffixes.getChildrenCount() === 0 ? null : this._suffixes.getChildAt(0);
    }

    /** Reveal or collapse the disclosure and turn the chevron. Run from `notify::expanded`. */
    private _applyExpanded(): void {
        const expanded = this.expanded;
        this._disclosure.visibility = expanded ? 'visible' : 'collapse';
        this._toggle.iconName = expanded ? panUpSymbolic : panDownSymbolic;
    }

    /**
     * Mirror `enable-expansion` onto the switch and the arrow's sensitivity.
     *
     * The COLLAPSE half is not here: it happens inside the write itself, in the property's
     * normalizer, because libadwaita emits `notify::expanded` before `notify::enable-expansion`
     * and a handler cannot run earlier than the write that invoked it.
     */
    private _applyEnableExpansion(): void {
        const enabled = this.enableExpansion;
        this._enableSwitch.checked = enabled;
        this._enableSwitch.className = switchClassName(enabled);
        // `sensitive` on the arrow (adw-expander-row.ui:60), as the one thing the CSS subset
        // can express for it — see {@link NS_EXPANDER_ARROW_DISABLED_OPACITY}.
        this._toggle.opacity = enabled ? 1 : NS_EXPANDER_ARROW_DISABLED_OPACITY;
        this._toggle.isUserInteractionEnabled = enabled;
    }

    /** Show or hide the enable switch. Run from `notify::show-enable-switch`. */
    private _applyShowEnableSwitch(): void {
        this._enableSwitch.visibility = this.showEnableSwitch ? 'visible' : 'collapse';
    }
}
