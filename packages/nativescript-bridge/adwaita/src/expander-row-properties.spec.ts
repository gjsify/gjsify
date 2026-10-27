// THE FIRST DECLARED PROPERTY THAT OWNS A SUBTREE, AND THE FIRST PAIR THAT GATE EACH OTHER
// (ADR 0105 § 2, route D), measured on the pure-JS leg.
//
// `AdwExpanderRow extends withProperties(AdwActionRow, …)` declares THREE: `expanded`,
// `enable-expansion`, `show-enable-switch`. Two of them are coupled, and libadwaita's coupling
// is directional in a way a naive port gets wrong in both places:
//
//   * `set_expanded` coerces `expanded && enable_expansion` BEFORE the equal-return
//     (adw-expander-row.c:264), so `expanded = true` while expansion is off is not a refused
//     write — it is a write of `false`, over a stored `false`, which emits NOTHING.
//   * `set_enable_expansion` cross-writes `expanded` and only THEN notifies itself
//     (C:303-312), so one assignment emits `notify::expanded` first and
//     `notify::enable-expansion` second.
//
// The ORDER is what this file pins hardest, because it is the half a port silently gets
// backwards: doing the collapse from a `notify::enable-expansion` handler compiles, renders
// identically on a screenshot, and emits in the opposite order forever. The vectors that fail
// without the normalizer-side gate are marked A/B below.
//
// The SUBTREE half is almost an anti-test: `disclosureRows` answers the same list collapsed as
// expanded, because the reveal is a `visibility` toggle rather than a structural change. A
// property owning a subtree therefore needs nothing from the seam that a property owning a
// label does not — which is the finding, and it has to be asserted to stay one.
//
// This lives on the TREES entry (`src/test.trees.mts`): the chain evaluates `@nativescript/core`
// at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import {
    NOTIFY_ENABLE_EXPANSION,
    NOTIFY_EXPANDED,
    NOTIFY_SHOW_ENABLE_SWITCH,
    NS_EXPANDER_ARROW_DISABLED_OPACITY,
} from './widgets/adw-expander-row.js';

/** The parts the three properties render into, each written only from its own `notify::`. */
interface ExpanderParts {
    _toggle: { iconName: string; opacity: number; isUserInteractionEnabled: boolean; _emit(e: string): void };
    _enableSwitch: { checked: boolean; className: string; visibility: string };
    _suffixes: { visibility: string; getChildrenCount(): number };
    _disclosure: { visibility: string };
    _textStack: { _emit(e: string): void };
}

function partsOf(row: Adw.ExpanderRow): ExpanderParts {
    return row as unknown as ExpanderParts;
}

/** What NativeScript's XML builder does to an attribute: assign the raw string. */
function xml(row: Adw.ExpanderRow, name: string, value: string): void {
    (row as unknown as Record<string, unknown>)[name] = value;
}

