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

What DOES belong here is the judgement a script cannot make. Two questions were tracked by hand
in this file and BOTH are machine-checked now, which is why the table that used to sit here is
gone:

- **Which documented style classes have no rule?** `scripts/check-adwaita-style-classes.mjs` holds
  a ledger against `refs/libadwaita/doc/style-classes.md`, and
  `packages/web/adwaita-web/src/style-classes.spec.ts` asserts every entry has a rule in the
  COMPILED stylesheet. This replaced a by-FILENAME reading that reported gaps that were not gaps
  and missed twenty-one that were: `.card`, `.boxed-list`, `.toolbar`, `.linked`, `.osd`,
  `.frame`, `.view`, `.background`, `.spacer`, `.property`, `.compact`, `.devel`,
  `.navigation-sidebar` and the rest had NO rule at all, and two of them read as present because
  their names appeared in comments while the code spelled its own `.adw-linked`.
- **Do the three storybook targets render the same stories?**
  `scripts/check-storybook-story-parity.mjs`, which is what replaced the never-built screenshot
  harness (#1052).

The one documented class deliberately unported is `.inline`: it applies to `GtkSearchBar`,
`AdwTabBar` and `GtkTextView`, this renderer has none of the three (`<adw-tab-view>` is the tab
CONTENT, not `AdwTabBar`), and upstream excludes `GtkSourceView`, which is the one text widget
here. It ships with the first of those widgets, not before. The ledger carries that reason next
to the entry.

`<adw-shortcut-label>` SHIPPED: its accelerator grammar lives in `@gjsify/adwaita-core` and is
driven by `SHORTCUT_LABEL_VECTORS` from both the core and the browser suite. The NativeScript
rendering of it is the open follow-up.

`<adw-label>` is NOT planned: `_labels.scss` is a widget partial in name only — four lines of
GtkLabel plumbing plus a dozen UTILITY CLASSES. Those classes ship (`scss/_labels.scss`:
`.dimmed`, `.accent`/`.error`/`.warning`/`.success`, `.title-1`…`.title-4`, `.heading`, `.body`,
`.caption-heading`, `.caption`, `.document`, `.monospace`, `.numeric`), which is the gap consumers
actually hit; an ELEMENT would wrap a `<span>`, add nothing a class does not, and put one more tag
in `$adw-components` for no behaviour — ADR 0004's trivial-behaviour clause, and ADR 0010 already
makes the token/class surface the public contract.

When citing a partial in an SPDX header, verify it exists: the singular spellings
(`_checkbox.scss`, `_radio.scss`, `_progressbar.scss`, `_label.scss`, `_icon.scss`,
`_shortcut_label.scss`) are `refs/adwaita-web`'s, not libadwaita's — libadwaita merges check and
radio into ONE `_checks.scss`, spells the others `_progress-bar.scss` / `_labels.scss`, and has no
`_icon.scss` or `_shortcut_label.scss` at all. A header naming a file that is not there is worse
than none.

Two gaps run the other way — NativeScript has widgets the browser does not (`adw-icon`,
`adw-image-button`, `adw-preferences-page`, `adw-slider-row`), and the browser has one
NativeScript lacks (`adw-data-grid`, whose column alignment is CSS subgrid — #1050). Those show
up as asymmetric rows in the derived matrix, so they are not restated here either.
