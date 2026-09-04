# ADR 0045 — A node whose host node is not its parent node: the placement axis in `@gjsify/gtk-host`

- **Status:** Accepted (2026-09-04)
- **Scope:** `@gjsify/gtk-host`'s element model — a second declaration on `WidgetDescriptor`, orthogonal to `ChildPolicy`, read by exactly one file (`src/policies.ts`). Extends [ADR 0027](0027-gtk-host-layer.md) (one host, adapters on top) and [ADR 0028](0028-widget-table-provenance.md) (a placement fact is CURATED and measured, never generated). It settles nothing about which framework renders — the seam is below all three adapters, which is the whole point.
- **Consumer:** `@gjsify/react-native`'s `<Modal>`, which is what forced the question and what the seam is measured against. The layer's own decisions are [ADR 0032](0032-react-native-on-the-gtk-host.md) and [ADR 0039](0039-react-native-prop-surface.md).
- **Written after the measurements.** Every number below was produced by running the case on this machine — gjs 1.88.1 / GTK 4.22.4 / libadwaita 1.9.3, Fedora 44, Wayland — and the reproducers are the vectors in `packages/framework/gtk-host/src/portal.spec.ts`.

## Context

The host's element model has one placement question: *how does this parent adopt a
child?* `ChildPolicy` answers it in eight kinds, and every one of them ends in a call
on the PARENT — `append`, `insert`, `add_titled`, `set_child`, `pack_start`.

That presumes an answer to a question nobody had to ask, because for every widget in
the table the answer was yes: **does this node go into its parent at all?**

For an `Adw.Dialog` it does not, and the way it does not is the loudest failure mode
in this repository's collection.

### The measurement

Measured on libadwaita 1.9.3 / GTK 4.22.4 / gjs 1.88.1, one process per case, exit
codes recorded:

| case | result |
|---|---|
| `box.append(label)`, box in an `Adw.Window` — control | exit 0, `label.get_parent()` is the box |
| **`box.append(dialog)`, box in an `Adw.Window`** | **`Adwaita-ERROR **: Trying to add AdwDialog 0x… to GtkBox 0x…. Use adw_dialog_present() to show dialogs.` — exit 134 (SIGABRT), core dump** |
| `box.append(dialog)`, box **detached** | **exit 0, silent**, `dialog.get_parent()` is the box |

The abort is `g_error()` from `adw_dialog_root()` — the ROOT vfunc — so it fires when
the widget joins a tree whose root is a `GtkWindow` and not before. That is why the
third row exists and why it is written down here rather than left to be rediscovered:
a re-test on a bare box "disproves" the first one at exit 0.

`g_error()` is not catchable. A `try` inside the reconciler does not help, an
`installDiagnosticsGate()` cannot count it, and there is no state to recover to. The
host's usual answer to a placement it cannot make — a named `GtkHostError` — is not
available either, because the host would have to know it is holding a dialog, and
knowing what a widget IS is the one thing the table is built to avoid guessing.

### What was blocked by it

`@gjsify/react-native`'s `Modal`, `planned` in the support table for exactly this
reason, and the expo-router `dismiss` family, whose refusal sentence names it: *"needs
a modal stack this layer has no portal seam for (see Modal)"*.

And the shape generalises past both. A dialog is **presented against** a parent and
never parented by it: `adw_dialog_present(self, parent)` walks the parent's ancestors
for an `AdwDialogHost` and puts the dialog there. Its position in the authored tree
and its position in the GTK tree are different places. That is a portal, and the host
had no vocabulary for one.

## Decision

**`WidgetDescriptor` grows a second, orthogonal declaration: `placement`.**

```ts
export type NodePlacement =
    | { readonly kind: 'parented' }
    | { readonly kind: 'portal'; readonly present: string; readonly close: string };
```

`ChildPolicy` keeps answering "how does this parent adopt a child". `NodePlacement`
answers "does this node go into its parent at all, and if not, how does it reach the
screen". The two are read independently: an `AdwDialog` is a portal AND a `single`-child
container, and its children are placed by the ordinary policy.

Five decisions inside that, each with the measurement that forced it.

### 1. It is a declaration on the descriptor, not a special case in the host

The alternative — `if (gtype === 'AdwDialog')` anywhere in `policies.ts` — is the
widget knowledge ADR 0027 rule 1 forbids, and it would be the first one. The
declaration goes through the same three gates every other placement fact does:
`descriptorProblems()` checks the named methods exist on the installed class, the
curated table is the only place it may appear, and no adapter can carry one.

### 2. Absence means `parented`, and the union is still not forgettable

`placement` is optional. The generated half of the table is the whole GIR widget set
and not one row of it is a portal, so requiring the field would be ~900 identical
lines. What makes that safe rather than implicit is that there is exactly ONE
normaliser — `placementOf(descriptor)` — and every switch over its result ends in
`unhandledPlacement(p: never)`. `tsconfig.json` sets `strict: false` in this package,
so a switch that stops covering its union falls through and returns `undefined` with
no error; assignability to `never` is not a strictness option and DOES fail the build.
That is the same mechanism `unhandledPolicy` already provides for `ChildPolicy`, and
it is why adding a third placement kind cannot compile until every reader handles it.

