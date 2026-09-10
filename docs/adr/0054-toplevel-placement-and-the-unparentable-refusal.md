# ADR 0054 — The quiet half of the abort class: `toplevel` placement and a structural refusal

- **Status:** Accepted (2026-09-10)
- **Scope:** `@gjsify/gtk-host`'s element model — a second arm on `NodePlacement`, an oracle that asks a CLASS what placement it has, and one refusal at the insert. Extends [ADR 0045](0045-portal-placement-in-the-gtk-host.md), which introduced the axis, and stays inside [ADR 0028](0028-widget-table-provenance.md)'s rule that a placement fact is measured and curated, never generated.
- **Consumers:** every adapter, because the seam is below all three; `@gjsify/react-native`'s `Modal`, whose refusal sentence this closes.
- **Written after the measurements.** Every number below was produced by running the case on this machine — gjs 1.88.1 / GTK 4.22.4 / libadwaita 1.9.3, Fedora 44, Wayland — one process per case, exit codes and signals recorded. The reproducers are the vectors in `packages/framework/gtk-host/src/placement.spec.ts`, including three that run in a CHILD process.

## Context

ADR 0045 closed the loudest failure this repository has collected: `box.append(dialog)`
on a rooted box is `g_error()` from `adw_dialog_root()` — SIGABRT, exit 134, a core
dump, catchable by nothing. It closed it by declaring what an `Adw.Dialog` really is:
a node presented AGAINST its parent rather than placed into it.

It also measured the neighbouring case and deliberately did not act on it. Case K:

| case | result |
|---|---|
| `box.append(new Gtk.Window())`, box in an `Adw.Window` | **exit 0, silent**; `win.get_parent()` is the box |
| the same window, then `win.present()` | mapped and visible, **and still in the box's child list** |

Afterwards `win.get_root()` is the window ITSELF while `win.get_parent()` is the box: a
`GtkRoot` with a parent, drawn as a toplevel and simultaneously measured and allocated
by a container. GTK says nothing about any of it.

**These are one defect, not two.** Both nodes answer "does this go into my parent at
all?" with no, and one of them shouts while the other says nothing. A seam built for
the shouting one leaves the quiet one exactly where it was — and the quiet one arrives
through the door this repository pays most for.

ADR 0045 left two things undecided, and both are decided here:

1. *Whether a `<GtkWindow>` element should be renderable at all, and what its
   placement means.* It called that a routing question. It is not: `gtk_window_present()`
   is how a window reaches the screen in GTK, exactly as `adw_dialog_present()` is how a
   dialog does. Deciding **which** window a router shows is routing; deciding that a
   window is shown by presenting it is placement.
2. *Nothing checks a descriptor that declares no placement.* Every check in
   `descriptorProblems()` holds a WRITTEN claim against the installed class. The whole
   abort class arrives through the opposite direction — a class that needs a
   declaration and has none — and nothing looked that way.

## Decision

### 1. `NodePlacement` grows a third kind, `toplevel`

```ts
| { readonly kind: 'toplevel'; readonly present: string; readonly close: string }
```

`present: 'present'`, `close: 'destroy'`. Three measurements pick those two names.

| # | case | result |
|---|---|---|
| A | `gtk_window_present` arity | **0**, against `adw_dialog_present`'s 1 |
| B | `close-request` handler returns `true`, then `close()` | window still **mapped and visible** |
| C | the same window, then `destroy()` | visible false, mapped false, silent |
| D | `close()` / `destroy()` on a window never presented | **silent**, both |
| E | `present()` after `close()` **or** after `destroy()` | `Gtk-WARNING **: A window is shown after it has been destroyed. This will leave the window in an inconsistent state.` |
| F | `destroy()` twice | silent |
| G | a presented window | `get_parent()` null, `get_root()` itself |

