### Adwaita Web framework roadmap

Long-term goal: complete `@gjsify/adwaita-web` so it can replace the styling layer of
`refs/adwaita-web/adwaita-web/scss/` while keeping our Web Components abstraction. Every port adds a custom
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

What DOES belong here is the judgement a script cannot make. Three questions were tracked by hand
in this file and ALL THREE are machine-checked now, which is why the table that used to sit here is
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
- **Does a cited upstream partial exist?** `scripts/check-refs-citations.mjs`. This paragraph used
  to ASK for that check in prose and got nineteen headers naming a libadwaita file that never
  existed. What stays here is the judgement it cannot make — WHY the wrong spellings look right:
  the singular ones (`_checkbox.scss`, `_radio.scss`, `_progressbar.scss`, `_label.scss`,
  `_icon.scss`, `_shortcut_label.scss`) are the vendored adwaita-web tree's, not libadwaita's,
  which merges check and radio into ONE `_checks.scss`, spells the others `_progress-bar.scss` /
  `_labels.scss`, and has neither an `_icon.scss` nor a `_shortcut_label.scss` at all. Reach for
  the wrong tree's name and the gate now says so.

The one documented class deliberately unported is `.inline`: it applies to `GtkSearchBar`,
`AdwTabBar` and `GtkTextView`, this renderer has none of the three (`<adw-tab-view>` is the tab
CONTENT, not `AdwTabBar`), and upstream excludes `GtkSourceView`, which is the one text widget
here. It ships with the first of those widgets, not before. The ledger carries that reason next
to the entry.

`<adw-shortcut-label>` is on all three renderers, and its accelerator grammar lives in
`@gjsify/adwaita-core`, driven by `SHORTCUT_LABEL_VECTORS` from every suite that renders it — the
one thing about it the matrix cannot show.

`<adw-label>` is NOT planned: `_labels.scss` is a widget partial in name only — four lines of
GtkLabel plumbing plus a dozen UTILITY CLASSES. Those classes ship (`scss/_labels.scss`:
`.dimmed`, `.accent`/`.error`/`.warning`/`.success`, `.title-1`…`.title-4`, `.heading`, `.body`,
`.caption-heading`, `.caption`, `.document`, `.monospace`, `.numeric`), which is the gap consumers
actually hit; an ELEMENT would wrap a `<span>`, add nothing a class does not, and put one more tag
in `$adw-components` for no behaviour — ADR 0004's trivial-behaviour clause, and ADR 0010 already
makes the token/class surface the public contract.

Which widget is missing from which renderer is an asymmetric row in the derived matrix, so it is
not listed here — the copy that used to sit here named `adw-icon` as NativeScript-only and
`adw-data-grid` as browser-only after both had shipped on both sides. What a matrix cannot say is
whether an asymmetry is a GAP or a DECISION, so that verdict sits next to the widget in
`ONE_RENDERER_ONLY` (`scripts/check-storybook-widget-coverage.mjs`), the way `.inline` carries its
reason in the style-class ledger: a `decision` with its reason, or a `gap` pointing at where the
work is tracked, and the gate fails on an asymmetric widget with neither.

Most of those verdicts were settled by reading `refs/libadwaita` rather than judged: only
`adw-dialog`, `adw-window`, `adw-navigation-page` and the two carousel indicators have an Adw
WIDGET upstream at all. The rest fall into three buckets — stylesheet partials over a GTK
primitive, public Adw GObjects that are DATA rather than views, and markup or property forms with
no upstream type of any kind (a GtkBuildable `<response>` child, a GtkWidget-typed property, a
different library) — and for all three, which renderer wrapped the thing in an element of its own
is a rendering idiom, not a missing port. The ones nobody can settle from outside the ports are
gaps, and `status/open-todos.md` says what each is waiting on.
