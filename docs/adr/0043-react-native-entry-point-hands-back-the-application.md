# ADR 0043 — The React Native entry point runs on the app shell, and hands the application back

- **Status:** Proposed (2026-09-04)
- **Scope:** `@gjsify/react-native` (`AppRegistry`, `registerRootComponent`,
  `RunApplicationOptions` — published API); consumes `@gjsify/adwaita-app` (ADR 0009),
  `@gjsify/gtk-host` (ADR 0027) and `@gjsify/devtools`
- **Supersedes nothing.** Amends ADR 0032 § 8's `AppRegistry` divergence with what
  follows from it.

## Context

ADR 0032 § 8 declares one divergence at this layer's entry point: React Native's
`AppRegistry.runApplication(key, { rootTag, initialProps })` is handed a root tag by a
native host that already exists, while on a desktop **the application is the host**,
so `runApplication` must create the `Adw.Application` itself and needs an application
id React Native never asks for.

That divergence was declared and then left one step short. `runApplication` created the
application and handed back only an exit code, which resolves when the last window
closes — so nothing that describes a *running* application could come out of it, and
no option going *in* could reach the shell either: the call forwarded `applicationId`
and `css` and dropped every other field of `AdwaitaAppOptions`.

Three consequences, all measured on this branch before the change.

**1. The control plane could not be configured.** `@gjsify/devtools` is this repo's
answer to "verify a GUI without a human": `DumpTree`, `GetProperty`, `FindWidget`,
`ActivateWidget`, `SendKey`, `Screenshot` over DBus. `installDevtools(app)` must run in
the application's `startup` handler, because the bus connection and object path exist
only after the application has registered — which happens inside `runAdwaitaApp`, i.e.
somewhere a consumer's entry file cannot reach. `AdwaitaApp` already installs it
env-gated, so `GJSIFY_DEVTOOLS=1` did export (measured). What no consumer could reach
was every other knob on it: `extend` (app-specific methods), `instance`
(multi-instance), and above all `address` — the bus-less **peer** transport is the only
way devtools works on macOS and Windows, and it is configured by exactly the option
that was being dropped. A layer whose OS claim is `darwin: partial`,
`win32: partial` cannot afford that.

**2. The rendered tree never appeared, and the symptom looked like devtools.**
`runApplication` never called `registerBuiltinWidgets()`. Every showcase and every spec
in this repo calls it explicitly and is right to — a renderer may bind its own table
(ADR 0027 § 1) — but a ported React Native entry file cannot: it is not a React Native
name, and `runApplication` *is* the bootstrap it would have to be called from. So the
first React commit threw `GtkHostError: No descriptor registered for <GtkBox>` from
inside `createWindow`; GJS logs an exception thrown in a GObject handler and
**swallows** it, skipping the rest of the handler, so `present()` never ran. Measured
end to end: the process stayed up, claimed its bus name, exported devtools, answered
`GetStatus` with one **unmapped** toplevel, dumped a tree holding only the toolbar
chrome, and answered `Screenshot` with `(@ay [],)` — a successful call returning no
picture. Every one of those is a green-looking answer. The documented four-line
quickstart in the package README could not draw a single widget.

**3. The application object was unreachable from the application's own code.** An entry
file on this layer is `await registerRootComponent(App, { … })` and nothing else, so
the code that wants the application — a component adding an action, a module attaching
a `Gtk.EventController`, anything observing `close-request` — is somewhere else
entirely, and a return value cannot reach it.

The cost of (2) plus (1) is not a missing convenience. The application this layer was
ported for verified a 25-route port with an in-process screenshot hook, because there
was no way to drive it from outside; on the macOS host that hook was measured firing
**before** the route hook, so every route-targeted picture actually showed the start
screen. An in-process capture photographs what the process believes it drew, from
inside the process, with no independent observer. Devtools is the observer, and this
entry point was the seam that kept an application from reaching it.

## Decision