**The arity in A is what separates the two arms**, and it is why `Gtk.Window` could not
simply join the portal family: a portal has two positions in the tree and the parent is
what joins them, so `present` TAKES the parent. A toplevel has one position, its own.
`descriptorProblems()` now holds both arities — 1 for a portal, 0 for a toplevel — so
the two cannot be swapped by a copy/paste.

**B and C make `destroy` the declared call**, the same choice ADR 0045 § 3 made with
`force_close` and for the same reason: an unmount is not a user request, and a
`close-request` veto is exactly how an application asks the user to confirm one. D says
the host needs no "is it up?" probe before retracting.

**E is where this arm stops being a copy of the portal one.** A retracted toplevel is
gone: GTK4's default `close-request` handler destroys the window, so `close()` is a
conditional destroy rather than a hide, and there is no way back from either. A re-mount
must be a fresh widget — which is what `rebuild` already produces for a construct-only
write, so nothing had to change for it.

**There is no lazy present and no `notify::root` subscription.** The portal arm defers
because its second position comes from the parent; a toplevel has no second position, so
there is nothing to wait for. `attached` is true as soon as there is a widget, and G is
why: GTK holds a root without anybody taking it.

**An authored `visible: false` is honoured.** `present()` sets the window visible, so
presenting unconditionally would make `<gtk-window visible={false}>` a property this host
silently reverses — the exact shape it exists to refuse. The node is still `attached`,
and an ordinary `setProp(el, 'visible', true)` shows it.

### 2. Membership is `Gtk.Root`, measured, and eighteen rows declare it

`GObject.type_is_a(K.$gtype, Gtk.Root.$gtype)` over the shipped table answers **19**
classes: `GtkWindow`, `GtkApplicationWindow`, `GtkDialog`, `GtkAboutDialog`,
`GtkMessageDialog`, `GtkAssistant`, `GtkAppChooserDialog`, `GtkColorChooserDialog`,
`GtkFileChooserDialog`, `GtkFontChooserDialog`, `GtkShortcutsWindow`,
`GtkPageSetupUnixDialog`, `GtkPrintUnixDialog`, `GtkDragIcon`, `AdwWindow`,
`AdwApplicationWindow`, `AdwMessageDialog`, `AdwAboutWindow`, `AdwPreferencesWindow`.

Eighteen carry the declaration. They are NAMED rather than inherited for the reason the
dialog family is: registration is exact, so `lookupWidget('GtkMessageDialog')` answers
the GENERATED row and an inherited placement would never be looked up. A spec walks the
registered table and fails on the twentieth.

**`AdwMessageDialog` is a toplevel and `AdwAlertDialog` is a portal**, which is the pair
this axis is easiest to get wrong on. ADR 0045 already recorded that
`AdwMessageDialog` is not an `Adw.Dialog`; the other half of that sentence is that it IS
a `GtkWindow`, so it belongs here.

**`GtkDragIcon` is the nineteenth and carries no declaration.** Measured: it has no
`present`, no `close` and no `destroy` at all — GTK builds one for a drag operation and
nothing else ever shows one. A row that cannot name the methods cannot declare the
placement, so it is refused at the insert instead (§ 4). That is the honest answer, and
naming it in the spec rather than counting it is what makes a second such class a
decision to take rather than a number to bump.

**Children stay `uncurated` on every row that had no policy before.** A window takes
`set_child`, but `GtkDialog` and its five chooser subclasses put children into a content
area that `set_child` would replace, and `GtkAssistant` addresses pages by index — the
`AdwAlertDialog` trap one axis over. Guessing an adder buys a warning at exit 0.

### 3. The host asks the CLASS, never a name

```ts
export function classPlacementKind(gtype, present): 'portal' | 'toplevel' | null {
    if (GObject.type_is_a(gtype, Gtk.Root.$gtype)) return 'toplevel';
    if (typeof present === 'function' && present.length === 1) return 'portal';
    return null;
}
```

