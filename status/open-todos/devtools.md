<!-- Authored Open-TODO sections — area: Devtools.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `Screenshot(scope)` is routed, but two of its four scope shapes are unproven

The dead in-arg is fixed — `ScreenshotAsync` reads `params[0]` and resolves it
through the same `_resolveRootWidget` the path methods use. Two of the four
shapes that fix needs are asserted headlessly in `peer-transport.spec.ts`: the
active-window vocabulary (`''`/`window`/`active`) still answers, and an
unresolvable path now raises `not-found` instead of silently returning the
active window's pixels. That second one is what makes the argument's routing
OBSERVABLE at all — it is the only input whose read and unread readings differ.

The other two — a NON-ACTIVE toplevel, and a CHILD widget — cannot be asserted
where the suite runs. Both need a realised, laid-out window, and the devtools
specs run on plain gjs with no display precisely so they cover the busless path
on every PR. So what is unproven is not the routing (the resolver is shared with
`DumpTree`/`GetProperty`/`ActivateWidget`, which are covered) but that
`captureWidgetPng` on a CHILD returns that child's pixels rather than its
window's, and that presenting `widget.get_root()` warms up the right toplevel.

Where it would go: `tests/e2e/devtools-export/`, the one suite that drives a real
GApplication — which is itself unlisted today for an unexplained name loss in the
containerised runner (its own entry below). Same environmental hole, so this
waits on that rather than adding a second suite that would skip for the same
reason.


### `devtools-export` loses its DBus name in the containerised runner

`tests/e2e/devtools-export/` had never run in CI. Listing it in `test:e2e` (PR #984) gave it a
first run, which failed — and the measurement points at the environment rather than at
`@gjsify/devtools`:

```
APP_ON_BUS=yes            the fixture DID own org.example.reprotest
INSTALL_RETURNED=null     installDevtools returned null
EXPORT_LOG=no             the "exported org.gjsify.Devtools" line never printed
GETSTATUS  -> GDBus.Error:...ServiceUnknown: The name org.example.reprotest
                          was not provided by any .service files
```

with, in between, `dbus-daemon` activating `org.freedesktop.portal.Desktop` on the fixture's
request and `xdg-desktop-portal` then failing on `Document portal fuse mount point unknown`.
So the app owned its name, lost it, and devtools never installed. The same suite passes on a
normal desktop session.

WHAT IS NOT KNOWN: why the name goes away. Candidates worth separating before touching any
code — the app exiting early (a GApplication with no window and `HANDLES_COMMAND_LINE` can
return from `run()` sooner than the driver's 20 s polling window suggests), the portal
activation churn interfering with name ownership, or `installDevtools` genuinely getting no
`app.get_dbus_connection()` at `startup` in that environment. The driver already captures the
app's own log (`APP_LOG_BEGIN`/`APP_LOG_END`); the CI run printed the KEY=value block but the
app log itself is the next thing to read.

THE FIX IS NOT A LEDGER ENTRY. It is currently in `scripts/e2e-unlisted-suites.mjs` so #984
could land honestly, but the entry says so: the right repair is a precondition in the suite's
own SKIP gate — it already carries a list of them — so it skips where an Adwaita GApplication
cannot complete startup and keeps running where it can. Removing the ledger entry in the same
change is what `check-e2e-suite-coverage.mjs` will then require.


### `@gjsify/devtools-cdp` parses HTML with a regex

`packages/framework/devtools-cdp/src/target-discovery.ts:10` says so in a comment
and explains that `DOMParser` was not usable for it. It is usable now — HTML mode,
real selectors, entity decoding, all reachable from the same Node run that suite
already has. Collecting it is a change against a different pillar, so it did not
ride along with ADR 0026.

