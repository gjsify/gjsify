# NativeScript bridge — measured notes (window insets, host ownership, derived counts)

> Detail for [packages/nativescript-bridge/AGENTS.md](../packages/nativescript-bridge/AGENTS.md).
> These are measured results, not design intent — each paragraph is the record of a
> defect that shipped, kept because the rule alone does not survive re-derivation.

## Window insets — the host pays some edges, the widget pays the rest

**The inset was paid twice, and it was visible: 142 px of dead chrome above the header bar
and 63 px of dead band below the content, on a 420-dpi device (54 dp / 24 dp).** The
storybook's title sat a finger's width below the status bar for as long as it had run on
Android.

**Mechanism.** NativeScript's `Page` sets `androidOverflowEdge: 'none'`
(`ui/page/index.android.js:13`), which puts its `org.nativescript.widgets.LayoutBase` on the
branch of `LayoutBase$2.onApplyWindowInsets` that ADDS the system-bar insets to its own
padding — `setPadding` adds `edgeInsets` to the value it forwards to
`ViewGroup.setPadding`. Every OTHER NativeScript layout sets `'ignore'` and pays nothing,
and `AdwToolbarView extends GridLayout` descends from one of those. So exactly one ancestor
pays, and `_applyInsets` added the same reading again.

**Why one attribute cannot fix it, and why the two edges get opposite answers.**

- `androidOverflowEdge="ignore"` on the page (`overflowEdge == -1`) early-returns before
  BOTH branches. Measured A/B on the same text field: without it the chrome stays pinned
  and the content resizes so the field clears the keyboard; with it the whole window pans,
  the header bar leaves the screen and the story text slides under the clock.
  `max(systemBars.bottom, ime.bottom)` appears **only** on the `overflowEdge == 0` branch —
  take that edge away and the keyboard goes with it.
- **TOP — taken back from the page** (`androidOverflowEdge: 'top'`). Not for symmetry: the
  page paints that band in the WINDOW colour, and only `.adw-toolbar-view-top` paints it in
  the pane's own header colour. Proved by painting `.adw-window` magenta and rebuilding —
  with the widget paying nothing, rows 0..141 come back magenta, i.e. the page painting the
  band. That is the same stripe as the colour defect below, reintroduced. With the split,
  the same magenta build shows magenta only at rows 2361..2423.
- **BOTTOM — left with the page**, because that is the branch the IME rides on.

The split itself (`insetsOwedBy`, `host-insets.{ts,android,ios}.ts`) is pure and checked
off-device; only the ownership decision is platform code.

**iOS keeps paying both edges, unchanged and UNVERIFIED (#1051).** `host-insets.ios.ts` is a
deliberate no-op. The claim that would need a device is the OPPOSITE one — that a UIKit host
applies no safe-area padding of its own. It is plausible from `ui/page/index.ios.ts` having
no `androidOverflowEdge` twin, and it has never been run.

**Measured on `emulator-5554`, 1080×2424 at 420 dpi** (`insets=Rect(0, 142 - 0, 0)`):

| | before | after |
|---|---|---|
| header-bar bottom border, light sidebar | y 404–406 | y 262–264 |
| dead band above the header | 142 px | 0 |
| status-bar band, light sidebar / detail | `#fafafb` / `#fafafb` | `#ebebed` / `#fafafb` |
| dark sidebar / detail | `#222226` / `#222226` | `#2e2e32` / `#1d1d20` |
| below the story list | 63 px `#ebebed` + 63 px `#fafafb` | 63 px `#fafafb` |
| content reclaimed | — | 205 px = 78 dp |

Acceptance, all on device: the keyboard resize path is byte-for-byte what it was
(`mInputShown=true`, viewport still ending at y≈1533 in both builds, the field visible, the
header bar on screen, no panning); the bottom inset is paid once; the alert dialog's scrim
runs continuously from y=0 to y=2423, under both system bars, which is what #1128 requires.
The EXPANDED breakpoint is the strongest evidence for the design — the band is `#2e2e32`
above the sidebar and `#1d1d20` above the content, two colours in one row, which a
page-painted band cannot produce.

## The inset band takes the widget's colour, not the pane's

`AdwToolbarView` pads its top-bar BOX with the status-bar inset, and
`.adw-toolbar-view-top` paints that padding. A consumer that recolours the header BAR and
not the box gets a stripe in the widget default: measured at x=540, the storybook sidebar
had `rgb(255,255,255)` over a `rgb(235,235,237)` pane, and the dark detail pane
`rgb(46,46,50)` over a `rgb(29,29,32)` header. The dark SIDEBAR hid it only because the
widget default happens to equal the storybook's dark sidebar.

The alternative — padding the first top-bar child instead of the box — would have the
chrome write inline padding into a view the consumer styles, clobbering
`.adw-header-bar`'s own `padding: 6 8 6 8`. The NativeScript CSS subset has neither
`inherit` nor custom properties, so there is no third option. **What is not held:** a future
consumer that recolours `.adw-header-bar` without also recolouring
`.adw-toolbar-view-top` walks into the same trap, and no gate notices —
`check-nativescript-theme-classes.mjs` answers "is this class styled", not "does a restyle
cover the sibling the widget paints with".

## One broadcast, and a bundle that made two

`setOnApplyWindowInsetsListener` REPLACES rather than adds, so the window-insets source is
a single broadcast by construction. A bundle can break that without touching the code: the
storybook showcase carries **31 modules of `@gjsify/adwaita-nativescript` twice** — the two
paths are symlinks to one directory, but the resolver keys on the path it walked. Two
`WindowInsetsBroadcast` instances get constructed, one loses the listener, and a widget
wired to the loser reads zero forever. Observed: the shell's panes get the reading, a
story's own `AdwToolbarView` gets none. The Android host-inset variant therefore refuses to
release the page's top edge until it holds a non-zero reading to pay with — a guard around
the duplication, not a fix for it (`status/open-todos.md`).

## A count written by hand, next to a count that is derived

**The widget matrix in `AGENTS.md` said 44 while the tree held 45.**

The per-widget matrix and its total are DERIVED into `STATUS.md` from the sources. A
number typed beside them in `AGENTS.md` is a second truth about the same tree, and it
drifted the moment a widget landed — silently, because nothing compares prose to a
generator's output and nothing ever will: the two are not the same kind of artefact.

That is why the rule in the cell is "the count is derived" and the count itself is not
there. The incident is here rather than in the cell for the same reason the cell is
short: it is what makes the rule survive somebody deciding a number would be handy, and
it is not something an agent needs on every turn.

`scripts/check-storybook-widget-coverage.mjs` explains separately why the matrix is not
machine-checked against the same reader that generates it — `f(x)` against `f(x)` is
green for every tree.
