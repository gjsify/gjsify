// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Adwaita WIDGET-BREADTH proof (GTK-GUI-on-node-gi, increment 3).
//
// The step BEYOND the interactive-window proof (windowing-interactive.test.mjs): a
// representative slice of the REAL Libadwaita widget set constructs, wires through
// the engine and RESPONDS to interaction via node-gi — a preferences surface, a
// GtkListBox and a dismissible toast. Two tiers, robust on a runner whose surface
// may or may not realize:
//
//   MINIMUM (always asserted) — the widget tree + the interaction chain.
//     (a) DumpTree: the tree contains every expected Adwaita type
//         (AdwPreferencesPage / AdwPreferencesGroup / AdwActionRow / AdwSwitchRow /
//         AdwEntryRow / AdwComboRow / AdwSpinRow / AdwExpanderRow) plus GtkListBox —
//         proof each widget class constructs + parents correctly through node-gi.
//     (b) STATE: interactions drive OBSERVABLE property changes through the node-gi
//         signal chain, and the paired `notify::<prop>` handlers fire:
//           · AdwSwitchRow.active     false -> true   (notify::active)
//           · AdwComboRow.selected    0 -> 2          (notify::selected; the
//                                     Gtk.StringList model reads back the string)
//           · AdwSpinRow / Gtk.Adjustment.value  3 -> 7  (notify::value on the
//                                     object-typed adjustment sub-model)
//           · AdwExpanderRow.expanded false -> true   (notify::expanded)
//           · AdwEntryRow text        '' -> 'node-gi' (Gtk.Editable set_text/get_text)
//           · Adw.Toast add -> dismiss ('dismissed' signal via Adw.ToastOverlay)
//         All of this is display-independent — GObject property sets + notify emit +
//         a synchronous signal dispatch need no surface. It surfaces the
//         Gtk.StringList / Gtk.Adjustment model marshalling (GListModel + object
//         construct props), `notify::` property signals and the boxed-model paths.
//
//   STRONGER (asserted WHEN the surface realizes) — the window realizes + RENDERS
//   the whole preferences surface through the GSK renderer (the same in-process
//   capture @gjsify/devtools' Screenshot uses), so a non-empty PNG proves the broad
//   widget set rasterised, not just constructed.
//
// PLATFORM-AWARE DISPLAY GATE (identical to windowing.test.mjs): win32/darwin have an
// implicit display; Linux keys off DISPLAY/WAYLAND_DISPLAY (real session or Xvfb).
// The interaction + DumpTree tier works headless on Windows CI (no visible desktop).
//
// run() is called at the TOP LEVEL of a synchronous test body so the node-gtk #442
// nested-microtask-checkpoint caveat does not bite; the drive + capture + quit run
// INSIDE the loop, from the activate handler / a GLib timeout.
//
// Reference: refs/gjs (g_application_run, GObject property notify), refs/libadwaita
// (PreferencesPage / PreferencesGroup / ActionRow / SwitchRow / EntryRow / ComboRow /
// SpinRow / ExpanderRow / ToastOverlay / Toast), @gjsify/devtools screenshot.ts.
// Copyright (c) GNOME contributors, MIT/LGPL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const displayless = process.platform === 'win32' || process.platform === 'darwin';
const haveDisplay = displayless || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

let Adw;
let Gtk;
let Gio;
let GLib;
let Graphene;
let loadError = null;
if (haveDisplay) {
  try {
    GLib = requireGi('GLib', '2.0');
    Gio = requireGi('Gio', '2.0');
    requireGi('Gdk', '4.0');
    Gtk = requireGi('Gtk', '4.0');
    Adw = requireGi('Adw', '1');
    Graphene = requireGi('Graphene', '1.0');
  } catch (err) {
    loadError = err;
  }
}

const skip = !haveDisplay
  ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
  : loadError
    ? `Gtk-4.0 / Adw-1 / Graphene-1.0 typelib unavailable: ${loadError.message}`
    : false;

// The @gjsify/devtools GSK capture path, inline (see windowing.test.mjs).
function captureWidgetPng(widget) {
  const native = widget.get_native();
  const renderer = native ? native.get_renderer() : null;
  if (!renderer) return null;
  const width = widget.get_width();
  const height = widget.get_height();
  if (width <= 0 || height <= 0) return null;
  const paintable = Gtk.WidgetPaintable.new(widget);
  const snapshot = Gtk.Snapshot.new();
  paintable.snapshot(snapshot, width, height);
  const node = snapshot.to_node();
  if (!node) return null;
  const viewport = new Graphene.Rect();
  viewport.init(0, 0, width, height);
  const texture = renderer.render_texture(node, viewport);
  const bytes = texture.save_to_png_bytes();
  const data = bytes ? bytes.get_data() : null;
  return data && data.length > 0 ? data : null;
}

