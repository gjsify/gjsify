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

Note the SOURCE-PARTIAL column names files in `refs/libadwaita/src/stylesheet/widgets/`, and the
singular spellings (`_checkbox.scss`, `_radio.scss`, `_progressbar.scss`, `_label.scss`,
`_icon.scss`, `_shortcut_label.scss`) are `refs/adwaita-web`'s, not libadwaita's — libadwaita
merges check and radio into ONE `_checks.scss`, spells the others `_progress-bar.scss` /
`_labels.scss`, and has no `_icon.scss` or `_shortcut_label.scss` at all. Verify a partial exists
before citing it in an SPDX header; a header naming a file that is not there is worse than none.

| Missing | Source partial | Note |
|---|---|---|
| layout helpers | `refs/adwaita-web`'s `_box.scss` / `_listbox.scss` / `_row_types.scss` — libadwaita has no `_box.scss`, and spells its list styling `_lists.scss` | the pieces consumers reach for when composing their own rows |
| `<adw-shortcut-label>` | `refs/adwaita-web`'s `_shortcut_label.scss` (libadwaita has none) | niche; only needed by a shortcuts window |

`<adw-label>` is NOT on that list and is not planned: `_labels.scss` is a widget partial in name
only — four lines of GtkLabel plumbing plus a dozen UTILITY CLASSES. Those classes ship
(`scss/_labels.scss`: `.dimmed`, `.accent`/`.error`/`.warning`/`.success`, `.title-1`…`.title-4`,
`.heading`, `.body`, `.caption-heading`, `.caption`, `.document`, `.monospace`, `.numeric`), which
is the gap consumers actually hit; an ELEMENT would wrap a `<span>`, add nothing a class does not,
and put one more tag in `$adw-components` for no behaviour — ADR 0004's trivial-behaviour clause,
and ADR 0010 already makes the token/class surface the public contract.

Two gaps run the other way — NativeScript has widgets the browser does not (`adw-icon`,
`adw-image-button`, `adw-preferences-page`, `adw-slider-row`), and the browser has one
NativeScript lacks (`adw-data-grid`, whose column alignment is CSS subgrid — #1050). Those show
up as asymmetric rows in the derived matrix, so they are not restated here either.