A list of gtypes in `policies.ts` would be exactly the widget knowledge ADR 0027 rule 1
forbids, and it would be wrong for a consumer's own subclass anyway. Both questions are
measured across all 169 rows of the shipped table (`tableProvenance().total`), not a sample:

- `Gtk.Root` is GTK's own word for "this widget is a toplevel", and it is the boundary
  the library itself uses.
- A `present()` that takes an argument is a node presented against something. **Exactly
  five classes in the table have one, and they are exactly the five `Adw.Dialog`
  descendants** — the ones whose `root` vfunc calls `g_error()`.

**`Gtk.Popover.present()` is the discriminator that puts the ARITY in the question.** It
exists (GTK 4.14+), it takes 0 arguments, and a popover is parented with `set_parent()`
like any other child. A "has a `present` method" oracle would refuse every popover in
every application. The order matters too and is not alphabetical: every `Gtk.Root` in the
table with a `present` has a 0-argument one, and `GtkDragIcon` has none, so the root test
must come first.

### 4. Two mechanisms, and they cover the class between them

**`descriptorProblems()` reports a class that demands a placement and declares none.**
That is the whole TABLE, up front, and it runs over a consumer's descriptors too because
it takes them as an argument. It is the mechanism: it makes the class visible rather than
this instance of it.

**`refuseUnparentable()` refuses such a child at the insert**, before `ensureWrapper` and
therefore before any adder. For the toplevel arm that turns a silent acceptance into a
named `GtkHostError`. For the portal arm it is the only report that can exist at all:
after the append there is no process left to report from.

**It fires only where the descriptor is SILENT.** `placement` present — including an
explicit `{ kind: 'parented' }` — means the author has answered the question, and the
host does not overrule an answer with a heuristic. A consumer widget with an unrelated
one-argument `present()` that really is a child says so in one line. That escape hatch is
demonstrated in the spec on the SILENT half deliberately: showing it with a dialog would
abort the test process rather than document anything.

Both are about INSERTION. Retraction needed a second decision, and it is § 6.

### 6. `remove` detaches, `destroy` closes — and the two arms differ only here

`remove` states its own contract: *"Detach only — reversible. Frameworks move nodes;
`remove` must not destroy one."* The declared close for this arm is `destroy()`, and
measurement E above is that `destroy()` is TERMINAL. Nothing reconciled the two, so a
`remove` followed by an `insert` elsewhere — Solid's ordinary reorder, since its
`removeNode` calls `remove(node)` directly — destroyed the window and then presented the
corpse: `Gtk-WARNING **: A window is shown after it has been destroyed`, at exit 0,
visible only because `installDiagnosticsGate()` was watching.

**The cause is the difference between the arms, not the toplevel arm itself.** Measured:

| case | result |
|---|---|
| `dialog.force_close()`, then `dialog.present(box)` against the SAME parent | re-hosted, `visibleDialog` set, **no diagnostic** |
| `win.destroy()`, then `win.present()` | `Gtk-WARNING **: A window is shown after it has been destroyed` |

A portal's declared close is already reversible, so that arm never showed the defect and
one `retractOutsideParent` looked correct for as long as it was the only arm. It was
treating a reversible verb and a terminal one as the same thing.

**So the axis has two verbs.** `detachOutsideParent` is what `remove` means and
`closeOutsideParent` is what `destroy` means; for a portal both are `force_close`, and
for a toplevel they are the hide and the destroy. Measured, in order, on one window:

| # | case | result |
|---|---|---|
| O | `set_visible(false)` on a presented window | `visible` false, ONE `unmap`, **no `close-request`**, still in `Gtk.Window.list_toplevels()` |
| P | `present()` after it | mapped again, **no diagnostic** |
| Q | a second `set_visible(false)` | no-op, no further `unmap` |
| R | `destroy()` on the hidden window | no further `unmap`, and it **leaves** `list_toplevels()` |

O and R together are why the detach is a detach: GTK's own toplevel list still holds a
hidden window, so hiding is not a teardown and `destroy` still has work to do.