### 3. The declared close is the FORCED one

`close: 'force_close'`, not `'close'`. Two measurements, both on libadwaita 1.9.3:

| case | result |
|---|---|
| `can-close: false`, `dialog.close()` | returns **false**, emits `close-attempt`, **the dialog stays presented** |
| `can-close: false`, `dialog.force_close()` | closes it, emits `closed`, `get_parent()` is null |
| `dialog.close()` on a dialog never presented | `Adwaita-CRITICAL **: Trying to close AdwDialog 0x… that's not presented`, exit 0 |
| `dialog.force_close()` on a dialog never presented | **silent**, nothing happens |

An unmount is not a user request, so the conditional close is the wrong call: a
consumer that sets `can-close: false` (which is exactly how `<Modal>`'s
`onRequestClose` is honoured) would unmount the element and leave the sheet on screen.
And because the forced call is silent on a node that was never presented, the host
needs no "is it up?" probe before retracting one — which is the probe it could not
write without knowing what a dialog is.

### 4. A portal is presented LAZILY, and that is the feature rather than an optimisation

MEASURED: presenting against a parent that is in no window opens a **separate
`GtkWindow`**, at exit 0, with nothing logged. `adw_dialog_present` finds no
`AdwDialogHost` among the parent's ancestors and takes its documented
`present_as_window` branch; `window.visibleDialog` stays null and the dialog floats out
of the application.

That is not an edge case, it is the ORDINARY case at insert time. Every framework
builds bottom-up: React creates a subtree, appends its children, and inserts the root
into the container last, so at the moment a `<Modal>` is inserted its parent is
usually not in a window yet.

So a portal attachment subscribes to the parent's `notify::root` and presents when a
`Gtk.Window` arrives. MEASURED: `notify::root` fires on a GRANDCHILD box when the
toplevel takes the subtree (`root` → `AdwWindow`), and again on unroot (`root` →
null). `Gtk.Window` and not "any non-null root" is libadwaita's OWN boundary —
`adw_dialog_root()` returns early unless `GTK_IS_WINDOW (root)` — so the generic code
asks the same question the library asks instead of forming a second opinion.

The subscription is kept for the life of the attachment rather than fired once,
because re-rooting is real and silent. MEASURED: unrooting the parent leaves an
already-presented dialog in the OLD window's host — `w1.visibleDialog` is still the
dialog after `w1.set_content(null)` — so a subtree moved to a second window would keep
showing its modal in the first. And a bare re-present is
`Adwaita-CRITICAL **: Cannot present … as it's already presented for …` plus
`Gtk-WARNING **: Can't set new parent …`, with the move NOT happening; close-then-present
is the sequence that works, measured.

The rule is therefore SYMMETRIC: a portal is presented exactly when its anchor is in a
toplevel, and the subscription enforces both directions. Losing the toplevel RETRACTS the
node — not merely "does not present it". Stating only the first direction left the second
missing in the first cut of this seam: a subtree that is detached and never re-rooted kept
its sheet on screen in the window it had left, repaired only by a re-root that a detached
subtree never gets. It also broke the fact below, because the host recorded `attached`
false while GTK still had the node up.

`attached` — the host's separate fact for "GTK has taken this node" — is therefore
written by the present, not by the insert. A deferred portal is claimed by the host and
not yet taken by GTK, which is precisely the distinction that fact exists to keep.

### 5. A portal counts for nothing in its parent's child list

Four readers in the host walk the sibling chain and had to learn it, and each one was a
real defect if it did not:

- the `prevWidget`/`index` arithmetic in `attach` — counting a portal shifts every
  later child by one, and `insert_child_after` would then be handed a widget that is
  not in this container at all (a critical at exit 0);
- the `following` list a tail rotation re-appends — rotating a portal calls the
  parent's adder on it, which is the `g_error()` this whole ADR is about;
- `holdsOursInSlot` — a portal carries `slot === null` like everything unslotted, so a
  `<Modal>` inside a one-child container would report the slot as taken by us and skip
  the refusal that protects the application's own widget;
- `setterSlotChildren`, for the same reason one level over: a text write would record
  that GTK had unparented a node it never held.

`conformance/addressesOf` skips them too, so a vector comparing the shadow order
against the real child list does not disagree by a node that is not there.

### Membership: the `Adw.Dialog` family, and not `Gtk.Window`

Five rows declare the portal placement — `AdwDialog`, `AdwAboutDialog`,
`AdwAlertDialog`, `AdwPreferencesDialog`, `AdwShortcutsDialog`. That set is measured
(`GObject.type_is_a(K.$gtype, Adw.Dialog.$gtype)`), not read from documentation;
`AdwMessageDialog` is deliberately not in it, because it is a `GtkWindow`.

