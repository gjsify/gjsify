# @gjsify/example-dom-adwaita-gallery-nativescript

The probe behind the **NativeScript XML tab** in the [Adwaita gallery](https://gjsify.org/gjsify/adwaita/). It loads every template the website ships through NativeScript's own `Builder` on a real Android device and asserts the view tree the Builder built.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Why a running app and not 28 templates in the pages

Every snippet in that gallery was compiled and run before it was written down. XML is the one dialect where "it renders" cannot be read off the text, because NativeScript's Builder fails **silently in both directions**:

- An **attribute** arrives at a plain accessor as the raw **string**. `ui/builder/component-builder`'s `setPropertyValue` ends in `instance[name] = value` and does nothing else — only a NativeScript `Property` object carries a `valueConverter`, and these widgets are plain classes. Measured here: `<AdwAvatar size="96">` rendered at 48 (`Number.isFinite('96')` is false, so the setter substituted its default) and `<AdwAboutDialog open="false">` **opened the dialog on load** (`!!'false'` is true).
- A **child** arrives at `_addChildFromBuilder(name, view)`, and `LayoutBase`'s inherited implementation ignores the name and calls `addChild`. A composed widget builds its own internal boxes in its constructor, so the child lands in the layout's first cell — a header bar declared as a toolbar view's top bar painted **on top of the content**.

Both render. Neither is what the template says. So the probe reads every declared property **back** off the widget and compares the value *and its type*, and resolves every child through the parent's **own** accessor (`clamp.child`, `headerBar.titleWidget`, `group.listbox`) — never by searching the subtree, because a child found somewhere below the parent is exactly what the broken default produces.

## Generated, not written

`app/views/*.xml`, `app/adw.ts`, `app/gtk.ts` and `app/expected.ts` are emitted by [`scripts/generate-adwaita-nativescript-templates.mjs`](../../../scripts/generate-adwaita-nativescript-templates.mjs) from [`scripts/adwaita-gallery-ns-templates.mjs`](../../../scripts/adwaita-gallery-ns-templates.mjs) — the same run that writes `website/src/data/adwaita-nativescript-templates.ts`. The bytes a reader copies off the website and the bytes this app inflates are one string, and `scripts/check-generated-website-data.mjs` compares them.

Do not edit those four by hand; re-run the generator.

The two barrels are two because the `xmlns` prefix is the only thing an XML template has to
say which library a widget belongs to: `~/adw` holds the `Adw` half and `~/gtk` the `Gtk`
half, so `<adw:Button>` fails to load instead of quietly building the GTK button (ADR 0034
§ Amendment 9).

## Run

```bash
"$ANDROID_HOME/emulator/emulator" -avd <name> -gpu host -no-snapshot &   # boot a device first
adb wait-for-device

cd showcases/dom/adwaita-gallery-nativescript
npm run probe:android
# exit 0 → every template inflated and every assertion held
# exit 1 → see the FAIL lines and logcat.android.log
```

`sync:theme` (run by every android script) copies the current `adwaita.css` out of the bridge package, so the app never ships a drifted theme copy.

This project is excluded from the root `workspaces` glob — its NativeScript toolchain must not be pulled into every `gjsify install` — but its `@gjsify/*` deps resolve from the **hoisted workspace** `node_modules` (caret ranges), so the NativeScript CLI must NOT run its own `npm install`: every script passes `--disable-npm-install`.

Like [`tests/integration/nativescript`](../../../tests/integration/nativescript) and the storybook showcase beside it, this needs the NS CLI and an Android device, which no CI container has. It is **not wired into CI**. Two checks hold the static half there:

- `scripts/check-generated-website-data.mjs` — every element, property and slot a template names exists; the template writes each value in the type the setter DECLARES (a `boolean` prop written as the string `'false'` emits the same XML and would slip past a rule keyed on the literal); every refusal reason names a member the widget really has; and the shipped bytes match `app/views/`.
- `scripts/check-nativescript-xml-doors.mjs` — the same coercion rule over the **whole package** rather than over the 28 templates, because a consumer writing their own XML against the published `@gjsify/adwaita-nativescript` meets all 70 non-string setters and not just the ones this gallery happens to name.

## What it asserts

| | |
|---|---|
| the element | `instanceof` the class the barrel exports — not `constructor.name`, which a bundler may rename |
| every attribute | read back off the widget, compared by value **and type** |
| every child | resolved through the parent's own slot accessor, first unclaimed match |
| the whole run | `__GJSIFY_NS__` markers in logcat, parsed by `scripts/run-on-device.mjs` |

The `PASS n/total` label on screen is a fallback for a human; a screen somebody has to read is not a gate.

## Layout

```
app/
  app.ts              entry — Application.run({ moduleName: 'app-root' })
  app-root.xml        <Frame defaultPage="gallery-page" />
  gallery-page.*      the probe: Builder.load() each view, walk the tree, report
  reporter.ts         the __GJSIFY_NS__ marker grammar
  adw.ts, gtk.ts      GENERATED — one module per library, what each xmlns resolves to
  expected.ts         GENERATED — the tree each view must have built
  views/*.xml         GENERATED — the templates the website ships
  app.css             @nativescript/theme + adwaita.css
scripts/
  run-on-device.mjs   prepare → copy bundle → gradle → install → parse logcat
  parse-logcat.mjs    the marker parser (shared shape with tests/integration/nativescript)
```

## Related

- [`@gjsify/adwaita-nativescript`](../../../packages/nativescript-bridge/adwaita) — the native Adwaita widget set the templates name
- [`adwaita-storybook-nativescript`](../adwaita-storybook-nativescript) — the full storybook as a NativeScript app
- [`adwaita-gallery-solid`](../../gtk/adwaita-gallery-solid) — the same arrangement for the gallery's Solid, Vue and React tabs

## License

MIT
