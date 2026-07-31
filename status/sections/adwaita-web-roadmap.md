### Adwaita Web framework roadmap

Long-term goal: complete `@gjsify/adwaita-web` so it can replace the styling layer of `refs/adwaita-web/scss/` while keeping our Web Components abstraction. Planned port order (each adds a custom element + SCSS partial + AGENTS attribution; each port must add a SPDX header citing `refs/adwaita-web/adwaita-web/scss/_<name>.scss` and/or `refs/libadwaita/src/stylesheet/widgets/_<name>.scss`):

| Status | Component | Source partial |
|---|---|---|
| ✅ Done | `<adw-window>`, `<adw-header-bar>`, `<adw-preferences-group>`, `<adw-card>`, `<adw-switch-row>`, `<adw-combo-row>`, `<adw-spin-row>`, `<adw-toast-overlay>`, `<adw-overlay-split-view>` | `_window.scss`, `_headerbar.scss`, `_preferences.scss`, `_card.scss`, `_switch_row.scss`, `_combo_row.scss`, `_spin_button.scss`, `_toast.scss`, (libadwaita C source) |
| ✅ Done | `<adw-view-stack>`, `<adw-view-switcher-bar>`, `<adw-menu-button>` (phone-shell nav/shell trio for the Learn6502 web rewrite) | `_view_stack.scss`, `_view_switcher_bar.scss`, `_menu_button.scss` |
| ✅ Done | `<adw-source-view>` — CodeMirror-6 editor at the opt-in subpath `@gjsify/adwaita-web/source-view` | self-injected CSS + CodeMirror theme (no SCSS partial) |
| ✅ Done | `<adw-data-grid>` — slim aligned numeric grid for tabular financial data | `_data_grid.scss` |
| ✅ Done | `<adw-dialog>` (generic adaptive dialog) + `<adw-drop-down>` (standalone `Gtk.DropDown` mirror) | `_dialog.scss`, `_drop_down.scss` |
| Planned | `<adw-button>` (flat / suggested / destructive) | `_button.scss`, `_button_row.scss` |
| Planned | `<adw-entry>` / `<adw-entry-row>` | `_entry.scss`, `_entry_row.scss` |
| Planned | `<adw-action-row>` | `_action_row.scss` |
| Planned | `<adw-checkbox>` / `<adw-radio>` | `_checkbox.scss`, `_radio.scss` |
| Planned | `<adw-popover>` | `_popover.scss` |
| Planned | `<adw-banner>` / `<adw-bottom-sheet>` | `_banner.scss`, `_bottom_sheet.scss` |
| Planned | `<adw-tabs>` / `<adw-view-switcher>` | `_tabs.scss`, `_viewswitcher.scss` |
| Planned | `<adw-progress-bar>` / `<adw-spinner>` | `_progressbar.scss`, `_spinner.scss` |
| Planned | `<adw-status-page>` | `_status_page.scss` |
| Planned | `<adw-toggle-group>` / `<adw-split-button>` | `_toggle_group.scss`, `_split_button.scss` |
| Planned | `<adw-expander-row>` / `<adw-carousel>` | `_expander_row.scss`, `_carousel_indicators.scss` |
| Planned | `<adw-avatar>` / `<adw-label>` / `<adw-icon>` | `_avatar.scss`, `_label.scss`, `_icon.scss` |
| Planned | Utility classes & layout helpers | `_box.scss`, `_wrap_box.scss`, `_listbox.scss`, `_toolbar_view.scss`, `_utility_classes.scss` |