**A property write rather than a declared method**, and that is the honest shape rather
than a shortcut: a window's presence on screen IS its `visible` property — which is why
`presentToplevel` already reads it — so every toplevel detaches the same way and a
per-row name would be eighteen identical strings, the argument ADR 0045 § 2 already made
for making `placement` optional. `set_visible(false)` and not the deprecated `hide()`,
which is the same call one rename older.

**`rebuild` is the one caller that wants the terminal verb**, and it says so itself. Five
of `removeChild`'s six call sites re-attach the same widget afterwards — `remove`,
`replaceAt`, `materialize`'s rollback, `rebuild`'s child sweep. The sixth is `rebuild`
discarding `el.widget`, and a toplevel is held by GTK's list rather than by a parent
(measurement O), so detaching there leaked one hidden window per construct-only write.

**What this changes for a consumer**: unmounting a `<gtk-window>` in Solid takes it off
screen at `removeNode` and destroys it when the root disposer runs `destroyChildren`,
which is `destroy` and not `remove` — so the teardown still happens, one step later, and
a reorder no longer costs the window. Nothing changes for React or Vue, whose `remove`
IS a teardown followed by no re-insert.

**And it closes the second order of the same defect.** `remove` unlinks the node, so a
`destroy` after it takes the no-parent arm and used to run the terminal call a second
time — silent on gjs, `TypeError: invalid GObject handle` on node-gi. The `unmap` count
cannot see that (the second call lands on an already-hidden window), so the vector counts
the CALL rather than its effect. Effect-based assertions are the right default and this
is where the default does not reach.

### 5. The four sibling walks ask the AXIS, not the arm

`isPortal` in `attach`'s index arithmetic, its `following` list, `holdsOursInSlot`,
`setterSlotChildren` and `conformance/addressesOf` becomes `isUnparented`. ADR 0045 § 5
listed each as a real defect if it did not skip a portal; every one of them is the same
defect for a toplevel, and each was correct only while `portal` was the only non-parented
kind. That is the shape a union arm added later leaves behind, and it is why
`outsideParentOf` returns the ARM rather than a boolean — a caller switches over it and
its `never` arm stops compiling when a fourth kind lands.

## Verification — an abort has to be SEEN to be denied

A test asserting "this no longer aborts" is worthless in the process it asserts in.
SIGABRT takes the runner down, so a suite that FINISHES proves it is alive and nothing
more: a harness that could never observe an abort reports the same green either way.

The discriminator is three cases that run in a **child process** and read its exit
signal (`Gio.Subprocess`, `get_if_signaled()` / `get_term_sig()`):

| case | asserted |
|---|---|
| `box.append(dialog)`, box in an `Adw.Window` — the raw call this seam replaces | **signalled, SIGABRT (6)**, `Adwaita-ERROR` on stderr, nothing on stdout |
| `dialog.present(box)` — the placement the host uses instead | exit 0, dialog parented into the window's dialog host |
| `box.append(window)` — the quiet half | exit 0, **empty stderr**, `get_parent()` the box and `get_root()` itself |

The first row is the negative control: while it passes, every in-process "the host does
not abort" vector in the file is falsifiable. The third records why the quiet half
survived a seam built for the loud one.

They are `it.failing(…, { when: GJS === null })` rather than skipped: this suite is one
program across `test:gjs` and `test:gjs-on-node` (ADR 0030), and a node host is not
obliged to carry a gjs binary — so the cases RUN wherever one exists and go red the day
such a host stops reproducing the abort.

