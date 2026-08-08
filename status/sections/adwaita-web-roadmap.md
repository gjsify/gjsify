### Adwaita Web framework roadmap

Long-term goal: complete `@gjsify/adwaita-web` so it can replace the styling layer of
`refs/adwaita-web/scss/` while keeping our Web Components abstraction. Every port adds a custom
element + SCSS partial + a SPDX header citing `refs/adwaita-web/adwaita-web/scss/_<name>.scss`
and/or `refs/libadwaita/src/stylesheet/widgets/_<name>.scss`.

**What already exists is NOT tracked here.** The per-widget matrix above — which widget has a GTK
story, a browser element, a NativeScript view, and which of them actually delegate to
`@gjsify/adwaita-core` — is derived from the tree on every generation. This section used to carry
that table by hand, and it drifted twelve widgets behind the code: `<adw-button>`, `<adw-entry>`,
`<adw-action-row>`, `<adw-banner>`, `<adw-bottom-sheet>`, `<adw-status-page>`,
`<adw-toggle-group>`, `<adw-split-button>`, `<adw-expander-row>`, `<adw-carousel>`,
`<adw-avatar>` and `<adw-wrap-box>` all sat under "Planned" long after they shipped. Nothing that
a script can read belongs in this file.

What DOES belong here is the judgement a script cannot make: which upstream partials we have no
counterpart for at all. The three sources name things differently (`_headerbar.scss` vs
`_header-bar.scss`, `_tabs.scss` vs our `_tab_view.scss`, `_spin_button.scss` vs `_spin_row.scss`),
so a filename diff reports gaps that are not gaps. The list below was checked by hand against
`src/elements/` (checked 2026-08-08) and holds only widgets with neither an element nor a partial:

| Missing | Source partial | Note |
|---|---|---|
| `<adw-checkbox>` / `<adw-radio>` | `_checkbox.scss`, `_radio.scss` | no form-control primitives yet |
| `<adw-switch>` | `_switch.scss` | only `<adw-switch-row>` exists; the standalone control does not |
| `<adw-popover>` | `_popover.scss` | `<adw-menu-button>` hand-rolls its own popup |
| `<adw-progress-bar>` | `_progressbar.scss` | `<adw-spinner>` covers indeterminate only |
| `<adw-label>` / `<adw-icon>` | `_label.scss`, `_icon.scss` | `.adw-icon` exists as a CLASS other widgets use, not as an element |
| Utility classes & layout helpers | `_box.scss`, `_listbox.scss`, `_utility_classes.scss`, `_row_types.scss` | the pieces consumers reach for when composing their own rows |
| `<adw-shortcut-label>` | `_shortcut_label.scss` | niche; only needed by a shortcuts window |

Two gaps run the other way — NativeScript has widgets the browser does not (`adw-icon`,
`adw-image-button`, `adw-preferences-page`, `adw-slider-row`), and the browser has some
NativeScript lacks (`adw-data-grid`, `adw-drop-down`, standalone `adw-entry`). Those show up as
asymmetric rows in the derived matrix, so they are not restated here either.