**They are named rather than inherited, and a spec is what keeps the list complete.**
Registration is exact: `lookupWidget('AdwAlertDialog')` answers the GENERATED row, not
`AdwDialog`'s, so an inherited placement would never be looked up and
`<adw-alert-dialog>` under a rooted box would abort the process. `portal.spec.ts` walks
every registered descriptor, resolves its class, and asserts that everything descending
from `Adw.Dialog` declares a portal — so the day libadwaita adds a sixth subclass the
suite fails instead of a user's application aborting. The four subclasses carry
`children: { kind: 'uncurated' }`, which is the honest state: each builds its own
template from its own API, each INHERITS `set_child` from `AdwDialog` where writing
through it would replace that template, so a child in one of them is a named
`uncurated-placement` refusal.

**`Gtk.Window` is NOT a portal here, and the arity is the reason.** `adw_dialog_present`
takes 1 argument and `gtk_window_present` takes 0: a portal is presented AGAINST a
parent, which is what joins its two positions in the tree. A window has no parent to be
presented against — it is a root, not a node with two places — and toplevels are the
router/window-chrome layer's business. `descriptorProblems()` enforces the arity, so a
zero-argument `present` cannot be declared as a portal at all.

## Consequences

- `@gjsify/react-native`'s `Modal` is `partial` rather than `planned`, and it is a
  primitive row like any other: `AdwDialog` outer, an implicit `GtkBox` content node
  (an `Adw.Dialog` holds ONE child, so two children under a `<Modal>` would silently
  evict the first), `can-close: false`, `onRequestClose` → `close-attempt`, `onShow` →
  `map`.
- The seam serves all three adapters, because it is below all three. Nothing in
  `adapters/react.ts`, `adapters/solid.ts` or `adapters/vue.ts` changed, and nothing in
  them mentions a dialog. A Vue `<AdwDialog>` or a Solid one gets the same behaviour
  from the same three functions.
- **The expo-router `dismiss` family is unblocked but NOT implemented here.** Its
  refusal names this seam as what it was waiting for, and a modal stack is now
  expressible; whoever owns the router decides what `dismissTo` means over
  `Adw.NavigationView`. That is a routing decision, not a placement one.
- A third placement kind — a `Gtk.Popover`, say, which is placed by
  `popover.set_parent(widget)` and shown by `popup()` — is a union member and four
  `never` arms away. It is not added speculatively: nothing needs it, and ADR 0028's
  rule holds here as everywhere, a placement fact is measured or it is not written down.

## What was measured

All on Fedora 44, gjs 1.88.1, GTK 4.22.4, libadwaita 1.9.3, Wayland, one gjs process
per case. Source read at `refs/libadwaita/src/adw-dialog.c` — `adw_dialog_root` at 797 (its `g_error` at 816),
`adw_dialog_close` at 1929, `adw_dialog_present` at 2087.

| # | case | result |
|---|---|---|
| A | control: `box.append(label)`, box in an `Adw.Window` | exit 0, parented |
| B | `box.append(dialog)`, box in an `Adw.Window` | `Adwaita-ERROR`, **exit 134** |
| C | `box.append(dialog)`, box detached | **exit 0, silent**, parented |
| D | `dialog.present(box)`, box in an `Adw.Window` | parent `AdwDialogHost`, root the same window, `visibleDialog` set |
| E | `dialog.present(box)`, box **not** in a window | parent and root a **separate `GtkWindow`**, `visibleDialog` false, exit 0 |
| F | `dialog.close()`, never presented | `Adwaita-CRITICAL`, returns false |
| G | `dialog.force_close()`, never presented | **silent** |
| H | `can-close: false` → `close()` / `force_close()` | `close()` false + `close-attempt`, still up / `force_close()` closes + `closed` |
| I | `notify::root` on a grandchild box | fires on root (`AdwWindow`) and again on unroot (null) |
| J | re-present for another host | `Adwaita-CRITICAL` + `Gtk-WARNING`, **and the dialog stays in the first window** |
| L | unroot the parent while presented | dialog stays in the OLD window's host — GTK does NOT take it down, so the seam must; `force_close` then `present` re-hosts cleanly |
| M | `Adw.Dialog` subclasses by `type_is_a` | `AboutDialog`, `AlertDialog`, `PreferencesDialog`, `ShortcutsDialog`; `MessageDialog` is not one |
| N | `map` / `unmap` on a presented dialog | `map` 0 on `present()` against an unshown window, **1** after the window's own `present()`; `unmap` 1 on close |

Case K was measured and is deliberately NOT acted on: a `Gtk.Window` appended to a
rooted `Gtk.Box` is accepted **silently** (`win.get_parent()` is the box, exit 0). That
is a different defect from this one — a toplevel in a child list, not an abort — and it
belongs to whoever owns window chrome. It is recorded in `status/open-todos.md` rather
than fixed here, because acting on it means deciding what a `<Window>` element is, which
is a routing decision this ADR has no business making.