// The concrete runtime GType name of a widget — the SAME seam @gjsify/devtools'
// DumpTree uses (widget-tree.ts `widgetType`): node-gi exposes the true runtime
// GType via `$typeName` (g_type_name(G_OBJECT_TYPE(obj))), which is authoritative
// where `get_name()` is not — e.g. AdwPreferencesPage returns an EMPTY widget name
// but `$typeName` is 'AdwPreferencesPage'. Falls back to the static class GType
// name, then the widget name, so it also works on gjs.
function widgetType(widget) {
  if (typeof widget.$typeName === 'string' && widget.$typeName.length > 0) return widget.$typeName;
  const ctor = widget.constructor;
  if (ctor && ctor.$gtype && typeof ctor.$gtype.name === 'string') return ctor.$gtype.name;
  return widget.get_name();
}

// DumpTree primitive: every widget TYPE in the tree (structural — no realized filter).
function collectTypes(widget, out) {
  out.push(widgetType(widget));
  let child = widget.get_first_child();
  while (child) {
    collectTypes(child, out);
    child = child.get_next_sibling();
  }
}

test('Adwaita preferences widgets construct + react + render on node-gi', { skip }, () => {
  const app = new Adw.Application({
    application_id: 'eu.jumplink.NodeGiWidgets',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
  });

  let activated = false;
  let activateError = null;
  let pngLength = 0;
  let allocatedWidth = 0;
  let allocatedHeight = 0;

  // OBSERVABLE state read off the WIDGETS after each interaction, plus a tally of
  // the `notify::` property-signal firings (the signal-chain proof).
  const state = {};
  const notifies = { active: 0, selected: 0, value: 0, expanded: 0 };
  const types = [];

  app.connect('activate', () => {
    try {
      activated = true;

      const win = new Adw.ApplicationWindow({ application: app });
      win.set_default_size(480, 640);

      const header = new Adw.HeaderBar();
      header.set_title_widget(new Adw.WindowTitle({ title: 'node-gi', subtitle: 'widgets' }));

      // --- The preferences surface -------------------------------------------
      const page = new Adw.PreferencesPage();

      const group = new Adw.PreferencesGroup({ title: 'Settings' });

      const actionRow = new Adw.ActionRow({ title: 'Action', subtitle: 'a plain row' });

      // SwitchRow — boolean `active`, notify::active.
      const switchRow = new Adw.SwitchRow({ title: 'Enabled', active: false });
      switchRow.connect('notify::active', () => {
        notifies.active += 1;
      });

      // EntryRow — Gtk.Editable text.
      const entryRow = new Adw.EntryRow({ title: 'Name' });

      // ComboRow — a Gtk.StringList (GListModel) construct-typed model, notify::selected.
      const stringList = new Gtk.StringList({ strings: ['Alpha', 'Beta', 'Gamma'] });
      const comboRow = new Adw.ComboRow({ title: 'Choice', model: stringList });
      comboRow.connect('notify::selected', () => {
        notifies.selected += 1;
      });

      // SpinRow — a Gtk.Adjustment object sub-model, notify::value on the adjustment.
      const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 10,
        step_increment: 1,
        page_increment: 2,
        value: 3,
      });
      adjustment.connect('notify::value', () => {
        notifies.value += 1;
      });
      const spinRow = new Adw.SpinRow({ title: 'Amount', adjustment });

      // ExpanderRow — boolean `expanded`, notify::expanded, with a nested row.
      const expanderRow = new Adw.ExpanderRow({ title: 'More', subtitle: 'expandable' });
      expanderRow.add_row(new Adw.ActionRow({ title: 'Nested', subtitle: 'inside the expander' }));
      expanderRow.connect('notify::expanded', () => {
        notifies.expanded += 1;
      });

      group.add(actionRow);
      group.add(switchRow);
      group.add(entryRow);
      group.add(comboRow);
      group.add(spinRow);
      group.add(expanderRow);
      page.add(group);

      // --- A Gtk.ListBox with a couple of rows (boxed-list Adwaita idiom) ------
      const listGroup = new Adw.PreferencesGroup({ title: 'List' });
      const listBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
      listBox.add_css_class('boxed-list');
      for (const label of ['One', 'Two']) {
        const row = new Gtk.ListBoxRow();
        row.set_child(new Gtk.Label({ label, halign: Gtk.Align.START, margin_top: 8, margin_bottom: 8, margin_start: 12, margin_end: 12 }));
        listBox.append(row);
      }
      listGroup.add(listBox);
      page.add(listGroup);

      // --- ToastOverlay wrapping the whole content ----------------------------
      const toolbar = new Adw.ToolbarView();
      toolbar.add_top_bar(header);
      toolbar.set_content(page);
      const toastOverlay = new Adw.ToastOverlay();
      toastOverlay.set_child(toolbar);
      win.set_content(toastOverlay);

      win.present();

      // --- Drive the interactions SYNCHRONOUSLY (display-independent) ----------
      state.initial = {
        active: switchRow.get_active(),
        selected: comboRow.get_selected(),
        value: spinRow.get_value(),
        expanded: expanderRow.get_expanded(),
        text: entryRow.get_text(),
      };

      // (a) SwitchRow toggle -> active + notify::active.
      switchRow.set_active(true);
      state.switchActive = switchRow.get_active();

      // (b) ComboRow selection change -> selected + the model string.
      comboRow.set_selected(2);
      state.comboSelected = comboRow.get_selected();
      state.comboString = stringList.get_string(comboRow.get_selected());

      // (c) SpinRow / Adjustment value change -> value + notify::value.
      spinRow.set_value(7);
      state.spinValue = spinRow.get_value();
      state.adjustmentValue = adjustment.get_value();

      // (d) ExpanderRow expand -> expanded + notify::expanded.
      expanderRow.set_expanded(true);
      state.expanderExpanded = expanderRow.get_expanded();

      // (e) EntryRow text -> Gtk.Editable set/get.
      entryRow.set_text('node-gi');
      state.entryText = entryRow.get_text();

      // (f) A dismissible Toast through the ToastOverlay + its 'dismissed' signal.
      let toastDismissed = 0;
      const toast = new Adw.Toast({ title: 'Saved' });
      toast.connect('dismissed', () => {
        toastDismissed += 1;
      });
      toastOverlay.add_toast(toast);
      toast.dismiss();
      state.toastDismissed = toastDismissed;

      // DumpTree snapshot (structural — valid even if the surface never realizes).
      collectTypes(win, types);

      // Strong tier: retry the GSK capture across frames, then quit.
      let waitedMs = 0;
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        waitedMs += 50;
        const png = captureWidgetPng(win);
        if (png) {
          pngLength = png.length;
          allocatedWidth = win.get_width();
          allocatedHeight = win.get_height();
          app.quit();
          return GLib.SOURCE_REMOVE;
        }
        if (waitedMs >= 5000) {
          allocatedWidth = win.get_width();
          allocatedHeight = win.get_height();
          app.quit();
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    } catch (err) {
      activateError = err;
      app.quit();
    }
  });

  const status = app.run([]);

  assert.equal(activateError, null, `activate threw: ${activateError && activateError.stack}`);
  assert.ok(activated, 'the app never activated');
  assert.equal(status, 0, `app.run() exit status was ${status}, expected 0`);

  // MINIMUM 1 — DumpTree: every expected widget type constructed + parented.
  const expectedTypes = [
    'AdwPreferencesPage',
    'AdwPreferencesGroup',
    'AdwActionRow',
    'AdwSwitchRow',
    'AdwEntryRow',
    'AdwComboRow',
    'AdwSpinRow',
    'AdwExpanderRow',
    'AdwToastOverlay',
    'GtkListBox',
  ];
  for (const type of expectedTypes) {
    assert.ok(types.includes(type), `${type} missing from the widget tree (DumpTree: ${[...new Set(types)].join(', ')})`);
  }

  // MINIMUM 2 — the interaction chain drove OBSERVABLE state through node-gi.
  assert.deepEqual(
    state.initial,
    { active: false, selected: 0, value: 3, expanded: false, text: '' },
    'initial widget state',
  );
  assert.equal(state.switchActive, true, 'AdwSwitchRow.set_active(true) -> active');
  assert.equal(state.comboSelected, 2, 'AdwComboRow.set_selected(2) -> selected');
  assert.equal(state.comboString, 'Gamma', 'Gtk.StringList model read back the selected string');
  assert.equal(state.spinValue, 7, 'AdwSpinRow.set_value(7) -> value');
  assert.equal(state.adjustmentValue, 7, 'the Gtk.Adjustment sub-model tracked the value');
  assert.equal(state.expanderExpanded, true, 'AdwExpanderRow.set_expanded(true) -> expanded');
  assert.equal(state.entryText, 'node-gi', 'AdwEntryRow set_text/get_text (Gtk.Editable)');
  assert.equal(state.toastDismissed, 1, 'Adw.Toast dismiss() fired the ::dismissed signal');

  // MINIMUM 3 — the paired notify:: property signals fired through node-gi.
  assert.ok(notifies.active >= 1, 'notify::active never fired on the SwitchRow');
  assert.ok(notifies.selected >= 1, 'notify::selected never fired on the ComboRow');
  assert.ok(notifies.value >= 1, 'notify::value never fired on the Adjustment');
  assert.ok(notifies.expanded >= 1, 'notify::expanded never fired on the ExpanderRow');

  // STRONGER (when the surface realizes): a non-empty GSK-rendered PNG.
  if (allocatedWidth > 0 && allocatedHeight > 0) {
    assert.ok(
      pngLength > 0,
      `window realized (${allocatedWidth}x${allocatedHeight}) but the GSK capture was empty`,
    );
    console.log(`widgets: rendered ${allocatedWidth}x${allocatedHeight} -> ${pngLength}-byte PNG (strong proof)`);
  } else {
    console.log('widgets: surface did not realize — interaction + DumpTree proof only');
  }
});
