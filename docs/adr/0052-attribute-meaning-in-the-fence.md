# 52. An attribute's meaning is a generated comment in the fence a reader copies

- Status: **Proposed**
- Date: 2026-09-09
- Deciders: Pascal Garber
- Related: [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0029 (`@girs/*` widget vocabulary)](0029-girs-widget-vocabulary.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0049 (style classes are a list)](0049-style-classes-are-a-list.md)

## Context

Every gallery block carried an **Attributes** pane: the element's
`observedAttributes` with the value the block's own preview passes. It was generated
rather than written, for a measured reason — hand-written attribute prose had not
survived. Across the 37 blocks that join to a custom element, 110 of the observed
attributes were named somewhere on their page and **54 were not**: all four of
`<adw-toolbar-view>`'s, eight of `<adw-overlay-split-view>`'s including the
`breakpoint` its own section is about, and `<adw-wrap-box>` shipped with no pane at
all over 14 attributes because the reader could not see the declaration.

What the pane could not say is what an attribute **is**. It described what the
preview *passes*, and the fence one tab to the left already shows that — so a reader
who did not recognise `selected` learned that it was `"0"` and nothing else. The pane
is therefore deleted.

**And the same 110-against-54 shape was already re-forming by hand.** Measured over
the 40 preview fences: seven carried an authored HTML comment and four of those
glossed an attribute — `model` on `<gtk-drop-down>`, `stack` on
`<adw-view-switcher-bar>`, the absent `editable` on `<gtk-entry>`, and
`allow-scroll-wheel` on `<adw-carousel>`. Four of 193 attribute occurrences, nothing
holding the other 189, and nothing checking the four.

## Decision

**The meaning goes into the fence, as an HTML comment, generated from the GIR.**

1. **The fence, not a pane.** An HTML comment is inert in the DOM, and the preview
   fence is ONE source: `AdwWidget` shows it on the HTML tab and mounts it as the
   live preview. A comment in it is therefore one text for both, with no second copy
   to keep — the property the fence was unified for in the first place.
2. **The GIR is the source.** The custom elements mirror GObject properties, so the
   meaning is derivable: tag → GType → GIR property → the first sentence of its
   `<doc>`. Read directly, which is the arrangement ADR 0028 § 1 settled for the
   widget table. `@girs/*`'s vocabulary subpath (ADR 0029) carries names, nicks and
   `SINCE` and **no doc text at all**, so it cannot answer this question; the class
   `.d.ts` carries rendered TSDoc, which is the same text one transformation further
   from its origin.
3. **Not every attribute — the line is the RESTATEMENT test.** Most GIR property docs
   restate the property's own name: "The subtitle for this row.", "The displayed
   label.", "Whether the row is expanded." A gloss is emitted only where the doc's
   first sentence carries a word the name does not imply, decided mechanically:
   content words minus the attribute's name, minus the element's name, minus a closed
   list of English function words, minus a closed list of *presentation* words (the
   vocabulary a doc spends on the fact that a property is displayed, which a
   documentation fence says by existing), minus the corpus's own **shared
   vocabulary** — every word occurring in 4 or more of the docs this gallery shows,
   which by construction distinguishes none of them.

   The shared vocabulary is DERIVED, and that is what keeps the domain boilerplate
   out without naming any of it: "preference" and "represented" sit in 10 and 8 of
   these docs, because "The title of the preference represented by this row." is
   eight elements' answer for `title`. A hand-written list of those words would be a
   hand written about attributes; a document-frequency floor is not.
4. **A gloss belongs on the element its block is ABOUT.** Glossing every element in
   every fence put 62 comment lines into 332 lines of markup and **19 of them were
   the same sentence** — `<adw-status-page description>`, the filler content of
   nineteen other widgets' previews. `Adw.StatusPage` has a block of its own, which is
   where that gloss is right and where the reader is when they need it. An element no
   block is about (`<adw-view-stack-page>`, `<adw-sidebar-item>`, `<adw-toggle>`,
   `<adw-alert-response>`) is glossed wherever it appears, because the reader has
   nowhere else to meet it. That makes the partition complete: every attribute the
   gallery sets is glossed somewhere, or its name suffices, or it is ledgered.