1. **The shell is `@gjsify/adwaita-app`, and its whole option set is the consumer's.**
   `RunApplicationOptions extends Omit<AdwaitaAppOptions, 'createWindow'>`, and
   `runApplication` forwards `{ ...options, createWindow }`. Not a hand-picked list of
   fields worth forwarding: a list has to grow every time the shell gains an option,
   and the field nobody remembers to add is the one a consumer needs — `devtools` was
   that field. `createWindow` is the single option this layer answers itself, and
   spreading first makes it unoverridable.

   No second application layer is invented. `runAdwaitaApp` already holds the `runAsync`
   lifecycle (ADR 0009's promise-job-queue hang), the startup CSS bootstrap, the
   get-or-create window, the quit/about actions, the single-instance-handoff notice and
   the env-gated `installDevtools` — at the lifecycle moments only the shell knows.
   Re-implementing any of that behind a React Native-shaped façade would be a second
   truth about the same application.

2. **`runApplication` registers the built-in widget table** (`registerBuiltinWidgets()`,
   idempotent) before it creates a React root. The explicit-table rule of ADR 0027 § 1
   is unchanged for renderers; it is answered *here*, once, by the function that owns
   the bootstrap, because the consumer this layer serves has no place to call it from.

3. **The application is reached through a live accessor, not a return value.**
   `AppRegistry.getApplication()` and `getWindow()` answer while the loop runs and
   `null` outside it. `runApplication` is their only writer and clears them on the way
   out — an accessor answering with a closed application's window is worse than
   answering `null`. Non-null from the first render onwards and *before* the window
   maps, which is what makes a default size, a controller or a `close-request` handler
   possible from inside the tree.

   **Those two, and not the React root or its container widget.** `runApplication`
   holds both internally, and handing them out would be exposing working state because
   it happened to be in the same object: `root.render()` from outside replaces the tree
   this layer mounted, and `root.unmount()` leaves `getWindow()` answering with a window
   whose content is gone — the same lying accessor the paragraph above rejects, reached
   through the front door instead. A consumer that legitimately needs to place a
   non-React widget in the container does it through the host element gtk-host gives
   React (`adopt`), which is the operation that keeps the reconciler's bookkeeping
   correct. The asymmetry settles it: adding an accessor later is additive, removing one
   from a published API is not.

4. **Two shapes, and the split is by question.** Anything that must happen at a
   lifecycle moment travels as an option (`devtools`, `onStartup`); "which application
   am I in" is the accessor. They are not alternatives: the first is unreachable
   through an accessor (startup has already passed by the time anyone can read one),
   and the second is unreachable through a parameter (the caller is not the entry file).

5. **The claim is held by an external observer, or it is not held.**
   `tests/e2e/react-native-devtools` builds a fixture whose entire bootstrap is
   `registerRootComponent` — no widget table, no `Adw.Application`, no devtools call —
   runs it under `dbus-run-session`, and asserts from *another process*: the
   `installDevtools` export line, the interface at the devtools object path, an
   application window that is **mapped**, both rendered widgets present in `DumpTree`
   by the `Gtk.Widget:name` their `testID` wrote, a `Screenshot` reply carrying the PNG
   signature and more than a header of payload, and finally `ActivateWidget` on the
   button followed by a `GetProperty` read showing the label React changed. Two vectors:
   the `GJSIFY_DEVTOOLS` env gate, and `devtools: true` passed through the options with
   the env var unset — the second can only pass if the passthrough exists.

   Nothing in that fixture asserts anything about itself. An in-process assertion is the
   evidence this ADR exists to replace.

## Consequences

- `RunApplicationOptions` gains every current and future `AdwaitaAppOptions` field.
  That is deliberate coupling: this layer's application *is* an `AdwaitaApp`, and
  hiding that would only mean re-deriving it. A future shell option that must NOT be a
  consumer's needs to be `Omit`ted here, which is a visible one-line decision.
- `@gjsify/react-native` now reaches `@gjsify/gtk-host`'s root export from shipping
  source. It already did (`lists/controller.ts`), and the package declares no
  `gjsify.headless`, so no axis changes.
- A consumer who builds their own `Adw.Application` and calls `createRoot` directly
  still calls `registerBuiltinWidgets()` themselves, exactly as the showcases do. Only
  the `AppRegistry` bootstrap answers it for them.
- `AppRegistry` grows two members React Native does not have. It is already declared
  `partial` in the ADR 0032 § 8 support table, which judges module export NAMES; object
  members on a `partial` entry are where this layer's declared divergence lives.
- The e2e suite is Linux-only in practice (it needs `dbus-run-session` and a GJS host).
  The peer transport it makes configurable is what a darwin/win32 leg would use, and
  that leg is not part of this decision.