**The abort is deliberate and its 2.8 MB core dump is not.** Every run of this suite wrote
one `gjs-console` SIGABRT dump; CI pays it per run. The child is spawned under a
`prlimit --core=0` argv PREFIX — not a shell, so it execs and `waitpid` still reports the
CHILD's signal rather than a shell's `128 + n`, and there is no command line to
interpolate a path into. Measured side by side in one run: bare spawn
`COREFILE: present 2.8M`, prefixed spawn `COREFILE: none`, both `signalled=true term=6`
with `Adwaita-ERROR` on stderr. `ulimit -c 0` would suppress the same file, and the point
is that neither suppresses the SIGNAL — the assertion is unchanged. The prefix is PROBED
(`prlimit` is util-linux and this suite also runs on darwin and win32); a host without it
spawns exactly as before.

## Consequences

- `@gjsify/react-native`'s `Modal` is served by a placement kind rather than by the only
  placement kind, and the layer needs no change: the seam is below every adapter.
- A `<gtk-window>` / `<adw-window>` element is renderable in every adapter and opens a
  window. What a ROUTER does with one — a modal stack, `dismissTo` over
  `Adw.NavigationView` — is still the router's decision and is still open.
- The eighteen rows moved from the generated half of the table into the curated half.
  They carry `children: { kind: 'uncurated' }` unless they already had a policy, so the
  number of widgets with a measured CHILD rule is unchanged by this ADR.
- **`remove` and `destroy` mean different things for a non-parented node**, which they
  already did for a parented one. A fourth placement kind therefore owes three answers —
  present, detach, close — rather than two.
- A fourth placement kind — `Gtk.Popover`, placed by `set_parent()` and shown by
  `popup()`, is the obvious candidate — is now several `never` arms away instead of two.
  It is not added speculatively: nothing needs it, and ADR 0028's rule holds here as
  everywhere.

## What was measured

All on Fedora 44, gjs 1.88.1, GTK 4.22.4, libadwaita 1.9.3, Wayland, one process per
case. Source read at `refs/libadwaita/src/adw-dialog.c` (`adw_dialog_root` at 797, its
`g_error` at 816) and the GTK4 window sources for `gtk_window_close`'s default handler.

| # | case | result |
|---|---|---|
| K1 | `box.append(new Gtk.Window())`, box in an `Adw.Window` | exit 0, silent, `get_parent()` the box, `get_root()` the window itself |
| K2 | then `win.present()` | visible and mapped, **still in the box's child list** |
| A | `gtk_window_present` / `close` / `destroy` arity | 0 / 0 / 0; `adw_dialog_present` 1 |
| B | `can-close` equivalent: `close-request` → true, then `close()` | visible true, mapped true |
| C | then `destroy()` | visible false, mapped false, silent |
| D | `close()` / `destroy()` on a window never presented | silent, both |
| E | `present()` after `close()` or `destroy()` | `Gtk-WARNING **: A window is shown after it has been destroyed` |
| F | `destroy()` twice | silent |
| G | presented window | `get_parent()` null, `get_root()` itself |
| H | `Gtk.Root` implementors in the shipped table | 19, incl. `GtkDragIcon`, which has no `present`/`close`/`destroy` |
| I | classes in the table with a 1-argument `present` | exactly the 5 `Adw.Dialog` descendants |
| J | classes in the table with a 0-argument `present` | 21 — the 18 declared toplevels, plus `GtkPopover`, `GtkPopoverMenu`, `GtkEmojiChooser`, none of them a `Gtk.Root` |
| L | `box.append(new Adw.Dialog())`, box in an `Adw.Window`, own process | `Adwaita-ERROR`, **killed by SIGABRT**, core dump |
| O | `set_visible(false)` on a presented window | `visible` false, one `unmap`, no `close-request`, still in `list_toplevels()` |
| P | `present()` after O | mapped again, no diagnostic |
| Q | a second `set_visible(false)` | no-op |
| R | `destroy()` on the hidden window | no further `unmap`, leaves `list_toplevels()` |
| S | `force_close()` then `present(box)` against the same parent | re-hosted, `visibleDialog` set, no diagnostic |
| T | the child spawn under `prlimit --core=0` | `signalled=true term=6`, `COREFILE: none` against `present 2.8M` bare |