5. **An attribute with no GIR property is a declared finding.** 20 of the 107
   attributes the gallery sets have no libadwaita/GTK property of that name, and each
   is ledgered with what it is instead — `renamed` and `inverted` and `id-reference`
   name the property they correspond to, machine-checked to exist on that GType's
   chain; `style-class`, `declarative-state`, `not-a-widget` and `port-only` say why
   there is none. None of them takes a generated gloss: a doc borrowed across a
   rename can be false, and `<gtk-entry disabled>` is the INVERSE of
   `Gtk.Widget:sensitive` ("Whether the widget responds to input"), so the sentence
   read verbatim says the opposite of what the attribute does.
6. **Two authored glosses stand, and are held.** `model` on `<gtk-drop-down>` and
   `stack` on `<adw-view-switcher-bar>` are the one case where a generated gloss
   would be worse than the hand: the GIR property holds an OBJECT (`Gio.ListModel`,
   `Adw.ViewStack`) and the attribute takes a string (a JSON array, an element id), so
   the GIR sentence is true of the property and false of the markup. Each is ledgered
   with the substring the fence must keep carrying, so removing the authored comment
   is a red gate rather than a quiet loss.
7. **An enum's nicks are deliberately not printed.** They are the one thing no name
   and no doc sentence carries, and the GIR has them — but the fence is the WEB port's
   markup and the accepted value vocabulary is that port's own. Printing GIR nicks
   beside a web attribute asserts a vocabulary this generator has not read. It would
   have added exactly one gloss (`display-mode` on `<adw-inline-view-switcher>`,
   whose doc sentence is "The display mode.") and needed a second source to be true.

## Consequences

- **The measurement, and it is the reviewable part.** 107 distinct attributes are set
  across the 40 fences: **27 glossed**, **58 where the name suffices**, **20 with no
  GIR property**, **2 authored**. 27 comment lines against 332 lines of markup, +8 %.
  The counts are emitted into the generated module and checked, so moving the line
  moves a number rather than an opinion.
- **The output is committed twice, on purpose.** The `.mdx` fences are what ships;
  `scripts/adwaita-attribute-meanings.mjs` is the same text as data. The second copy
  is what lets a job with no GIR fail on a hand-edited comment — see Implementation.
- **Version skew is a red gate whose repair is a re-run.** The committed sentences are
  the doc text of one libadwaita (1.9 / GTK 4.24 as generated). A libadwaita upgrade
  that rewords a property doc fails the drift check, and the diff is then the upstream
  doc improvement arriving on the site. Measured against an `org.gnome.Sdk` flatpak
  two releases back, an older GIR reports `<adw-sidebar mode>` as an attribute with no
  property at all — indistinguishable from a real divergence — so every failure path
  names the GIR it read and the one the committed text came from.
- A `.mdx` under `website/src/content/docs/{adwaita,gtk}/` is now part hand-authored
  (prose, fences, the non-`preview` fragments) and part generated (the gloss lines
  inside a `preview`/`web` fence). The generator strips only comment lines of its own
  shape whose name is an attribute the pillar observes — measured, none of the seven
  authored comments matches it.

## Implementation

`scripts/generate-adwaita-attribute-comments.mjs` reads the GIR, decides every
attribute, rewrites the fences and emits `scripts/adwaita-attribute-meanings.mjs`.
Its `--check` re-derives both from the GIR and refuses a drift.

**Two gates, because neither environment can hold both halves.**

- `generate-adwaita-attribute-comments.mjs --check` needs `Adw-1.gir` and
  `Gtk-4.0.gir`, and runs in `main.yml`'s `tree-checks` job — the only one whose image
  carries `gtk4-devel` + `libadwaita-devel`, beside `check-doc-fences.mjs` for the same
  reason.
- Arm 12 of `check-generated-website-data.mjs` holds every fence against the committed
  sentences, byte for byte, plus the partition, both ledgers in the stale direction and
  the published counts. It runs in two jobs that are `checkout` + `setup-node` and have
  no GIR at all — so a comment line deleted from an `.mdx` is red on every PR leg, not
  only in the one leg that can see the doc text. It calls the generator's own placement
  code with the committed sentences instead of GIR-read ones: a second placement
  implementation there would be a check of a rule the fences were not written with.

Both were mutation-tested. Dropping a gloss line, rewording one in place, corrupting a
sentence in the module, hand-editing a published count, emptying the gloss map, setting
an attribute with no property and no ledger entry, setting one the module does not
decide, removing a ledger entry, pointing a `girProperty` at a name that does not exist,
deleting an authored gloss, dropping the `.oxfmtrc.json` exemption, removing a
load-bearing presentation word, adding an unused one, inverting the block-subject rule,
and hiding the GIR: each goes red, and the last exits rather than skipping.