export const AdwExpanderRowPropertiesNsTest = async () => {
    await describe('Adw.ExpanderRow properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            const mixin = Object.getPrototypeOf(Adw.ExpanderRow) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
            expect(Object.hasOwn(mixin, '$gtypeName')).toBe(false);
        });

        await it("starts at adw_expander_row_init's three defaults, having emitted nothing", () => {
            const row = new Adw.ExpanderRow();
            expect(row.expanded).toBe(false);
            expect(row.enableExpansion).toBe(true);
            expect(row.showEnableSwitch).toBe(false);
            // `activatable=False` on the expander itself (adw-expander-row.ui:18).
            expect(row.activatable).toBe(false);
            // The defaults equal the declarations, so the first paint is DRIVEN by the
            // constructor rather than observed from a notify.
            const parts = partsOf(row);
            expect(parts._disclosure.visibility).toBe('collapse');
            expect(parts._enableSwitch.visibility).toBe('collapse');
            expect(parts._enableSwitch.checked).toBe(true);
            expect(parts._toggle.opacity).toBe(1);
        });

        await it('answers the four it inherits from the action row', () => {
            const row = new Adw.ExpanderRow({ title: 'Proxy', subtitle: 'Custom' });
            expect(row.title).toBe('Proxy');
            expect(row.subtitle).toBe('Custom');
            expect(row.iconName).toBe('');
            row.iconName = 'network-server-symbolic';
            expect((row as unknown as Record<string, unknown>)['icon-name']).toBe('network-server-symbolic');
        });

        await it('reveals the disclosure and turns the chevron from notify::expanded', () => {
            const row = new Adw.ExpanderRow();
            const parts = partsOf(row);
            const collapsedIcon = parts._toggle.iconName;
            row.expanded = true;
            expect(parts._disclosure.visibility).toBe('visible');
            expect(parts._toggle.iconName).not.toBe(collapsedIcon);
            row.expanded = false;
            expect(parts._disclosure.visibility).toBe('collapse');
            expect(parts._toggle.iconName).toBe(collapsedIcon);
        });

        await it('keeps the rows in the tree while collapsed — a repaint, not a restructure', () => {
            const row = new Adw.ExpanderRow();
            const host = new Adw.EntryRow();
            const auth = new Adw.SwitchRow();
            row.add_row(host);
            row.add_row(auth);
            expect(row.disclosureRows).toStrictEqual([host, auth]);
            row.expanded = true;
            expect(row.disclosureRows).toStrictEqual([host, auth]);
            row.expanded = false;
            // The whole of what "owns a subtree" costs the seam: nothing.
            expect(row.disclosureRows).toStrictEqual([host, auth]);
        });

        await it('notifies a real change and stays silent on an equal write', () => {
            const row = new Adw.ExpanderRow();
            const seen: boolean[] = [];
            row.connect(NOTIFY_EXPANDED, (self) => seen.push(self.expanded));
            row.expanded = true;
            row.expanded = true;
            row.expanded = false;
            expect(seen).toStrictEqual([true, false]);
        });

        // ===== THE GATE (A/B) =====

        await it('A/B: coerces expanded=true to false while expansion is off, emitting nothing', () => {
            // Without the `expanded` normalizer's `next && gate` this stores `true`, reveals the
            // disclosure of a row the user cannot expand, and emits one `notify::expanded`.
            const row = new Adw.ExpanderRow();
            row.enableExpansion = false;
            const seen: boolean[] = [];
            row.connect(NOTIFY_EXPANDED, (self) => seen.push(self.expanded));
            row.expanded = true;
            expect(row.expanded).toBe(false);
            expect(seen).toStrictEqual([]);
            expect(partsOf(row)._disclosure.visibility).toBe('collapse');
        });

        await it('A/B: enabling expansion expands, and disabling collapses', () => {
            // `set_expanded (priv->enable_expansion)` (C:310) — the cross-write is not a
            // convenience, it is the only reason `enable-expansion` moves `expanded` at all.
            const row = new Adw.ExpanderRow();
            row.enableExpansion = false;
            expect(row.expanded).toBe(false);
            row.enableExpansion = true;
            expect(row.expanded).toBe(true);
            expect(partsOf(row)._disclosure.visibility).toBe('visible');
            row.enableExpansion = false;
            expect(row.expanded).toBe(false);
            expect(partsOf(row)._disclosure.visibility).toBe('collapse');
        });

        await it('A/B: emits notify::expanded BEFORE notify::enable-expansion', () => {
            // The vector that fails if the collapse is done from a `notify::enable-expansion`
            // handler instead of inside the write: same renders, reversed order, forever.
            const row = new Adw.ExpanderRow();
            const seen: string[] = [];
            row.connect(NOTIFY_EXPANDED, (self) => seen.push(`expanded=${self.expanded}`));
            row.connect(NOTIFY_ENABLE_EXPANSION, (self) => seen.push(`enable=${self.enableExpansion}`));
            row.enableExpansion = false;
            expect(seen).toStrictEqual(['enable=false']);
            row.enableExpansion = true;
            expect(seen).toStrictEqual(['enable=false', 'expanded=true', 'enable=true']);
        });

        await it('reads the INCOMING enable-expansion, not the stored one, during the cross-write', () => {
            // The gate's whole job: while `enable-expansion` is going `false → true`, the
            // `expanded` write it issues must see `true`. Reading the store would see `false`
            // (the seam stores after `normalize`) and coerce the expansion away.
            const row = new Adw.ExpanderRow();
            row.enableExpansion = false;
            let duringEnable: boolean | null = null;
            row.connect(NOTIFY_EXPANDED, (self) => {
                duringEnable = self.enableExpansion;
            });
            row.enableExpansion = true;
            // Still the OLD stored value at that point, which is exactly the C's ordering.
            expect(duringEnable).toBe(false);
            expect(row.expanded).toBe(true);
        });

        await it('does not cross-write for an equal enable-expansion write', () => {
            const row = new Adw.ExpanderRow();
            row.expanded = true;
            const seen: string[] = [];
            row.connect(NOTIFY_EXPANDED, () => seen.push('expanded'));
            row.connect(NOTIFY_ENABLE_EXPANSION, () => seen.push('enable'));
            row.enableExpansion = true;
            expect(seen).toStrictEqual([]);
            expect(row.expanded).toBe(true);
        });

        await it('mirrors enable-expansion onto the switch and the chevron', () => {
            const row = new Adw.ExpanderRow();
            const parts = partsOf(row);
            row.enableExpansion = false;
            expect(parts._enableSwitch.checked).toBe(false);
            expect(parts._enableSwitch.className).toBe('adw-switch off');
            expect(parts._toggle.opacity).toBe(NS_EXPANDER_ARROW_DISABLED_OPACITY);
            expect(parts._toggle.isUserInteractionEnabled).toBe(false);
            row.enableExpansion = true;
            expect(parts._enableSwitch.className).toBe('adw-switch');
            expect(parts._toggle.opacity).toBe(1);
            expect(parts._toggle.isUserInteractionEnabled).toBe(true);
        });

        await it('show-enable-switch reveals the switch and gates nothing else', () => {
            const row = new Adw.ExpanderRow();
            const parts = partsOf(row);
            const seen: boolean[] = [];
            row.connect(NOTIFY_SHOW_ENABLE_SWITCH, (self) => seen.push(self.showEnableSwitch));
            row.showEnableSwitch = true;
            expect(parts._enableSwitch.visibility).toBe('visible');
            // Upstream's asymmetry: hiding the switch does NOT re-enable expansion.
            row.enableExpansion = false;
            row.showEnableSwitch = false;
            expect(row.enableExpansion).toBe(false);
            expect(parts._enableSwitch.visibility).toBe('collapse');
            expect(seen).toStrictEqual([true, false]);
        });

        await it('follows a flip of the switch handle back into enable-expansion', () => {
            // The one user affordance that writes it — the `.ui`'s bidirectional binding
            // (adw-expander-row.ui:50-52).
            const row = new Adw.ExpanderRow();
            row.showEnableSwitch = true;
            row.expanded = true;
            const sw = partsOf(row)._enableSwitch as unknown as { checked: boolean };
            sw.checked = false;
            expect(row.enableExpansion).toBe(false);
            expect(row.expanded).toBe(false);
            sw.checked = true;
            expect(row.enableExpansion).toBe(true);
            expect(row.expanded).toBe(true);
        });

        // ===== THE OTHER SEAM DOORS =====

        await it('toggles from a header tap, and the toggle is a no-op while disabled', () => {
            const row = new Adw.ExpanderRow();
            const parts = partsOf(row);
            parts._textStack._emit('tap');
            expect(row.expanded).toBe(true);
            parts._toggle._emit('tap');
            expect(row.expanded).toBe(false);
            // `activate_cb` is ungated (C:94-98): the refusal is the property's normalizer.
            row.enableExpansion = false;
            parts._textStack._emit('tap');
            expect(row.expanded).toBe(false);
        });

        await it('notifies an INHERITED property under its own detail, from the leaf', () => {
            const row = new Adw.ExpanderRow();
            const seen: string[] = [];
            row.connect('notify::title', (self) => seen.push(self.title));
            row.connect(NOTIFY_EXPANDED, () => seen.push('expanded'));
            row.title = 'Proxy';
            row.expanded = true;
            expect(seen).toStrictEqual(['Proxy', 'expanded']);
        });

        await it('takes the id back from connect and stops on disconnect', () => {
            const row = new Adw.ExpanderRow();
            const seen: boolean[] = [];
            const id = row.connect(NOTIFY_EXPANDED, (self) => seen.push(self.expanded));
            row.expanded = true;
            row.disconnect(id);
            row.expanded = false;
            expect(seen).toStrictEqual([true]);
            expect(() => row.disconnect(id)).toThrow();
        });

        await it("emits each notify from GJS's notify(), and refuses an undeclared name", () => {
            const row = new Adw.ExpanderRow();
            const seen: string[] = [];
            row.connect(NOTIFY_EXPANDED, () => seen.push('expanded'));
            row.connect(NOTIFY_ENABLE_EXPANSION, () => seen.push('enable'));
            row.connect(NOTIFY_SHOW_ENABLE_SWITCH, () => seen.push('show'));
            row.notify('expanded');
            row.notify('enable-expansion');
            row.notify('show-enable-switch');
            expect(seen).toStrictEqual(['expanded', 'enable', 'show']);
            expect(() => row.notify('nope')).toThrow();
        });

        await it('takes the XML spellings as typed values and refuses garbage', () => {
            const row = new Adw.ExpanderRow();
            xml(row, 'expanded', 'true');
            expect(row.expanded).toBe(true);
            xml(row, 'show-enable-switch', 'true');
            expect(row.showEnableSwitch).toBe(true);
            xml(row, 'enable-expansion', 'false');
            expect(row.enableExpansion).toBe(false);
            expect(row.expanded).toBe(false);
            expect(() => xml(row, 'expanded', 'maybe')).toThrow();
        });

        await it('still answers the port one-argument property door', () => {
            const row = new Adw.ExpanderRow();
            row.set_property('expanded', true);
            expect(row.get_property('expanded')).toBe(true);
            row.set_property('enable-expansion', false);
            expect(row.get_property('enable-expansion')).toBe(false);
            expect(row.get_property('expanded')).toBe(false);
            row.set_property('title', 'Proxy');
            expect(row.get_property('title')).toBe('Proxy');
        });

        await it('keeps the GIR accessors answering the properties', () => {
            const row = new Adw.ExpanderRow();
            row.set_expanded(true);
            expect(row.get_expanded()).toBe(true);
            row.set_enable_expansion(false);
            expect(row.get_enable_expansion()).toBe(false);
            expect(row.get_expanded()).toBe(false);
            row.set_show_enable_switch(true);
            expect(row.get_show_enable_switch()).toBe(true);
        });

        await it('takes all three beside the inherited ones as construct props', () => {
            const row = new Adw.ExpanderRow({ title: 'Proxy', expanded: true, showEnableSwitch: true });
            expect(row.title).toBe('Proxy');
            expect(row.expanded).toBe(true);
            expect(row.showEnableSwitch).toBe(true);
            expect(partsOf(row)._enableSwitch.visibility).toBe('visible');
        });

        await it('declares the three notifies in emittedSignals, merged with the inherited ones', () => {
            const emitted = (Adw.ExpanderRow as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            expect(emitted.includes(NOTIFY_EXPANDED)).toBe(true);
            expect(emitted.includes(NOTIFY_ENABLE_EXPANSION)).toBe(true);
            expect(emitted.includes(NOTIFY_SHOW_ENABLE_SWITCH)).toBe(true);
        });

        await it('does not shadow the action row with a second set of accessors', () => {
            const own = Object.getPrototypeOf(Adw.ExpanderRow.prototype) as object;
            expect(Object.hasOwn(own, 'expanded')).toBe(true);
            expect(Object.hasOwn(own, 'enable-expansion')).toBe(true);
            expect(Object.hasOwn(own, 'title')).toBe(false);
        });

        // ===== THE SUFFIX CLUSTER =====

        await it('prepends a suffix into a box that coexists with the affordances', () => {
            // `adw_expander_row_add_suffix` is `gtk_box_prepend` into `priv->suffixes` (C:449),
            // and the box starts invisible so an expander with no suffix shows no gap.
            const row = new Adw.ExpanderRow();
            const parts = partsOf(row);
            expect(parts._suffixes.visibility).toBe('collapse');
            const first = new Adw.Bin();
            const second = new Adw.Bin();
            row.add_suffix(first);
            expect(parts._suffixes.visibility).toBe('visible');
            expect(row.suffix).toBe(first);
            row.add_suffix(second);
            expect(row.suffix).toBe(second);
            expect(parts._suffixes.getChildrenCount()).toBe(2);
            // The chevron and the switch survived — the old single slot evicted them.
            expect(parts._toggle.iconName).not.toBe('');
            row.remove(second);
            expect(row.suffix).toBe(first);
            row.remove(first);
            expect(parts._suffixes.visibility).toBe('collapse');
            expect(row.suffix).toBe(null);
        });

        await it('dispatches remove on where the child actually is', () => {
            const row = new Adw.ExpanderRow();
            const prefix = new Adw.Bin();
            const child = new Adw.SwitchRow();
            row.add_prefix(prefix);
            row.add_row(child);
            expect(row.prefix).toBe(prefix);
            row.remove(prefix);
            expect(row.prefix).toBe(null);
            row.remove(child);
            expect(row.disclosureRows).toStrictEqual([]);
        });
    });
};

export default AdwExpanderRowPropertiesNsTest;
